"""Project-scoped, read-only access to accepted SourceExtraction proposal drafts."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from aijian_api.agent_skill_builtins import SourceExtractionPayloadV1
from aijian_api.artifacts import canonical_content_hash
from aijian_api.contracts import (
    PROJECT_ID_PATTERN,
    VERSION_ID_PATTERN,
    ArtifactHeadData,
    ErrorBody,
    ErrorResponse,
)
from aijian_api.domain import ArtifactVersionRecord
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.source_extraction_contracts import (
    SourceExtractionDependencyData,
    SourceExtractionProvenanceData,
    SourceExtractionReadData,
    SourceExtractionResponse,
    SourceExtractionSourceSpanData,
    SourceExtractionVersionData,
)
from aijian_api.source_manifest import SourceManifestContentV1

type RepositoryProvider = Callable[[], StudioRepository]


class SourceExtractionNotFoundError(LookupError):
    """No SourceExtraction exists for the requested project and version."""


class SourceExtractionInconsistentError(RuntimeError):
    """Stored draft, producer, source, or dependency truth is inconsistent."""


def _error(request: Request, *, status: int, code: str, message: str) -> JSONResponse:
    envelope = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=cast(UUID, request.state.request_id),
    )
    return JSONResponse(status_code=status, content=envelope.model_dump(mode="json"))


def _read(
    repository: StudioRepository, project_id: str, version_id: str | None
) -> SourceExtractionReadData:
    latest_requested = version_id is None
    # Repository connection uses the same schema/timeout as writes; query_only and
    # BEGIN keep this entire multi-table read in one non-mutating SQLite snapshot.
    with repository._connection() as connection:
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        if connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone() is None:
            raise SourceExtractionNotFoundError
        if version_id is None:
            latest = connection.execute(
                """SELECT head.latest_version_id
                   FROM artifacts AS artifact
                   JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
                   WHERE artifact.project_id = ? AND artifact.artifact_type = 'source_extraction'""",
                (project_id,),
            ).fetchone()
            if latest is None:
                raise SourceExtractionNotFoundError
            version_id = str(latest["latest_version_id"])
        version_exists = connection.execute(
            """SELECT 1 FROM artifact_versions AS version
               JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
               WHERE artifact.project_id = ? AND artifact.artifact_type = 'source_extraction'
                 AND version.version_id = ?""",
            (project_id, version_id),
        ).fetchone()
        if version_exists is None:
            if latest_requested:
                raise SourceExtractionInconsistentError
            raise SourceExtractionNotFoundError
        try:
            record = repository._get_artifact_version_in_connection(
                connection,
                project_id=project_id,
                artifact_type="source_extraction",
                version_id=version_id,
            )
        except ArtifactConflictError as error:
            raise SourceExtractionInconsistentError from error
        except (RuntimeError, ValidationError, ValueError, TypeError, KeyError) as error:
            raise SourceExtractionInconsistentError from error
        try:
            data = _validated_data(connection, project_id, record)
        except (ValidationError, ValueError, TypeError, KeyError, UnicodeError) as error:
            raise SourceExtractionInconsistentError from error
        connection.commit()
        return data


def _validated_data(
    connection: sqlite3.Connection, project_id: str, record: ArtifactVersionRecord
) -> SourceExtractionReadData:
    version = record.version
    if (
        record.head.artifact_id != version.artifact_id
        or not isinstance(version.content, dict)
        or canonical_content_hash(version.content) != version.content_hash
        or version.schema_version != "1.0.0"
    ):
        raise SourceExtractionInconsistentError
    content = SourceExtractionPayloadV1.model_validate(version.content)

    lineage = connection.execute(
        """SELECT version.producer_attempt_id AS version_attempt_id,
                  version.author_actor_type, version.author_actor_id,
                  acceptance.project_id AS acceptance_project_id,
                  acceptance.proposal_id AS acceptance_proposal_id,
                  acceptance.proposal_hash AS acceptance_proposal_hash,
                  proposal.project_id AS proposal_project_id,
                  proposal.producer_attempt_id AS proposal_attempt_id,
                  proposal.producer_skill_run_id, proposal.target_artifact_type,
                  proposal.proposal_hash, proposal.proposal_json
           FROM artifact_versions AS version
           LEFT JOIN artifact_proposal_draft_acceptances AS acceptance
             ON acceptance.draft_version_id = version.version_id
           LEFT JOIN agent_artifact_proposals AS proposal
             ON proposal.proposal_id = acceptance.proposal_id
           WHERE version.version_id = ? AND version.artifact_id = ?""",
        (version.id, version.artifact_id),
    ).fetchone()
    if lineage is None:
        raise SourceExtractionInconsistentError
    proposal_payload = json.loads(str(lineage["proposal_json"]))
    if (
        not isinstance(proposal_payload, dict)
        or lineage["version_attempt_id"] is None
        or lineage["acceptance_proposal_id"] is None
        or lineage["proposal_attempt_id"] != lineage["version_attempt_id"]
        or lineage["acceptance_project_id"] != project_id
        or lineage["proposal_project_id"] != project_id
        or lineage["proposal_hash"] != lineage["acceptance_proposal_hash"]
        or lineage["target_artifact_type"] != "SourceExtraction"
        or lineage["author_actor_type"] != "agent"
        or lineage["author_actor_id"] != lineage["producer_skill_run_id"]
        or proposal_payload.get("proposal_id") != lineage["acceptance_proposal_id"]
        or proposal_payload.get("project_id") != project_id
        or proposal_payload.get("target_artifact_type") != "SourceExtraction"
        or proposal_payload.get("producer_skill_run_id") != lineage["producer_skill_run_id"]
        or proposal_payload.get("payload_hash") != version.content_hash
        or proposal_payload.get("payload") != version.content
        or canonical_content_hash(proposal_payload) != lineage["proposal_hash"]
    ):
        raise SourceExtractionInconsistentError

    if len(record.dependencies) != 1 or not record.source_spans:
        raise SourceExtractionInconsistentError
    dependency = record.dependencies[0]
    proposal_dependencies = proposal_payload.get("dependencies")
    if proposal_dependencies != [
        {
            "artifact_type": "SourceManifest",
            "version_id": dependency.upstream_version_id,
            "approval_required": True,
        }
    ]:
        raise SourceExtractionInconsistentError
    upstream = connection.execute(
        """SELECT artifact.project_id, artifact.artifact_type,
                  version.artifact_id, version.content_json, version.content_hash
           FROM artifact_versions AS version
           JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
           WHERE version.version_id = ?""",
        (dependency.upstream_version_id,),
    ).fetchone()
    if (
        upstream is None
        or dependency.downstream_artifact_id != version.artifact_id
        or dependency.downstream_version_id != version.id
        or dependency.upstream_artifact_id != upstream["artifact_id"]
        or dependency.relationship != "derived_from"
        or dependency.impact != "blocking"
        or upstream["project_id"] != project_id
        or upstream["artifact_type"] != "source_manifest"
    ):
        raise SourceExtractionInconsistentError
    manifest_json = str(upstream["content_json"])
    manifest_content = json.loads(manifest_json)
    if canonical_content_hash(manifest_content) != upstream["content_hash"]:
        raise SourceExtractionInconsistentError
    manifest = SourceManifestContentV1.model_validate(manifest_content)
    manifest_documents = {item.source_document_id: item for item in manifest.documents}
    proposal_spans = proposal_payload.get("source_spans")
    if not isinstance(proposal_spans, list) or len(proposal_spans) != len(record.source_spans):
        raise SourceExtractionInconsistentError
    proposal_spans_by_id = {
        span.get("source_span_id"): span
        for span in proposal_spans
        if isinstance(span, dict)
    }
    if len(proposal_spans_by_id) != len(record.source_spans):
        raise SourceExtractionInconsistentError

    spans: list[SourceExtractionSourceSpanData] = []
    for span in record.source_spans:
        source = connection.execute(
            """SELECT source.normalized_text, source.raw_sha256,
                      block.normalized_start_byte, block.normalized_end_byte
               FROM source_documents AS source
               JOIN source_blocks AS block
                 ON block.source_document_id = source.id AND block.project_id = source.project_id
               WHERE source.project_id = ? AND source.id = ? AND block.id = ?""",
            (project_id, span.source_document_id, span.source_block_id),
        ).fetchone()
        manifest_document = manifest_documents.get(span.source_document_id)
        proposal_span = proposal_spans_by_id.get(span.fact_id)
        if (
            span.project_id != project_id
            or span.artifact_id != version.artifact_id
            or span.version_id != version.id
            or source is None
            or manifest_document is None
            or span.source_block_id not in {
                block.source_block_id for block in manifest_document.blocks
            }
            or proposal_span is None
            or proposal_span.get("source_document_id") != span.source_document_id
            or proposal_span.get("source_block_id") != span.source_block_id
            or proposal_span.get("start_byte") != span.start_byte
            or proposal_span.get("end_byte") != span.end_byte
            or proposal_span.get("claim") != span.claim
            or proposal_span.get("quote_hash") != span.quote_hash
            or manifest_document.raw_sha256 != source["raw_sha256"]
            or not (
                int(source["normalized_start_byte"])
                <= span.start_byte
                < span.end_byte
                <= int(source["normalized_end_byte"])
            )
        ):
            raise SourceExtractionInconsistentError
        quote = str(source["normalized_text"]).encode("utf-8")[span.start_byte : span.end_byte]
        quote.decode("utf-8")
        if f"sha256:{hashlib.sha256(quote).hexdigest()}" != span.quote_hash:
            raise SourceExtractionInconsistentError
        spans.append(
            SourceExtractionSourceSpanData(
                id=span.id,
                fact_id=span.fact_id,
                source_document_id=span.source_document_id,
                source_block_id=span.source_block_id,
                role=span.role,
                start_byte=span.start_byte,
                end_byte=span.end_byte,
                claim=span.claim,
                quote_hash=span.quote_hash,
            )
        )

    return SourceExtractionReadData(
        project_id=project_id,
        head=ArtifactHeadData.model_validate(record.head),
        version=SourceExtractionVersionData(
            id=version.id,
            artifact_id=version.artifact_id,
            version_number=version.version_number,
            schema_version="1.0.0",
            content=content,
            content_hash=version.content_hash,
            parent_version_id=version.parent_version_id,
            change_summary=version.change_summary,
            created_at=version.created_at,
        ),
        source_spans=spans,
        dependencies=[
            SourceExtractionDependencyData(
                upstream_version_id=dependency.upstream_version_id,
                relationship=dependency.relationship,
                impact=dependency.impact,
            )
        ],
        provenance=SourceExtractionProvenanceData(
            producer_attempt_id=str(lineage["version_attempt_id"]),
            proposal_id=str(lineage["acceptance_proposal_id"]),
        ),
    )


def create_source_extraction_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        404: {"description": "SourceExtraction not found", "model": ErrorResponse},
        409: {"description": "SourceExtraction truth is inconsistent", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    def response_for(
        request: Request, response: Response, project_id: str, version_id: str | None
    ) -> SourceExtractionResponse | JSONResponse:
        try:
            data = _read(repository_provider(), project_id, version_id)
        except SourceExtractionNotFoundError:
            return _error(
                request, status=404, code="SOURCE_EXTRACTION_NOT_FOUND",
                message="The requested SourceExtraction was not found",
            )
        except SourceExtractionInconsistentError:
            return _error(
                request, status=409, code="SOURCE_EXTRACTION_INCONSISTENT",
                message="The stored SourceExtraction is inconsistent",
            )
        response.headers["ETag"] = (
            f'"revision-{data.head.revision}"'
            if version_id is None
            else f'"{data.version.content_hash}"'
        )
        return SourceExtractionResponse(
            data=data, request_id=cast(UUID, request.state.request_id)
        )

    @router.get(
        "/api/v1/projects/{project_id}/source-extraction",
        operation_id="getSourceExtraction",
        response_model=SourceExtractionResponse,
        responses=errors,
    )
    def get_source_extraction(
        request: Request, response: Response,
        project_id: str = Path(pattern=PROJECT_ID_PATTERN),
    ) -> SourceExtractionResponse | JSONResponse:
        return response_for(request, response, project_id, None)

    @router.get(
        "/api/v1/projects/{project_id}/source-extraction/versions/{version_id}",
        operation_id="getSourceExtractionVersion",
        response_model=SourceExtractionResponse,
        responses=errors,
    )
    def get_source_extraction_version(
        request: Request, response: Response,
        project_id: str = Path(pattern=PROJECT_ID_PATTERN),
        version_id: str = Path(pattern=VERSION_ID_PATTERN),
    ) -> SourceExtractionResponse | JSONResponse:
        return response_for(request, response, project_id, version_id)

    return router
