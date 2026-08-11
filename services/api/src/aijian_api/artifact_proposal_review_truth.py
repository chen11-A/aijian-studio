"""Caller-transaction review truth for the current source.extract vertical slice."""

import json
import sqlite3
from dataclasses import dataclass

from aijian_api.agent_run_store import (
    PersistedAgentRunBundle,
    PersistedProposalRunEnqueueIntent,
    read_agent_run_bundle_in_connection,
    read_proposal_run_enqueue_intent_in_connection,
)
from aijian_api.artifact_proposal_store import PersistedArtifactProposal
from aijian_api.source_extract_run_factory import SourceExtractEnqueueIntentV1
from aijian_api.task_ledger_snapshots import canonical_snapshot_json


class ArtifactProposalReviewConflictError(ValueError):
    """Persisted proposal review truth is missing, detached or no longer reviewable."""


@dataclass(frozen=True, slots=True)
class ProposalReviewIdentity:
    run_bundle: PersistedAgentRunBundle
    enqueue_intent_record: PersistedProposalRunEnqueueIntent
    enqueue_intent: SourceExtractEnqueueIntentV1


@dataclass(frozen=True, slots=True)
class ReviewableProposalTruth:
    attempt_revision: int
    node_run_id: str
    node_revision: int
    workflow_run_id: str
    workflow_revision: int


def read_proposal_review_identity(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    persisted: PersistedArtifactProposal,
) -> ProposalReviewIdentity:
    """Validate the source.extract Proposal, Agent/Skill/Context and enqueue identity."""

    proposal = persisted.proposal
    run_bundle = read_agent_run_bundle_in_connection(
        connection,
        project_id,
        proposal.producer_agent_run_id,
    )
    enqueue_intent_record = read_proposal_run_enqueue_intent_in_connection(
        connection,
        project_id,
        proposal.producer_agent_run_id,
    )
    enqueue_intent = SourceExtractEnqueueIntentV1.model_validate(enqueue_intent_record.payload)
    return ProposalReviewIdentity(
        run_bundle=run_bundle,
        enqueue_intent_record=enqueue_intent_record,
        enqueue_intent=enqueue_intent,
    )


def validate_proposal_review_run_chain(
    *,
    persisted: PersistedArtifactProposal,
    identity: ProposalReviewIdentity,
) -> None:
    """Validate run status and Proposal ownership when no draft preparer will do so."""

    proposal = persisted.proposal
    agent_run = identity.run_bundle.agent_run
    skill_run = identity.run_bundle.skill_run
    if (
        proposal.project_id != agent_run.project_id
        or proposal.project_id != skill_run.project_id
        or proposal.producer_agent_run_id != agent_run.agent_run_id
        or proposal.producer_skill_run_id != skill_run.skill_run_id
        or skill_run.agent_run_id != agent_run.agent_run_id
        or agent_run.delegated_skill_run_ids != (skill_run.skill_run_id,)
        or skill_run.proposal_id != proposal.proposal_id
        or agent_run.status != "NEEDS_REVIEW"
        or skill_run.status != "NEEDS_REVIEW"
    ):
        raise ArtifactProposalReviewConflictError(
            "ArtifactProposal producer run chain is not reviewable"
        )


