"""Read-only preflight with controlled repository receipts, never export approval."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import product_timeline_export as preflight
from aijian_api.artifacts import canonical_content_hash
from aijian_api.media_toolchain import MediaToolchainErrorCode
from test_product_media_preflight_boundaries import EPISODE, PROJECT, payload
from test_timeline_export import _timeline


@pytest.mark.parametrize(
    "fault",
    [
        "none",
        "project",
        "episode",
        "timeline",
        "hash",
        "content",
        "invalid",
        "head",
        "revision",
        "spec",
    ],
)
def test_preflight_preserves_each_read_failure_and_never_claims_export(monkeypatch, fault):
    content = _timeline().model_dump(mode="json")
    content["revision"] = 1
    request = payload(
        timeline={"version_id": "ver_" + "6" * 32, "content_hash": canonical_content_hash(content)}
    )
    repository = Mock(spec=["get_project", "get_episode", "get_artifact_version"])
    record = SimpleNamespace(
        version=SimpleNamespace(content=content, content_hash=request.timeline.content_hash),
        head=SimpleNamespace(latest_version_id=request.timeline.version_id, revision=1),
    )
    repository.get_artifact_version.return_value = record
    if fault == "project":
        repository.get_project.side_effect = preflight.ProjectNotFoundError("unavailable")
    elif fault == "episode":
        repository.get_episode.side_effect = preflight.EpisodeNotFoundError("unavailable")
    elif fault == "timeline":
        repository.get_artifact_version.side_effect = preflight.ArtifactConflictError("unavailable")
    elif fault == "hash":
        record.version.content_hash = "sha256:" + "0" * 64
    elif fault == "content":
        record.version.content = {"unsupported": object()}
    elif fault == "invalid":
        record.version.content = {}
    elif fault == "head":
        record.head.revision = 2
    elif fault == "revision":
        content["revision"] = 2
    elif fault == "spec":
        request = payload(
            timeline=request.timeline.model_dump(),
            spec={
                **request.spec.model_dump(),
                "width": 1280,
            },
        )
    monkeypatch.setattr(
        preflight,
        "load_media_toolchain_lock",
        lambda _: SimpleNamespace(
            profiles=[SimpleNamespace(distribution_status="DEVELOPMENT_ONLY")]
        ),
    )
    result = preflight.ProductTimelineExportPreflightService(repository, Path("unused")).preflight(
        PROJECT, EPISODE, request
    )
    codes = {issue.code for issue in result.issues}
    expected = {
        "project": "PROJECT_NOT_FOUND",
        "episode": "EPISODE_NOT_FOUND",
        "timeline": "TIMELINE_NOT_FOUND",
        "hash": "TIMELINE_HASH_CHANGED",
        "content": "TIMELINE_CONTENT_INVALID",
        "invalid": "TIMELINE_INVALID",
        "head": "TIMELINE_HEAD_CHANGED",
        "revision": "TIMELINE_REVISION_CHANGED",
        "spec": "SPEC_TIMELINE_MISMATCH",
    }
    if fault != "none":
        assert expected[fault] in codes
    assert {
        "EPISODE_TIMELINE_BINDING_MISSING",
        "PRODUCT_ENCODER_UNAVAILABLE",
        "EXPORT_OPERATION_UNAVAILABLE",
        "OUTPUT_TARGET_NOT_SELECTED",
    } <= codes
    assert result.status == "BLOCKED" and result.request_effect == "NO_EXPORT_CLAIM"
    if fault == "project":
        repository.get_episode.assert_not_called()
        repository.get_artifact_version.assert_not_called()
        assert {"EPISODE_NOT_VERIFIED", "TIMELINE_NOT_VERIFIED"} <= codes


@pytest.mark.parametrize("lock_state", ["unavailable", "release"])
def test_toolchain_state_and_selected_versions_do_not_grant_export(monkeypatch, lock_state):
    request = payload()
    selected = request.timeline.model_dump()
    request = payload(
        **{
            field: selected
            for field in (
                "picture_lock",
                "media_manifest",
                "video_master",
                "dialogue_mix",
                "bgm_mix",
                "sfx_mix",
                "subtitle_track",
                "rights_clearance",
            )
        }
    )
    repository = Mock(spec=["get_project", "get_episode", "get_artifact_version"])
    repository.get_artifact_version.side_effect = preflight.ArtifactConflictError("unavailable")
    loader = Mock(
        return_value=SimpleNamespace(
            profiles=[SimpleNamespace(distribution_status="RELEASE_REVIEW_REQUIRED")]
        )
    )
    if lock_state == "unavailable":
        loader.side_effect = preflight.MediaToolchainError(
            MediaToolchainErrorCode.LOCK_INVALID, "controlled unavailable lock"
        )
    monkeypatch.setattr(preflight, "load_media_toolchain_lock", loader)
    result = preflight.ProductTimelineExportPreflightService(repository, Path("unused")).preflight(
        PROJECT, EPISODE, request
    )
    codes = {issue.code for issue in result.issues}
    assert all(
        f"{scope}_UNVERIFIED" in codes
        for scope in (
            "PICTURE_LOCK",
            "MEDIA",
            "VIDEO",
            "DIALOGUE",
            "BGM",
            "SFX",
            "SUBTITLE",
            "RIGHTS",
        )
    )
    assert (
        "TOOLCHAIN_LOCK_UNAVAILABLE"
        if lock_state == "unavailable"
        else "TOOLCHAIN_RELEASE_REVIEW_REQUIRED"
    ) in codes
    assert result.status == "BLOCKED" and result.request_effect == "NO_EXPORT_CLAIM"
