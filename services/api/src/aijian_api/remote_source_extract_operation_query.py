"""One-snapshot readback of the original remote SourceExtraction operation."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from pydantic import ValidationError

from aijian_api.agent_run_store import (
    AgentRunBundleConflictError,
    read_proposal_run_enqueue_intent_in_connection,
)
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.remote_call_accounting import (
    RemoteCallAccountingData,
    RemoteCallAccountingError,
    read_call_accounting_in_connection,
)
from aijian_api.remote_execution_authorization import RemoteDispatchSnapshotDraft
from aijian_api.remote_settlement_contracts import RemoteSettlementVerifier
from aijian_api.remote_source_extract_operation_contracts import (
    RemoteSourceExtractOperationData,
    RemoteSourceExtractOperationSelectionData,
    RemoteSourceExtractOperationSourceData,
    RemoteSourceExtractOperationTaskData,
)
from aijian_api.repository import StudioRepository
from aijian_api.source_extract_run_factory import RemoteSourceExtractEnqueueIntentV1


class RemoteSourceExtractOperationNotFoundError(LookupError):
    """The run does not belong to this project or is not a remote extract run."""


class RemoteSourceExtractOperationInconsistentError(RuntimeError):
    """A persisted operation link or result is internally inconsistent."""


def _source(intent: RemoteSourceExtractEnqueueIntentV1) -> RemoteSourceExtractOperationSourceData:
    bindings = intent.input_bindings
    return RemoteSourceExtractOperationSourceData.model_validate(
        {
            key: bindings[key]
            for key in (
                "source_manifest_version_id", "source_document_id", "source_block_id",
                "start_byte", "end_byte",
            )
        }
    )


def _selection(
    intent: RemoteSourceExtractEnqueueIntentV1,
) -> RemoteSourceExtractOperationSelectionData:
    dispatch = intent.dispatch_snapshot
    return RemoteSourceExtractOperationSelectionData(
        connection_id=dispatch.connection_id,
        connection_revision=dispatch.connection_revision,
        model_id=dispatch.approved_model_id,
    )


def _read_tracked(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    intent: RemoteSourceExtractEnqueueIntentV1,
    selection: RemoteSourceExtractOperationSelectionData,
    source: RemoteSourceExtractOperationSourceData,
    checked_at: datetime,
    settlement_verifier: RemoteSettlementVerifier | None,
) -> tuple[RemoteSourceExtractOperationTaskData, str | None, RemoteCallAccountingData]:
    key = connection.execute(
        """SELECT workflow_run_id, node_run_id FROM workflow_enqueue_keys
           WHERE project_id = ? AND idempotency_key = ?""",
        (project_id, intent.execution_idempotency_key),
    ).fetchone()
    if key is None:
        raise RemoteSourceExtractOperationInconsistentError
    tracked = connection.execute(
        """SELECT workflow.workflow_run_id, workflow.status AS workflow_status,
                  workflow.project_id, workflow.definition_id, workflow.definition_version,
                  definition.definition_hash, workflow.input_hash,
                  node.node_run_id, node.node_key, node.node_type, node.contract_version,
                  node.idempotency_key, node.input_hash AS node_input_hash,
                  node.status AS node_status, node.active_attempt_id, node.max_attempts,
                  attempt.attempt_id, attempt.status AS attempt_status,
                  attempt.execution_mode, attempt.input_hash AS attempt_input_hash,
                  attempt.request_fingerprint, attempt.provider_response_id
           FROM workflow_runs AS workflow
           JOIN workflow_definitions AS definition
             ON definition.definition_id = workflow.definition_id
            AND definition.version = workflow.definition_version
           JOIN workflow_node_runs AS node
             ON node.workflow_run_id = workflow.workflow_run_id
           LEFT JOIN workflow_attempts AS attempt
             ON attempt.node_run_id = node.node_run_id AND attempt.attempt_number = 1
           WHERE workflow.workflow_run_id = ? AND node.node_run_id = ?""",
        (key["workflow_run_id"], key["node_run_id"]),
    ).fetchone()
    attempt_count = connection.execute(
        "SELECT COUNT(*) FROM workflow_attempts WHERE node_run_id = ?",
        (key["node_run_id"],),
    ).fetchone()[0]
    if (
        tracked is None
        or attempt_count != 1
        or tracked["project_id"] != project_id
        or tracked["definition_id"] != intent.definition_id
        or tracked["definition_version"] != intent.definition_version
        or tracked["definition_hash"] != intent.definition_hash
        or tracked["input_hash"] != intent.workflow_input_hash
        or tracked["node_key"] != intent.node_key
        or tracked["node_type"] != "agent.skill.remote"
        or tracked["contract_version"] != intent.contract_version
        or tracked["max_attempts"] != intent.max_attempts
        or tracked["idempotency_key"] != intent.execution_idempotency_key
        or tracked["node_input_hash"] != intent.node_input_hash
        or tracked["attempt_id"] is None
        or not (
            (
                tracked["node_status"] == "PENDING"
                and tracked["active_attempt_id"] is None
                and tracked["attempt_status"] == "READY"
            )
            or (
                tracked["node_status"] != "PENDING"
                and tracked["active_attempt_id"] == tracked["attempt_id"]
            )
        )
        or tracked["execution_mode"] != "remote"
        or tracked["attempt_input_hash"] != intent.node_input_hash
        or tracked["request_fingerprint"] != intent.request_fingerprint
    ):
        raise RemoteSourceExtractOperationInconsistentError
    attempt_id = str(tracked["attempt_id"])
    tasks = connection.execute(
        """SELECT task_id, status, task_kind FROM task_ledger WHERE attempt_id = ?""",
        (attempt_id,),
    ).fetchall()
    dispatch = connection.execute(
        """SELECT * FROM remote_dispatch_snapshots
           WHERE attempt_id = ? AND project_id = ?""",
        (attempt_id, project_id),
    ).fetchone()
    expected_scope = intent.dispatch_snapshot.scope
    frozen = intent.dispatch_snapshot
    expected_dispatch = RemoteDispatchSnapshotDraft(
        connection_id=frozen.connection_id,
        connection_revision=frozen.connection_revision,
        approved_model_id=frozen.approved_model_id,
        endpoint_binding=frozen.endpoint_binding,
        transport_contract_hash=frozen.transport_contract_hash,
        dispatch_class=frozen.dispatch_class,
        requested_additional_budget_micros=frozen.requested_additional_budget_micros,
        approved_currency=frozen.approved_currency,
        policy_version=frozen.policy_version,
        context_manifest_id=frozen.context_manifest_id,
        context_manifest_hash=frozen.context_manifest_hash,
        scope=expected_scope,
    )
    if (
        len(tasks) != 1
        or tasks[0]["task_kind"] != "remote.source.extract"
        or dispatch is None
        or dispatch["operation"] != "remote.source.extract"
        or dispatch["connection_id"] != selection.connection_id
        or dispatch["connection_revision"] != selection.connection_revision
        or dispatch["approved_model_id"] != selection.model_id
        or dispatch["context_manifest_id"] != intent.context_manifest_id
        or dispatch["context_manifest_hash"] != intent.dispatch_snapshot.context_manifest_hash
        or dispatch["input_scope_hash"] != canonical_sha256(expected_scope)
        or dispatch["snapshot_hash"] != expected_dispatch.snapshot_hash(
            project_id=project_id, attempt_id=attempt_id
        )
        or dispatch["endpoint_binding"] != frozen.endpoint_binding
        or dispatch["transport_contract_hash"] != frozen.transport_contract_hash
        or dispatch["scope_kind"] != frozen.dispatch_class
        or dispatch["requested_additional_budget_micros"] != (
            frozen.requested_additional_budget_micros
        )
        or dispatch["approved_currency"] != frozen.approved_currency
        or dispatch["policy_version"] != frozen.policy_version
        or json.loads(str(dispatch["scope_json"])) != expected_scope
        or expected_scope.get("input_hash") != intent.workflow_input_hash
        or expected_scope.get("accepted_manifest_version_id") != source.source_manifest_version_id
        or expected_scope.get("source_document_id") != source.source_document_id
        or expected_scope.get("source_block_ids") != [source.source_block_id]
        or expected_scope.get("span_bounds") != [[source.start_byte, source.end_byte]]
    ):
        raise RemoteSourceExtractOperationInconsistentError
    proposals = connection.execute(
        """SELECT proposal_id, project_id, producer_agent_run_id,
                  producer_skill_run_id, target_artifact_type, proposal_json,
                  proposal_hash FROM agent_artifact_proposals
           WHERE producer_attempt_id = ?""",
        (attempt_id,),
    ).fetchall()
    if len(proposals) > 1:
        raise RemoteSourceExtractOperationInconsistentError
    proposal_id: str | None = None
    if proposals:
        proposal = proposals[0]
        payload = json.loads(str(proposal["proposal_json"]))
        if (
            proposal["project_id"] != project_id
            or proposal["producer_agent_run_id"] != intent.agent_run_id
            or proposal["producer_skill_run_id"] != intent.skill_run_id
            or proposal["target_artifact_type"] != "SourceExtraction"
            or not isinstance(payload, dict)
            or payload.get("proposal_id") != proposal["proposal_id"]
            or payload.get("project_id") != project_id
            or payload.get("target_artifact_type") != "SourceExtraction"
            or payload.get("producer_agent_run_id") != intent.agent_run_id
            or payload.get("producer_skill_run_id") != intent.skill_run_id
            or canonical_sha256(payload) != proposal["proposal_hash"]
        ):
            raise RemoteSourceExtractOperationInconsistentError
        proposal_id = str(proposal["proposal_id"])
    accounting = read_call_accounting_in_connection(
        connection,
        project_id=project_id,
        attempt_id=attempt_id,
        checked_at=checked_at,
        settlement_verifier=settlement_verifier,
    )
    task = RemoteSourceExtractOperationTaskData(
        workflow_run_id=str(tracked["workflow_run_id"]),
        workflow_status=str(tracked["workflow_status"]),
        node_run_id=str(tracked["node_run_id"]),
        node_status=str(tracked["node_status"]),
        attempt_id=attempt_id,
        attempt_status=str(tracked["attempt_status"]),
        task_id=str(tasks[0]["task_id"]),
        task_status=str(tasks[0]["status"]),
        provider_response_id=tracked["provider_response_id"],
    )
    return task, proposal_id, accounting


def read_remote_source_extract_operation(
    repository: StudioRepository,
    *,
    project_id: str,
    run_id: str,
    settlement_verifier: RemoteSettlementVerifier | None = None,
) -> RemoteSourceExtractOperationData:
    """Return only persisted truth for the exact original enqueue intent."""
    checked_at = datetime.now(timezone.utc)
    with repository._connection() as connection:
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        if connection.execute(
            "SELECT 1 FROM agent_runs WHERE project_id = ? AND agent_run_id = ?",
            (project_id, run_id),
        ).fetchone() is None:
            raise RemoteSourceExtractOperationNotFoundError
        try:
            persisted = read_proposal_run_enqueue_intent_in_connection(
                connection, project_id, run_id
            )
            if persisted.payload.get("task_kind") != "remote.source.extract":
                raise RemoteSourceExtractOperationNotFoundError
            intent = RemoteSourceExtractEnqueueIntentV1.model_validate(persisted.payload)
            if intent.project_id != project_id or intent.agent_run_id != run_id:
                raise RemoteSourceExtractOperationInconsistentError
            source = _source(intent)
            selection = _selection(intent)
            key = connection.execute(
                """SELECT 1 FROM workflow_enqueue_keys
                   WHERE project_id = ? AND idempotency_key = ?""",
                (project_id, intent.execution_idempotency_key),
            ).fetchone()
            task = None
            proposal_id = None
            accounting = None
            if key is not None:
                task, proposal_id, accounting = _read_tracked(
                    connection,
                    project_id=project_id,
                    intent=intent,
                    selection=selection,
                    source=source,
                    checked_at=checked_at,
                    settlement_verifier=settlement_verifier,
                )
            data = RemoteSourceExtractOperationData(
                project_id=project_id,
                run_id=run_id,
                operation_status="TRACKED" if task is not None else "PENDING_ENQUEUE",
                intent_request_hash=persisted.request_hash,
                intent_hash=persisted.intent_hash,
                execution_idempotency_key_hash=canonical_sha256(
                    {"value": intent.execution_idempotency_key}
                ),
                source=source,
                selection=selection,
                task=task,
                proposal_id=proposal_id,
                accounting=accounting,
            )
        except RemoteSourceExtractOperationNotFoundError:
            raise
        except (
            AgentRunBundleConflictError,
            RemoteCallAccountingError,
            ValidationError,
            ValueError,
            TypeError,
            KeyError,
            sqlite3.Error,
        ) as error:
            raise RemoteSourceExtractOperationInconsistentError from error
        connection.commit()
        return data
