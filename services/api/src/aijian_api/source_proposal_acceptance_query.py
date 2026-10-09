"""Read the immutable acceptance binding for one SourceExtraction draft version."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from datetime import datetime
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from aijian_api.contracts import (
    CONTENT_HASH_PATTERN,
    PROJECT_ID_PATTERN,
    PROPOSAL_ID_PATTERN,
    VERSION_ID_PATTERN,
    ErrorBody,
    ErrorResponse,
)
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.source_extraction_routes import (
    SourceExtractionInconsistentError,
    _validated_data,
)

type RepositoryProvider = Callable[[], StudioRepository]


class SourceProposalAcceptanceNotFoundError(LookupError):
    pass


class SourceProposalAcceptanceInconsistentError(RuntimeError):
    pass


class SourceProposalAcceptanceStorageError(RuntimeError):
    pass


class SourceProposalAcceptanceData(BaseModel):
    """An accepted proposal created this project-scoped draft version."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    acceptance_id: str = Field(pattern=r"^pda_[0-9a-f]{32}$")
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    source_extraction_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    source_extraction_content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    proposal_id: str = Field(pattern=PROPOSAL_ID_PATTERN)
    accepted_as_draft_at: datetime
    latest_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    latest_head_revision: int = Field(ge=1)
    current: bool


class SourceProposalAcceptanceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    data: SourceProposalAcceptanceData
    request_id: UUID


def read_source_proposal_acceptance(
    repository: StudioRepository, *, project_id: str, version_id: str
) -> SourceProposalAcceptanceData:
    """Use one read snapshot and verify the complete SourceExtraction lineage."""

    try:
        with repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            row = connection.execute(
                """
                SELECT acceptance.acceptance_id, acceptance.project_id,
                       acceptance.proposal_id, acceptance.proposal_hash,
                       acceptance.accepted_as_draft_at,
                       version.version_id, version.content_hash,
                       proposal.proposal_hash AS stored_proposal_hash
                FROM artifact_versions AS version
                JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
                LEFT JOIN artifact_proposal_draft_acceptances AS acceptance
                  ON acceptance.draft_version_id = version.version_id
                LEFT JOIN agent_artifact_proposals AS proposal
                  ON proposal.proposal_id = acceptance.proposal_id
                WHERE artifact.project_id = ? AND artifact.episode_id IS NULL
                  AND artifact.artifact_type = 'source_extraction'
                  AND version.version_id = ?
                """,
                (project_id, version_id),
            ).fetchone()
            if row is None or row["acceptance_id"] is None:
                raise SourceProposalAcceptanceNotFoundError(
                    "Accepted SourceExtraction draft was not found"
                )
            if (
                row["project_id"] != project_id
                or row["stored_proposal_hash"] is None
                or row["proposal_hash"] != row["stored_proposal_hash"]
            ):
                raise SourceProposalAcceptanceInconsistentError(
                    "Source proposal acceptance is inconsistent"
                )
            try:
                record = repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project_id,
                    artifact_type="source_extraction",
                    version_id=version_id,
                )
                verified = _validated_data(connection, project_id, record)
                if (
                    verified.version.id != version_id
                    or verified.version.content_hash != row["content_hash"]
                    or verified.provenance.proposal_id != row["proposal_id"]
                ):
                    raise SourceProposalAcceptanceInconsistentError(
                        "Source proposal acceptance changed its version binding"
                    )
                result = SourceProposalAcceptanceData(
                    acceptance_id=str(row["acceptance_id"]),
                    project_id=project_id,
                    source_extraction_version_id=version_id,
                    source_extraction_content_hash=str(row["content_hash"]),
                    proposal_id=str(row["proposal_id"]),
                    accepted_as_draft_at=datetime.fromisoformat(
                        str(row["accepted_as_draft_at"]).replace("Z", "+00:00")
                    ),
                    latest_version_id=verified.head.latest_version_id,
                    latest_head_revision=verified.head.revision,
                    current=verified.head.latest_version_id == version_id,
                )
            except (
                ArtifactConflictError,
                SourceExtractionInconsistentError,
                ValidationError,
                ValueError,
                TypeError,
                KeyError,
                UnicodeError,
            ) as error:
                raise SourceProposalAcceptanceInconsistentError(
                    "Source proposal acceptance failed verified readback"
                ) from error
            connection.commit()
            return result
    except sqlite3.DatabaseError as error:
        raise SourceProposalAcceptanceStorageError(
            "Source proposal acceptance read failed safely"
        ) from error


def create_source_proposal_acceptance_query_router(
    repository_provider: RepositoryProvider,
) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        404: {"description": "Acceptance or version not found", "model": ErrorResponse},
        409: {"description": "Persisted acceptance is inconsistent", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
        500: {"description": "Acceptance read failed safely", "model": ErrorResponse},
    }

    def error_response(
        request: Request, *, status_code: int, code: str, message: str
    ) -> JSONResponse:
        envelope = ErrorResponse(
            error=ErrorBody(code=code, message=message, details={}, retryable=False),
            request_id=cast(UUID, request.state.request_id),
        )
        return JSONResponse(status_code=status_code, content=envelope.model_dump(mode="json"))

    @router.get(
        "/api/v1/projects/{project_id}/source-extraction/versions/{version_id}/proposal-acceptance",
        operation_id="getSourceProposalAcceptanceForVersion",
        response_model=SourceProposalAcceptanceResponse,
        responses=errors,
    )
    def get_acceptance(
        request: Request,
        response: Response,
        project_id: str = Path(pattern=PROJECT_ID_PATTERN),
        version_id: str = Path(pattern=VERSION_ID_PATTERN),
    ) -> SourceProposalAcceptanceResponse | JSONResponse:
        try:
            data = read_source_proposal_acceptance(
                repository_provider(), project_id=project_id, version_id=version_id
            )
        except SourceProposalAcceptanceNotFoundError:
            return error_response(
                request,
                status_code=404,
                code="SOURCE_PROPOSAL_ACCEPTANCE_NOT_FOUND",
                message="Accepted SourceExtraction draft was not found",
            )
        except SourceProposalAcceptanceInconsistentError:
            return error_response(
                request,
                status_code=409,
                code="SOURCE_PROPOSAL_ACCEPTANCE_INCONSISTENT",
                message="Stored acceptance binding is inconsistent",
            )
        except SourceProposalAcceptanceStorageError:
            return error_response(
                request,
                status_code=500,
                code="SOURCE_PROPOSAL_ACCEPTANCE_STORAGE_FAILED",
                message="Acceptance read failed safely",
            )
        response.headers["ETag"] = f'"{data.source_extraction_content_hash}"'
        return SourceProposalAcceptanceResponse(
            data=data, request_id=cast(UUID, request.state.request_id)
        )

    return router