def read_reviewable_proposal_truth(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    proposal_row: sqlite3.Row,
    persisted: PersistedArtifactProposal,
    identity: ProposalReviewIdentity,
) -> ReviewableProposalTruth:
    """Validate workflow, Attempt, Node and exact Task against the frozen identity."""

    proposal = persisted.proposal
    run_bundle = identity.run_bundle
    enqueue_intent_record = identity.enqueue_intent_record
    enqueue_intent = identity.enqueue_intent
    truth = connection.execute(
        """
        SELECT attempt.status AS attempt_status,
               attempt.revision AS attempt_revision,
               attempt.output_version_id AS attempt_output_version_id,
               node.node_run_id, node.status AS node_status,
               node.revision AS node_revision,
               node.active_attempt_id,
               node.output_version_id AS node_output_version_id,
               workflow.workflow_run_id, workflow.status AS workflow_status,
               workflow.revision AS workflow_revision,
               workflow.definition_id, workflow.definition_version,
               workflow.input_hash AS workflow_input_hash,
               definition.definition_hash, definition.graph_json,
               node.node_key, node.node_type, node.contract_version,
               node.input_bindings_json, node.input_hash AS current_node_input_hash,
               node.idempotency_key AS current_node_idempotency_key,
               node.max_attempts,
               task.status AS task_status, task.task_kind, task.priority,
               COUNT(*) OVER () AS exact_task_count
        FROM workflow_attempts AS attempt
        JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
        JOIN workflow_runs AS workflow
          ON workflow.workflow_run_id = node.workflow_run_id
        JOIN task_ledger AS task
          ON task.attempt_id = attempt.attempt_id AND task.task_kind = ?
        JOIN workflow_definitions AS definition
          ON definition.definition_id = workflow.definition_id
         AND definition.version = workflow.definition_version
        WHERE attempt.attempt_id = ? AND workflow.project_id = ?
        """,
        (enqueue_intent.task_kind, persisted.producer_attempt_id, project_id),
    ).fetchone()
    if (
        truth is None
        or str(truth["attempt_status"]) != "RUNNING"
        or truth["attempt_output_version_id"] is not None
        or str(truth["node_status"]) != "NEEDS_REVIEW"
        or str(truth["active_attempt_id"]) != persisted.producer_attempt_id
        or truth["node_output_version_id"] is not None
        or str(truth["workflow_status"]) != "ACTIVE"
        or str(truth["task_status"]) != "COMPLETED"
        or int(truth["exact_task_count"]) != 1
    ):
        raise ArtifactProposalReviewConflictError(
            "ArtifactProposal is not in a reviewable workflow state"
        )
    _validate_enqueue_intent_chain(
        proposal_row=proposal_row,
        truth=truth,
        intent=enqueue_intent,
        intent_project_id=enqueue_intent_record.project_id,
        intent_agent_run_id=enqueue_intent_record.agent_run_id,
        context_manifest_id=run_bundle.context_manifest.context_manifest_id,
        producer_attempt_id=persisted.producer_attempt_id,
        producer_agent_run_id=proposal.producer_agent_run_id,
        producer_skill_run_id=proposal.producer_skill_run_id,
    )
    return ReviewableProposalTruth(
        attempt_revision=int(truth["attempt_revision"]),
        node_run_id=str(truth["node_run_id"]),
        node_revision=int(truth["node_revision"]),
        workflow_run_id=str(truth["workflow_run_id"]),
        workflow_revision=int(truth["workflow_revision"]),
    )


def _validate_enqueue_intent_chain(
    *,
    proposal_row: sqlite3.Row,
    truth: sqlite3.Row,
    intent: SourceExtractEnqueueIntentV1,
    intent_project_id: str,
    intent_agent_run_id: str,
    context_manifest_id: str,
    producer_attempt_id: str,
    producer_agent_run_id: str,
    producer_skill_run_id: str,
) -> None:
    try:
        graph = json.loads(str(truth["graph_json"]))
        input_bindings = json.loads(str(truth["input_bindings_json"]))
        snapshot = json.loads(str(proposal_row["snapshot_json"]))
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise ArtifactProposalReviewConflictError(
            "ArtifactProposal workflow intent is not canonical"
        ) from error
    if (
        canonical_snapshot_json(graph) != str(truth["graph_json"])
        or canonical_snapshot_json(input_bindings) != str(truth["input_bindings_json"])
        or canonical_snapshot_json(snapshot) != str(proposal_row["snapshot_json"])
        or intent_project_id != intent.project_id
        or intent_agent_run_id != intent.agent_run_id
        or intent.project_id != str(proposal_row["project_id"])
        or intent.agent_run_id != producer_agent_run_id
        or intent.skill_run_id != producer_skill_run_id
        or intent.context_manifest_id != context_manifest_id
        or intent.definition_id != str(truth["definition_id"])
        or intent.definition_version != int(truth["definition_version"])
        or intent.definition_hash != str(truth["definition_hash"])
        or intent.graph != graph
        or intent.workflow_input_hash != str(truth["workflow_input_hash"])
        or intent.node_key != str(truth["node_key"])
        or intent.node_type != str(truth["node_type"])
        or intent.contract_version != int(truth["contract_version"])
        or intent.input_bindings != input_bindings
        or intent.node_input_hash != str(truth["current_node_input_hash"])
        or intent.request_fingerprint != str(proposal_row["attempt_request_fingerprint"])
        or intent.execution_idempotency_key != str(truth["current_node_idempotency_key"])
        or intent.max_attempts != int(truth["max_attempts"])
        or intent.task_kind != str(truth["task_kind"])
        or intent.priority != int(truth["priority"])
        or intent.attempt_snapshot != snapshot
        or producer_attempt_id != str(proposal_row["producer_attempt_id"])
    ):
        raise ArtifactProposalReviewConflictError(
            "ArtifactProposal is detached from its immutable enqueue intent"
        )
