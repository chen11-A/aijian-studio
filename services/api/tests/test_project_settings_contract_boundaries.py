"""Metadata contract validation is not a persistence or artifact-adoption test."""

from datetime import UTC, datetime

import pytest
from aijian_api.project_settings_contracts import (
    ProjectSettingsBoundaryV1,
    ProjectSettingsChangesV1,
    ProjectSettingsDataV1,
    ProjectSettingsResponseV1,
    ProjectSettingsWriteReceiptV1,
    UpdateProjectSettingsRequestV1,
)
from pydantic import ValidationError

PROJECT = "prj_" + "1" * 32
OPERATION = "pso_" + "2" * 32
NOW = datetime(2026, 10, 10, tzinfo=UTC)


def settings(**changes):
    fields = dict(
        project_id=PROJECT,
        name="Project",
        status="active",
        description="",
        sequence_timebase=None,
        aspect_ratio="9:16",
        target_duration_seconds=60,
        source_language="zh-CN",
        revision=2,
        created_at=NOW,
        updated_at=NOW,
    )
    fields.update(changes)
    return ProjectSettingsDataV1(**fields)


@pytest.mark.parametrize(
    "changes",
    [
        {},
        {"name": None},
        {"status": None},
        {"description": None},
        {"name": " "},
        {"name": "x" * 81},
        {"description": "x" * 4001},
        {"name": 12},
        {"name": "a\nb"},
        {"name": "a\x00b"},
        {"description": "a\tb"},
        {"description": "a\u200bb"},
        {"name": "a\ud800b"},
        {"status": "deleted"},
        {"source_language": "en-US"},
    ],
)
def test_changes_reject_empty_invalid_or_unauthorized_fields(changes):
    with pytest.raises(ValidationError):
        ProjectSettingsChangesV1(**changes)


def test_identity_distinguishes_omission_from_explicit_timebase_clear():
    omitted = UpdateProjectSettingsRequestV1(
        operation_id=OPERATION,
        expected_project_revision=1,
        changes=ProjectSettingsChangesV1(name="  名称  "),
    )
    cleared = UpdateProjectSettingsRequestV1(
        operation_id=OPERATION,
        expected_project_revision=1,
        changes=ProjectSettingsChangesV1(name="名称", sequence_timebase=None),
    )
    assert omitted.identity_payload()["changes"] == {"name": "名称"}
    assert cleared.identity_payload()["changes"] == {"name": "名称", "sequence_timebase": None}
    assert omitted.identity_payload() != cleared.identity_payload()
    assert ProjectSettingsChangesV1(description="first\nsecond").description == "first\nsecond"


@pytest.mark.parametrize("revision", [0, -1, True, "1", 2**63 - 1])
def test_request_revision_is_strict_and_has_increment_headroom(revision):
    with pytest.raises(ValidationError):
        UpdateProjectSettingsRequestV1(
            operation_id=OPERATION,
            expected_project_revision=revision,
            changes=ProjectSettingsChangesV1(status="archived"),
        )


@pytest.mark.parametrize("result_revision", [1, 2])
def test_receipt_allows_only_noop_or_single_cas_increment(result_revision):
    receipt = ProjectSettingsWriteReceiptV1(
        operation_id=OPERATION,
        project_id=PROJECT,
        request_hash="sha256:" + "a" * 64,
        base_revision=1,
        result_revision=result_revision,
        result=settings(revision=result_revision),
        created_at=NOW,
    )
    assert receipt.result.revision == result_revision
    assert receipt.model_dump(mode="json")["result"]["project_id"] == PROJECT


@pytest.mark.parametrize("case", ["jump", "wrong-project", "wrong-revision"])
def test_receipt_rejects_unbound_historical_result(case):
    with pytest.raises(ValidationError):
        ProjectSettingsWriteReceiptV1(
            operation_id=OPERATION,
            project_id=PROJECT,
            request_hash="sha256:" + "a" * 64,
            base_revision=1,
            result_revision=3 if case == "jump" else 2,
            result=settings(
                project_id="prj_" + "3" * 32 if case == "wrong-project" else PROJECT,
                revision=1 if case == "wrong-revision" else 2,
            ),
            created_at=NOW,
        )


def test_response_keeps_metadata_only_boundaries_and_is_immutable():
    response = ProjectSettingsResponseV1(data=settings(), boundary=ProjectSettingsBoundaryV1())
    assert response.boundary.existing_artifact_versions_modified is False
    assert response.boundary.settings_scope == "PROJECT_METADATA_ONLY"
    assert (
        response.boundary.sequence_timebase_effect == "DECLARED_DEFAULT_REQUIRES_EXPLICIT_ADOPTION"
    )
    with pytest.raises(ValidationError):
        response.data.name = "mutated"
    with pytest.raises(ValidationError):
        ProjectSettingsBoundaryV1(existing_artifact_versions_modified=True)
