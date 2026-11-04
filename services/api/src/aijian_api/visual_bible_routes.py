"""Read-only G5 state and native authenticated explicit writes, no execution."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from itertools import permutations
from typing import Annotated, Any

from fastapi import APIRouter, Header, Path, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from aijian_api.artifacts import canonical_content_hash
from aijian_api.contracts import ArtifactHeadData, ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactNotFoundError,
    GateNotReadyError,
    ProjectNotFoundError,
    ReviewInvalidError,
    StudioRepository,
)
from aijian_api.source_manifest_routes import _expected_revision, _set_revision_etag
from aijian_api.visual_bible_authority import visual_authority
from aijian_api.visual_bible_contracts import (
    CreateVisualBibleVersionRequest,
    VisualBibleAuthorityData,
    VisualBibleAuthorityResponse,
    VisualBibleHistoryResponse,
    VisualBibleIndexResponse,
    VisualBibleReadinessData,
    VisualBibleReadinessResponse,
    VisualBibleSaveOperationData,
    VisualBibleSaveOperationResponse,
    VisualBibleVersionResponse,
    VisualImageInspectionInput,
    VisualImageInspectionResponse,
    VisualReviewActionInput,
    VisualReviewConfirmationInput,
)
from aijian_api.visual_bible_integrity import visual_version
from aijian_api.visual_bible_store import VisualBibleConflictError, VisualBibleStore
from aijian_api.visual_media_inspection_store import VisualMediaInspectionStore
from aijian_api.visual_review_contracts import (
    VisualConfirmationChallengeData,
    VisualGateDecisionData,
    VisualGateReadinessReportData,
    VisualPreparedReviewActionData,
    VisualPreparedReviewActionResponse,
    VisualReviewOperationData,
    VisualReviewOperationResponse,
    VisualReviewStateData,
    VisualReviewStateResponse,
    VisualReviewSubmissionData,
    VisualRoleSignoffData,
)

ProjectId = Annotated[str, Path(pattern=r"^prj_[0-9a-f]{32}$")]
VersionId = Annotated[str, Path(pattern=r"^ver_[0-9a-f]{32}$")]
AssetId = Annotated[str, Path(pattern=r"^asset_[0-9a-f]{32}$")]
AssetVersionId = Annotated[str, Path(pattern=r"^asv_[0-9a-f]{32}$")]
ChallengeId = Annotated[str, Path(pattern=r"^chg_[0-9a-f]{32}$")]
InspectionOperationId = Annotated[str, Path(pattern=r"^vinop_[0-9a-f]{32}$")]
type RepositoryProvider = Callable[[], StudioRepository]
ERRORS: dict[int | str, dict[str, Any]] = {
    code: {"description": "G5 boundary/integrity/precondition rejection", "model": ErrorResponse}
    for code in (401, 403, 404, 409, 412, 422, 428, 500)
}


def safe[T](
    request: Request, operation: Callable[[], T], *, read: bool = False
) -> T | JSONResponse:
    try:
        return operation()
    except (ArtifactNotFoundError, ProjectNotFoundError):
        code, status_code = "VISUAL_NOT_FOUND", 404
    except (VisualBibleConflictError, ArtifactConflictError, ReviewInvalidError, GateNotReadyError):
        code, status_code = (
            ("VISUAL_INTEGRITY_UNKNOWN", 500) if read else ("VISUAL_STATE_CONFLICT", 409)
        )
    except (sqlite3.DatabaseError, ValueError, TypeError, OSError):
        code, status_code = (
            ("VISUAL_INTEGRITY_UNKNOWN", 500) if read else ("VISUAL_INPUT_REJECTED", 422)
        )
    payload = ErrorResponse(
        error=ErrorBody(
            code=code, message="G5操作未通过版本、证据或输入核对。", details={}, retryable=False
        ),
        request_id=request.state.request_id,
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


def from_row[T: BaseModel](model: type[T], row: sqlite3.Row, id_column: str) -> T:
    values = {name: row[name] for name in model.model_fields if name != "id" and name in row.keys()}
    values["id"] = row[id_column]
    return model.model_validate(values)


def validate_operation_receipt(result: VisualReviewOperationData) -> None:
    """Validate immutable receipt integrity without requiring fresh original files."""
    report, challenge = result.report, result.challenge
    if (
        report.report_hash != canonical_content_hash(report.report)
        or report.report.get("content_hash") != result.content_hash
        or report.report.get("policy_snapshot_hash") != result.policy_snapshot_hash
        or report.review_evidence_revision != challenge.review_evidence_revision
        or len(set(result.actor_roles)) != len(result.actor_roles)
        or not set(result.actor_roles) <= {"writer", "continuity_reviewer", "producer"}
    ):
        raise ReviewInvalidError("Operation immutable evidence differs")
    if result.state != "COMPLETED":
        return
    payloads: list[dict[str, object]]
    receipts: list[VisualReviewSubmissionData | VisualRoleSignoffData | VisualGateDecisionData]
    if challenge.action == "submit":
        submission = result.submission
        if (
            submission is None
            or submission.submitted_by_actor_id != result.actor_id
            or submission.submitted_at != challenge.consumed_at
        ):
            raise ReviewInvalidError("Operation submission differs")
        receipts = [submission]
        payloads = [{}]
    elif challenge.action == "signoff":
        roles = [s.role for s in result.signoffs]
        if (
            not 1 <= len(roles) <= 2
            or len(set(roles)) != len(roles)
            or not set(roles) <= {"continuity_reviewer", "producer"}
            or any(
                s.actor_id != result.actor_id
                or s.signed_at != challenge.consumed_at
                or s.submission_id != report.submission_id
                or s.review_evidence_revision != challenge.review_evidence_revision
                for s in result.signoffs
            )
        ):
            raise ReviewInvalidError("Operation signoffs differ")
        receipts = list(result.signoffs)
        # Stored receipts are ordered by role; the original one/two-role input can
        # use either order. Match the bounded permutations against its exact hash.
        payloads = [{"roles": list(order)} for order in permutations(roles)]
    else:
        decision = result.decision
        if (
            decision is None
            or decision.actor_id != result.actor_id
            or decision.actor_role != "producer"
            or decision.decided_at != challenge.consumed_at
            or decision.submission_id != report.submission_id
        ):
            raise ReviewInvalidError("Operation decision differs")
        receipts = [decision]
        payloads = [
            {
                "decision": decision.decision,
                "rationale": decision.rationale,
                "actor_role": decision.actor_role,
            }
        ]
    if any(
        x.artifact_id != challenge.artifact_id
        or x.version_id != challenge.version_id
        or x.gate != "G5"
        or x.readiness_report_id != report.id
        for x in receipts
    ) or not any(
        canonical_content_hash(
            {
                **payload,
                "_actor_id": result.actor_id,
                "_actor_roles": result.actor_roles,
                "_policy_snapshot_hash": result.policy_snapshot_hash,
            }
        )
        == result.action_payload_hash
        for payload in payloads
    ):
        raise ReviewInvalidError("Operation outcome does not match its challenge")


def operation_data(
    repository: StudioRepository,
    project_id: str,
    version_id: str,
    challenge_id: str,
    actor: TrustedReviewActor,
) -> VisualReviewOperationData:
    with repository._connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        record = repository._get_artifact_version_in_connection(
            connection,
            project_id=project_id,
            artifact_type="visual_bible",
            version_id=version_id,
            episode_id=None,
        )
        bible = visual_version(record, project_id)
        policy = repository._gate_policy(
            "visual_bible", content_schema_version=bible.content.schema_version
        )
        row = connection.execute(
            "SELECT * FROM confirmation_challenges WHERE challenge_id=?", (challenge_id,)
        ).fetchone()
        if (
            row is None
            or row["artifact_id"] != bible.artifact_id
            or row["version_id"] != version_id
            or row["gate"] != "G5"
            or row["actor_id"] != actor.subject_id
            or json.loads(str(row["actor_roles_json"])) != list(actor.roles)
        ):
            raise ReviewInvalidError("Review operation scope differs")
        report_row = connection.execute(
            "SELECT * FROM gate_readiness_reports WHERE report_id=?", (row["readiness_report_id"],)
        ).fetchone()
        if report_row is None:
            raise ReviewInvalidError("Operation report is missing")
        report = repository._readiness_report_from_row(report_row)
        if (
            report.artifact_id != bible.artifact_id
            or report.version_id != version_id
            or report.gate != "G5"
            or report.policy_code != policy.policy_code
            or report.policy_version != policy.policy_version
            or report.report.get("policy_snapshot_hash") != policy.snapshot_hash
            or row["policy_snapshot_hash"] != policy.snapshot_hash
        ):
            raise ReviewInvalidError("Operation report scope differs")
        submission = None
        signoffs = []
        decision = None
        consumed = row["consumed_at"] is not None
        if consumed:
            if row["action"] == "submit":
                sub = connection.execute(
                    """SELECT * FROM review_submissions WHERE version_id=? AND gate='G5'
                       AND readiness_report_id=?
                       AND submitted_by_actor_id=? AND submitted_at=?""",
                    (version_id, report.id, actor.subject_id, row["consumed_at"]),
                ).fetchone()
                if sub is None:
                    raise ReviewInvalidError("Consumed submission receipt is missing")
                submission = from_row(VisualReviewSubmissionData, sub, "submission_id")
            elif row["action"] == "signoff":
                rows = connection.execute(
                    """SELECT * FROM role_signoffs WHERE version_id=? AND gate='G5'
                       AND readiness_report_id=?
                       AND actor_id=? AND signed_at=? ORDER BY role""",
                    (version_id, report.id, actor.subject_id, row["consumed_at"]),
                ).fetchall()
                if not rows:
                    raise ReviewInvalidError("Consumed signoff receipt is missing")
                signoffs = [from_row(VisualRoleSignoffData, x, "signoff_id") for x in rows]
            elif row["action"] == "decision":
                dec = connection.execute(
                    "SELECT * FROM gate_decisions WHERE confirmation_challenge_id=?",
                    (challenge_id,),
                ).fetchone()
                if dec is None:
                    raise ReviewInvalidError("Consumed decision receipt is missing")
                decision = from_row(VisualGateDecisionData, dec, "decision_id")
            else:
                raise ReviewInvalidError("Review action is invalid")
        challenge = from_row(VisualConfirmationChallengeData, row, "challenge_id")
        result = VisualReviewOperationData(
            project_id=project_id,
            content_hash=bible.content_hash,
            challenge=challenge,
            action_payload_hash=str(row["action_payload_hash"]),
            actor_id=str(row["actor_id"]),
            actor_roles=json.loads(str(row["actor_roles_json"])),
            policy_snapshot_hash=str(row["policy_snapshot_hash"]),
            report=VisualGateReadinessReportData.model_validate(report),
            terminal_no_write=not consumed and challenge.expires_at <= repository._clock(),
            state="COMPLETED" if consumed else "NOT_CONSUMED",
            result_revision=int(row["head_revision"]) + 1 if consumed else None,
            head=ArtifactHeadData.model_validate(record.head),
            submission=submission,
            signoffs=signoffs,
            decision=decision,
        )
        validate_operation_receipt(result)
        connection.commit()
        return result


def create_visual_bible_public_router(
    provider: RepositoryProvider, actor: TrustedReviewActor
) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/visual-bible/history",
        response_model=VisualBibleHistoryResponse,
        responses=ERRORS,
    )
    def history(
        request: Request,
        response: Response,
        project_id: ProjectId,
        limit: Annotated[int, Query(ge=1, le=20)] = 20,
        cursor: Annotated[str | None, Query(pattern=r"^ver_[0-9a-f]{32}$")] = None,
    ) -> VisualBibleHistoryResponse | JSONResponse:
        result = safe(
            request,
            lambda: VisualBibleStore(provider()).history(project_id, limit=limit, cursor=cursor),
            read=True,
        )
        if isinstance(result, JSONResponse):
            return result
        _set_revision_etag(response, result.head.revision)
        return VisualBibleHistoryResponse(data=result, request_id=request.state.request_id)

    @router.get(
        "/api/v1/projects/{project_id}/visual-bible",
        response_model=VisualBibleIndexResponse,
        responses=ERRORS,
    )
    def index(
        request: Request, response: Response, project_id: ProjectId
    ) -> VisualBibleIndexResponse | JSONResponse:
        result = safe(request, lambda: VisualBibleStore(provider()).index(project_id), read=True)
        if isinstance(result, JSONResponse):
            return result
        _set_revision_etag(response, result.head.revision)
        return VisualBibleIndexResponse(data=result, request_id=request.state.request_id)

    @router.get(
        "/api/v1/projects/{project_id}/visual-bible/save-operations/{save_key}",
        response_model=VisualBibleSaveOperationResponse,
        responses=ERRORS,
    )
    def save_operation(
        request: Request,
        project_id: ProjectId,
        save_key: Annotated[str, Path(pattern=r"^vbsave_[0-9a-f]{32}$")],
    ) -> VisualBibleSaveOperationResponse | JSONResponse:
        def read() -> VisualBibleSaveOperationData:
            from aijian_api.artifacts import canonical_content_hash

            repository = provider()
            with repository._connection() as connection:
                connection.execute("BEGIN")
                key_hash = canonical_content_hash({"value": save_key})
                row = connection.execute(
                    "SELECT * FROM visual_bible_write_requests "
                    "WHERE project_id=? AND idempotency_key_hash=?",
                    (project_id, key_hash),
                ).fetchone()
                if row is None:
                    raise ArtifactNotFoundError("Visual save operation was not found")
                record = repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project_id,
                    artifact_type="visual_bible",
                    version_id=str(row["version_id"]),
                    episode_id=None,
                )
                if record.version.artifact_id != str(row["artifact_id"]):
                    raise ValueError("Visual save receipt ownership changed")
                return VisualBibleSaveOperationData(
                    idempotency_key_hash=key_hash,
                    request_hash=str(row["request_hash"]),
                    result=VisualBibleStore.data(record, project_id),
                )

        result = safe(request, read, read=True)
        if isinstance(result, JSONResponse):
            return result
        return VisualBibleSaveOperationResponse(data=result, request_id=request.state.request_id)

    @router.get(
        "/api/v1/projects/{project_id}/visual-bible/versions/{version_id}",
        response_model=VisualBibleVersionResponse,
        responses=ERRORS,
    )
    def version(
        request: Request, response: Response, project_id: ProjectId, version_id: VersionId
    ) -> VisualBibleVersionResponse | JSONResponse:
        result = safe(
            request,
            lambda: VisualBibleStore(provider()).get_version(project_id, version_id),
            read=True,
        )
        if isinstance(result, JSONResponse):
            return result
        _set_revision_etag(response, result.head.revision)
        return VisualBibleVersionResponse(data=result, request_id=request.state.request_id)

    @router.get(
        "/api/v1/projects/{project_id}/visual-bible/versions/{version_id}/readiness",
        response_model=VisualBibleReadinessResponse,
        responses=ERRORS,
    )
    def readiness(
        request: Request, project_id: ProjectId, version_id: VersionId
    ) -> VisualBibleReadinessResponse | JSONResponse:
        def read() -> VisualBibleReadinessData:
            repository = provider()
            with repository._connection() as connection:
                connection.execute("BEGIN")
                record = repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project_id,
                    artifact_type="visual_bible",
                    version_id=version_id,
                    episode_id=None,
                )
                row = connection.execute(
                    "SELECT * FROM artifact_versions WHERE version_id=?", (version_id,)
                ).fetchone()
                assert row is not None
                report = repository._evaluate_gate_readiness(
                    connection,
                    repository._gate_policy(
                        "visual_bible", content_schema_version=record.version.schema_version
                    ),
                    row,
                    record.version.content,
                )
                from aijian_api.artifacts import canonical_content_hash

                return VisualBibleReadinessData(
                    project_id=project_id,
                    version_id=version_id,
                    content_hash=record.version.content_hash,
                    head=ArtifactHeadData.model_validate(record.head),
                    report=report,
                    report_hash=canonical_content_hash(report),
                )

        result = safe(request, read, read=True)
        if isinstance(result, JSONResponse):
            return result
        return VisualBibleReadinessResponse(data=result, request_id=request.state.request_id)

    @router.get(
        "/api/v1/projects/{project_id}/visual-bible/versions/{version_id}/authority",
        response_model=VisualBibleAuthorityResponse,
        responses=ERRORS,
    )
    def authority(
        request: Request, project_id: ProjectId, version_id: VersionId
    ) -> VisualBibleAuthorityResponse | JSONResponse:
        def read() -> VisualBibleAuthorityData:
            repository = provider()
            with repository._connection() as connection:
                connection.execute("BEGIN")
                return visual_authority(repository, connection, project_id, version_id)

        result = safe(request, read, read=True)
        if isinstance(result, JSONResponse):
            return result
        return VisualBibleAuthorityResponse(data=result, request_id=request.state.request_id)

    @router.get(
        "/api/v1/projects/{project_id}/visual-bible/versions/{version_id}/review-state",
        response_model=VisualReviewStateResponse,
        responses=ERRORS,
    )
    def review_state(
        request: Request, project_id: ProjectId, version_id: VersionId
    ) -> VisualReviewStateResponse | JSONResponse:
        def read() -> VisualReviewStateData:
            repository = provider()
            with repository._connection() as connection:
                connection.execute("BEGIN")
                record = repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project_id,
                    artifact_type="visual_bible",
                    version_id=version_id,
                    episode_id=None,
                )
                bible = visual_version(record, project_id)
                policy = repository._gate_policy(
                    "visual_bible", content_schema_version=bible.content.schema_version
                )
                rows = connection.execute(
                    "SELECT * FROM role_signoffs WHERE version_id=? AND gate='G5' "
                    "ORDER BY review_evidence_revision DESC,signed_at DESC LIMIT 2001",
                    (version_id,),
                ).fetchall()
                if len(rows) > 2000:
                    raise ValueError("G5 review history exceeds read budget")
                signoffs = [from_row(VisualRoleSignoffData, row, "signoff_id") for row in rows]
                reports = []
                for report_id in sorted({x.readiness_report_id for x in signoffs}):
                    report_row = connection.execute(
                        "SELECT * FROM gate_readiness_reports WHERE report_id=?", (report_id,)
                    ).fetchone()
                    if report_row is None:
                        raise ValueError("G5 signed report missing")
                    report = repository._readiness_report_from_row(report_row)
                    if (
                        report.artifact_id != bible.artifact_id
                        or report.version_id != version_id
                        or report.gate != "G5"
                        or report.policy_code != policy.policy_code
                        or report.policy_version != policy.policy_version
                        or report.report.get("policy_snapshot_hash") != policy.snapshot_hash
                    ):
                        raise ValueError("G5 signed report scope mismatch")
                    reports.append(VisualGateReadinessReportData.model_validate(report))
                return VisualReviewStateData(
                    project_id=project_id,
                    version_id=version_id,
                    content_hash=bible.content_hash,
                    head=ArtifactHeadData.model_validate(record.head),
                    signoffs=signoffs,
                    reports=reports,
                )

        result = safe(request, read, read=True)
        if isinstance(result, JSONResponse):
            return result
        return VisualReviewStateResponse(data=result, request_id=request.state.request_id)

    @router.get(
        "/api/v1/projects/{project_id}/visual-bible/versions/{version_id}/review-operations/{challenge_id}",
        response_model=VisualReviewOperationResponse,
        responses=ERRORS,
    )
    def receipt(
        request: Request, project_id: ProjectId, version_id: VersionId, challenge_id: ChallengeId
    ) -> VisualReviewOperationResponse | JSONResponse:
        result = safe(
            request,
            lambda: operation_data(provider(), project_id, version_id, challenge_id, actor),
            read=True,
        )
        if isinstance(result, JSONResponse):
            return result
        return VisualReviewOperationResponse(data=result, request_id=request.state.request_id)

    @router.get(
        "/api/v1/projects/{project_id}/visual-inspections/operations/{operation_id}",
        response_model=VisualImageInspectionResponse,
        responses=ERRORS,
    )
    def inspection_receipt(
        request: Request, project_id: ProjectId, operation_id: InspectionOperationId
    ) -> VisualImageInspectionResponse | JSONResponse:
        result = safe(
            request,
            lambda: VisualMediaInspectionStore(provider()).read_operation(project_id, operation_id),
            read=True,
        )
        if isinstance(result, JSONResponse):
            return result
        return VisualImageInspectionResponse(data=result, request_id=request.state.request_id)

    return router


def action_payload(payload: VisualReviewActionInput) -> dict[str, object]:
    if payload.action == "submit":
        return {}
    if payload.action == "signoff":
        return {"roles": list(payload.roles)}
    return {"decision": payload.decision, "rationale": payload.rationale, "actor_role": "producer"}


def create_visual_bible_write_router(
    provider: RepositoryProvider, actor: TrustedReviewActor
) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/api/v1/projects/{project_id}/visual-bible/versions",
        status_code=201,
        response_model=VisualBibleVersionResponse,
        responses=ERRORS,
    )
    def create(
        request: Request,
        response: Response,
        project_id: ProjectId,
        payload: CreateVisualBibleVersionRequest,
        key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> VisualBibleVersionResponse | JSONResponse:
        if key is None:
            from aijian_api.application_errors import PreconditionRequiredError

            raise PreconditionRequiredError("Idempotency-Key is required")
        result = safe(
            request,
            lambda: VisualBibleStore(provider()).write(
                project_id, payload, idempotency_key=key, actor_id=actor.subject_id
            ),
        )
        if isinstance(result, JSONResponse):
            return result
        saved, replayed = result
        response.status_code = 200 if replayed else 201
        response.headers["Idempotent-Replayed"] = "true" if replayed else "false"
        _set_revision_etag(response, saved.head.revision)
        return VisualBibleVersionResponse(data=saved, request_id=request.state.request_id)

    return router


def create_visual_bible_internal_router(
    provider: RepositoryProvider, actor: TrustedReviewActor
) -> APIRouter:
    router = APIRouter(include_in_schema=False)
    prefix = "/api/v1/internal/projects/{project_id}/visual-bible/versions/{version_id}"

    @router.post(
        prefix + "/review:prepare",
        response_model=VisualPreparedReviewActionResponse,
        responses=ERRORS,
    )
    def prepare(
        request: Request,
        project_id: ProjectId,
        version_id: VersionId,
        payload: VisualReviewActionInput,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> VisualPreparedReviewActionResponse | JSONResponse:
        revision = _expected_revision(if_match)
        result = safe(
            request,
            lambda: provider().prepare_review_action(
                project_id=project_id,
                artifact_type="visual_bible",
                version_id=version_id,
                action=payload.action,
                action_payload=action_payload(payload),
                actor=actor,
                expected_revision=revision,
                readiness_report_id=payload.readiness_report_id,
            ),
        )
        if isinstance(result, JSONResponse):
            return result
        return VisualPreparedReviewActionResponse(
            data=VisualPreparedReviewActionData(
                report=VisualGateReadinessReportData.model_validate(result.report),
                challenge=VisualConfirmationChallengeData.model_validate(result.challenge),
                confirmation_token=result.confirmation_token,
            ),
            request_id=request.state.request_id,
        )

    @router.post(
        prefix + "/review:confirm", response_model=VisualReviewOperationResponse, responses=ERRORS
    )
    def confirm(
        request: Request,
        project_id: ProjectId,
        version_id: VersionId,
        payload: VisualReviewConfirmationInput,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> VisualReviewOperationResponse | JSONResponse:
        revision = _expected_revision(if_match)

        def write() -> None:
            repository = provider()
            if payload.action == "submit":
                repository.submit_artifact_review(
                    project_id=project_id,
                    artifact_type="visual_bible",
                    version_id=version_id,
                    expected_revision=revision,
                    challenge_id=payload.challenge_id,
                    confirmation_token=payload.confirmation_token,
                    actor=actor,
                )
            elif payload.action == "signoff":
                repository.signoff_artifact_review(
                    project_id=project_id,
                    artifact_type="visual_bible",
                    version_id=version_id,
                    expected_revision=revision,
                    challenge_id=payload.challenge_id,
                    confirmation_token=payload.confirmation_token,
                    actor=actor,
                    roles=payload.roles,
                )
            else:
                assert payload.decision is not None and payload.rationale is not None
                repository.decide_artifact_gate(
                    project_id=project_id,
                    artifact_type="visual_bible",
                    version_id=version_id,
                    expected_revision=revision,
                    challenge_id=payload.challenge_id,
                    confirmation_token=payload.confirmation_token,
                    actor=actor,
                    decision=payload.decision,
                    rationale=payload.rationale,
                    actor_role="producer",
                )

        mutation = safe(request, write)
        if isinstance(mutation, JSONResponse):
            return mutation
        result = safe(
            request,
            lambda: operation_data(provider(), project_id, version_id, payload.challenge_id, actor),
            read=True,
        )
        if isinstance(result, JSONResponse):
            return result
        return VisualReviewOperationResponse(data=result, request_id=request.state.request_id)

    @router.post(
        "/api/v1/internal/projects/{project_id}/assets/{asset_id}/versions/{asset_version_id}/visual-inspections",
        status_code=201,
        response_model=VisualImageInspectionResponse,
        responses=ERRORS,
    )
    def inspect(
        request: Request,
        response: Response,
        project_id: ProjectId,
        asset_id: AssetId,
        asset_version_id: AssetVersionId,
        payload: VisualImageInspectionInput,
    ) -> VisualImageInspectionResponse | JSONResponse:
        result = safe(
            request,
            lambda: VisualMediaInspectionStore(provider()).append(
                project_id, asset_id, asset_version_id, payload, actor_id=actor.subject_id
            ),
        )
        if isinstance(result, JSONResponse):
            return result
        data, replayed = result
        response.status_code = 200 if replayed else 201
        response.headers["Idempotent-Replayed"] = "true" if replayed else "false"
        return VisualImageInspectionResponse(data=data, request_id=request.state.request_id)

    return router
