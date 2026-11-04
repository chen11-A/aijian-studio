"""Verify the existing approval chain before fresh consumption, preserving history."""

from __future__ import annotations

import json
import sqlite3
from typing import Literal

from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import TrustedReviewActor
from aijian_api.repository import ReviewInvalidError, StudioRepository
from aijian_api.visual_bible_contracts import VisualBibleAuthorityData
from aijian_api.visual_bible_integrity import fresh_visual_readiness, visual_version


def visual_authority(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    project_id: str,
    version_id: str,
    *,
    require_current: bool = False,
    verify_fresh: bool = True,
    exact_originals: bool = False,
) -> VisualBibleAuthorityData:
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
    decisions = connection.execute(
        "SELECT * FROM gate_decisions WHERE artifact_id=? AND version_id=? "
        "AND gate='G5' AND decision='approved'",
        (bible.artifact_id, version_id),
    ).fetchall()
    status: Literal["CURRENT", "SUPERSEDED", "UNAPPROVED", "EVIDENCE_CHANGED", "UNAVAILABLE"] = (
        "UNAPPROVED"
    )
    blocking: tuple[str, ...] = ("approved_g5_decision_required",)
    decision_id: str | None = None
    if len(decisions) == 1:
        decision = decisions[0]
        decision_id = str(decision["decision_id"])
        report_row = connection.execute(
            "SELECT * FROM gate_readiness_reports WHERE report_id=?",
            (str(decision["readiness_report_id"]),),
        ).fetchone()
        challenge = connection.execute(
            "SELECT * FROM confirmation_challenges WHERE challenge_id=?",
            (str(decision["confirmation_challenge_id"]),),
        ).fetchone()
        if report_row is None or challenge is None:
            raise ReviewInvalidError("G5 approval evidence is incomplete")
        report = repository._readiness_report_from_row(report_row)
        roles = json.loads(str(challenge["actor_roles_json"]))
        if not isinstance(roles, list) or not all(isinstance(x, str) for x in roles):
            raise ReviewInvalidError("G5 approved actor roles are invalid")
        actor = TrustedReviewActor(str(decision["actor_id"]), tuple(roles))
        payload: dict[str, object] = {
            "decision": "approved",
            "rationale": str(decision["rationale"]),
            "actor_role": str(decision["actor_role"]),
        }
        repository._authorize_review_action(policy, "decision", payload, actor)
        if (
            report.artifact_id != bible.artifact_id
            or report.version_id != version_id
            or report.gate != "G5"
            or report.submission_id != str(decision["submission_id"])
            or report.policy_code != policy.policy_code
            or report.policy_version != policy.policy_version
            or report.report.get("policy_snapshot_hash") != policy.snapshot_hash
            or report.report.get("ready") is not True
            or str(challenge["artifact_id"]) != bible.artifact_id
            or str(challenge["version_id"]) != version_id
            or str(challenge["gate"]) != "G5"
            or str(challenge["action"]) != "decision"
            or challenge["consumed_at"] is None
            or str(challenge["readiness_report_id"]) != report.id
            or str(challenge["actor_id"]) != actor.subject_id
            or str(challenge["policy_snapshot_hash"]) != policy.snapshot_hash
            or int(challenge["head_revision"]) != int(decision["head_revision"])
            or int(challenge["review_evidence_revision"]) != report.review_evidence_revision
            or str(challenge["action_payload_hash"])
            != canonical_content_hash(repository._bound_action_payload(payload, actor, policy))
        ):
            raise ReviewInvalidError("G5 approved decision differs from its signed evidence")
        signed = {
            str(row["role"])
            for row in connection.execute(
                """SELECT role FROM role_signoffs WHERE artifact_id=? AND version_id=? AND gate='G5'
               AND submission_id=? AND readiness_report_id=? AND review_evidence_revision=?""",
                (
                    bible.artifact_id,
                    version_id,
                    str(decision["submission_id"]),
                    report.id,
                    report.review_evidence_revision,
                ),
            ).fetchall()
        }
        if not set(policy.required_roles) <= signed or repository._has_open_blocking_findings(
            connection,
            str(decision["submission_id"]),
        ):
            raise ReviewInvalidError("G5 approval has missing signoffs or open blocking findings")
        fresh: dict[str, object] = {}
        if verify_fresh:
            fresh = {
                **fresh_visual_readiness(
                    repository, connection, record, project_id, exact_originals=exact_originals
                ),
                "policy_code": policy.policy_code,
                "policy_version": policy.policy_version,
                "policy_snapshot_hash": policy.snapshot_hash,
            }
        if verify_fresh and canonical_content_hash(fresh) != report.report_hash:
            status, blocking = "EVIDENCE_CHANGED", ("approval_evidence_no_longer_matches",)
        elif record.head.accepted_version_id != version_id:
            status, blocking = "SUPERSEDED", ("approved_visual_head_replaced",)
        else:
            status, blocking = "CURRENT", ()
    elif decisions:
        raise ReviewInvalidError("G5 version has ambiguous approval decisions")
    result = VisualBibleAuthorityData(
        project_id=project_id,
        version_id=version_id,
        content_hash=bible.content_hash,
        status=status,
        gate_decision_id=decision_id,
        blocking=blocking,
    )
    if require_current and result.status != "CURRENT":
        raise ReviewInvalidError("Fresh visual consumption needs the current valid G5 approval")
    return result
