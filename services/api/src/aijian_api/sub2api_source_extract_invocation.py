"""Rebuild the exact approved source span for a queued Sub2API attempt."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from aijian_api.agent_run_store import AgentRunStore
from aijian_api.agent_skill_builtins import (
    SOURCE_ANALYST_SUB2API_REF,
    SOURCE_EXTRACT_SUB2API_REF,
)
from aijian_api.agent_skill_contracts import AttemptSnapshotV1, canonical_sha256
from aijian_api.provider_connection_repository import ProviderConnectionRepository
from aijian_api.provider_contracts import sub2api_origin_binding
from aijian_api.repository import StudioRepository
from aijian_api.source_extract_run_factory import resolve_source_extract_context
from aijian_api.source_extract_worker import FakeSourceExtractInvocationV1
from aijian_api.sub2api_source_extract_run_factory import (
    Sub2APISourceExtractEnqueueIntentV1,
)
from aijian_api.task_ledger_models import ClaimedTask


class Sub2APISourceExtractInvocationBuilder:
    """Use one persisted intent and current accepted SourceManifest; no Provider IO."""

    def __init__(self, database_path: Path) -> None:
        self._repository = StudioRepository(database_path)
        self._agent_runs = AgentRunStore(database_path)
        self._connections = ProviderConnectionRepository(database_path)

    def __call__(
        self, snapshot: AttemptSnapshotV1, running: ClaimedTask
    ) -> FakeSourceExtractInvocationV1:
        if running.attempt_id != snapshot.attempt_id:
            raise PermissionError("Sub2API lease is detached from the attempt snapshot")
        persisted = self._agent_runs.get_with_intent(snapshot.project_id, snapshot.agent_run_id)
        intent_record = persisted.enqueue_intent
        if intent_record is None:
            raise PermissionError("Sub2API enqueue intent is missing")
        intent = Sub2APISourceExtractEnqueueIntentV1.model_validate(intent_record.payload)
        scope = intent.sub2api_scope
        source = scope.source
        selection = scope.selection
        bundle = persisted.bundle
        if (
            intent.project_id != snapshot.project_id
            or intent.agent_run_id != snapshot.agent_run_id
            or intent.skill_run_id != snapshot.skill_run_id
            or running.task_kind != "sub2api.source.extract"
            or intent.task_kind != running.task_kind
            or intent.max_attempts != 1
            or intent.attempt_snapshot != snapshot.model_dump(mode="json", exclude={"attempt_id"})
            or intent.request_fingerprint != snapshot.attempt_fingerprint
            or intent.node_input_hash != snapshot.input_hash
            or intent.workflow_input_hash != snapshot.input_hash
            or intent.execution_idempotency_key != snapshot.idempotency_key
            or intent.context_manifest_id != bundle.context_manifest.context_manifest_id
            or scope.context_manifest_id != intent.context_manifest_id
            or scope.context_manifest_hash != bundle.context_manifest.manifest_hash
            or scope.input_hash != snapshot.input_hash
            or snapshot.provider_connection_id != selection.connection_id
            or snapshot.model_id != selection.model_id
            or source.agent_definition != SOURCE_ANALYST_SUB2API_REF
            or source.skill_definition != SOURCE_EXTRACT_SUB2API_REF
            or bundle.agent_run.agent_run_id != snapshot.agent_run_id
            or bundle.agent_run.project_id != snapshot.project_id
            or bundle.agent_run.status != "RUNNING"
            or bundle.context_manifest.project_id != snapshot.project_id
            or bundle.context_manifest.agent_definition != SOURCE_ANALYST_SUB2API_REF
            or bundle.context_manifest.skill_definition != SOURCE_EXTRACT_SUB2API_REF
            or bundle.skill_run.skill_run_id != snapshot.skill_run_id
            or bundle.skill_run.agent_run_id != snapshot.agent_run_id
            or bundle.skill_run.status != "RUNNING"
            or bundle.skill_run.proposal_id is not None
            or bundle.agent_run.agent_definition != SOURCE_ANALYST_SUB2API_REF
            or bundle.skill_run.skill_definition != SOURCE_EXTRACT_SUB2API_REF
        ):
            raise PermissionError("Sub2API source context is detached from queued truth")
        connection = self._connections.get(selection.connection_id)
        if connection.origin_mode is None:
            raise PermissionError("Sub2API provider origin mode is missing")
        origin_hash = canonical_sha256(
            sub2api_origin_binding(
                connection.base_url, connection.origin_mode, connection.revision
            )
        )
        if (
            connection.provider_kind != "SUB2API"
            or not connection.enabled
            or connection.revision != selection.connection_revision
            or connection.origin_mode != scope.origin_mode
            or origin_hash != scope.origin_hash
            or not any(
                model.model_id == selection.model_id and model.capabilities == ("TEXT",)
                for model in connection.models
            )
        ):
            raise PermissionError("Sub2API provider binding changed")
        expected_input_hash = canonical_sha256(
            {
                "project_id": snapshot.project_id,
                **source.model_dump(mode="json"),
                "selection": selection.model_dump(mode="json"),
                "origin_hash": origin_hash,
                "context_manifest_hash": bundle.context_manifest.manifest_hash,
            }
        )
        if expected_input_hash != snapshot.input_hash:
            raise PermissionError("Sub2API input hash changed")
        approved, source_span = resolve_source_extract_context(
            self._repository, project_id=snapshot.project_id, payload=source
        )
        try:
            approved_metadata = json.loads(approved.content)
        except json.JSONDecodeError as error:
            raise PermissionError("accepted SourceManifest metadata is invalid") from error
        excerpt_sha256 = (
            "sha256:" + hashlib.sha256(source_span.content.encode("utf-8")).hexdigest()
        )
        entries = bundle.context_manifest.entries
        source_entries = [entry for entry in entries if entry.kind == "SOURCE_SPAN"]
        approved_entries = [entry for entry in entries if entry.kind == "APPROVED_ARTIFACT"]
        if (
            not isinstance(approved_metadata, dict)
            or approved_metadata.get("version_id") != source.source_manifest_version_id
            or approved_metadata.get("content_hash") != scope.accepted_manifest_content_hash
            or source_span.ref != f"source:{scope.source_span_id}"
            or excerpt_sha256 != scope.excerpt_sha256
            or len(source_span.content.encode("utf-8")) != source.end_byte - source.start_byte
            or len(source_entries) != 1
            or source_entries[0].ref != source_span.ref
            or source_entries[0].version != source_span.version
            or source_entries[0].content_hash != excerpt_sha256
            or source_entries[0].byte_count != source.end_byte - source.start_byte
            or len(approved_entries) != 1
            or approved_entries[0].ref != approved.ref
            or approved_entries[0].version != approved.version
        ):
            raise PermissionError("Sub2API source span no longer matches the accepted manifest")
        return FakeSourceExtractInvocationV1(
            project_id=snapshot.project_id,
            agent_run_id=snapshot.agent_run_id,
            skill_run_id=snapshot.skill_run_id,
            attempt_id=snapshot.attempt_id,
            source_manifest_version_id=source.source_manifest_version_id,
            source_document_id=source.source_document_id,
            source_block_id=source.source_block_id,
            start_byte=source.start_byte,
            end_byte=source.end_byte,
            source_span_id=scope.source_span_id,
            excerpt=source_span.content,
        )
