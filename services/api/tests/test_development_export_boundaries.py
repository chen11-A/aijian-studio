"""Real SQLite/filesystem orchestration with a synthetic encoder boundary, no decoding."""

import sqlite3
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import development_timeline_export as export
from aijian_api.artifacts import canonical_content_hash
from aijian_api.fake_media_package import FakeMediaPackageV1
from aijian_api.media_proxy import MATROSKA_EBML_HEADER
from aijian_api.repository import StudioRepository
from aijian_api.timeline import TimelineMediaPackageBindingV1, TimelineVersionV1
from aijian_api.timeline_export import (
    GeneratedTimelineExport,
    TimelineExportError,
    build_timeline_render_plan,
)
from test_timeline_export import (
    OUTPUT_BYTES,
    OUTPUT_HASH,
    SOURCE_HASH,
    _probe,
    _timeline,
    _toolchain,
)


@pytest.fixture
def development(tmp_path, monkeypatch):
    repository = StudioRepository(tmp_path / "workspace" / "studio.sqlite3")
    workspace = repository.database_path.parent
    project = repository.create_project(
        name="Synthetic development export",
        aspect_ratio="9:16",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    package_id = "fmp_" + "a" * 32
    root = workspace / "fake-media" / "v1" / project.id / package_id
    body = MATROSKA_EBML_HEADER + b"source"
    shots = []
    for index in range(1, 4):
        relative = f"shot-{index:02d}"
        preview = root / relative / "preview.webm"
        preview.parent.mkdir(parents=True)
        preview.write_bytes(body)
        shots.append(
            {
                "shot_id": f"fake-shot-{index:02d}",
                "still_image": {
                    "relative_path": relative + "/still.png",
                    "sha256": SOURCE_HASH,
                    "byte_size": 1,
                },
                "scratch_voice": {
                    "relative_path": relative + "/scratch-voice.wav",
                    "sha256": SOURCE_HASH,
                    "byte_size": 1,
                },
                "preview_video": {
                    "relative_path": relative + "/preview.webm",
                    "sha256": SOURCE_HASH,
                    "byte_size": len(body),
                    "frame_rate": {"num": 25, "den": 1},
                },
            }
        )
    manifest = FakeMediaPackageV1.model_validate(
        {
            "package_id": package_id,
            "request_hash": SOURCE_HASH,
            "project_id": project.id,
            "source_document_id": "src_" + "b" * 32,
            "source_sha256": SOURCE_HASH,
            "toolchain_profile_id": "synthetic-only",
            "toolchain_version": "0.0.0",
            "ffmpeg_sha256": SOURCE_HASH,
            "ffprobe_sha256": SOURCE_HASH,
            "frame_rate": {"num": 25, "den": 1},
            "shots": shots,
        }
    )
    (root / "manifest.json").write_text(manifest.model_dump_json(), encoding="utf-8")
    base = _timeline()
    asset = base.assets[0]
    binding = TimelineMediaPackageBindingV1.model_validate(
        {
            "media_package_id": package_id,
            "manifest_sha256": canonical_content_hash(manifest.model_dump(mode="python")),
            "assets": [
                {
                    "asset_id": asset.asset_id,
                    "preview_relative_path": "shot-01/preview.webm",
                    "preview_sha256": SOURCE_HASH,
                    "preview_byte_length": len(body),
                    "source_asset_sha256": asset.source_asset_sha256,
                    "source_frame_count": asset.source_frame_count,
                    "editing_asset_sha256": asset.editing_asset_sha256,
                    "editable_frame_count": asset.editable_frame_count,
                }
            ],
        }
    )
    timeline = TimelineVersionV1.model_validate(
        {
            **base.model_dump(mode="python", exclude_computed_fields=True),
            "revision": 1,
            "media_package": binding,
        }
    )
    record = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="timeline",
        schema_version="1.0.0",
        content=timeline.model_dump(mode="python", exclude_computed_fields=True),
        author_actor_type="human",
        author_actor_id="synthetic-test",
        change_summary="test only",
    )
    payload = export.CreateDevelopmentTimelineExportRequest(
        operation_id=uuid.UUID("11111111-1111-4111-8111-111111111111"),
        timeline_version_id=record.version.id,
        expected_revision=1,
        purpose="DEVELOPMENT_EVIDENCE",
    )
    service = export.DevelopmentTimelineExportService(repository, workspace, _toolchain(tmp_path))

    def encode(timeline, bindings, output_path, toolchain, *, purpose):
        assert purpose.value == "DEVELOPMENT_EVIDENCE"
        assert len(bindings) == 1 and bindings[0].path.read_bytes() == body
        pending = service.get(project.id, payload.operation_id)
        assert pending.status == "UNKNOWN"  # claim is durable before encoder entry
        output_path.write_bytes(OUTPUT_BYTES)
        plan = build_timeline_render_plan(timeline)
        return GeneratedTimelineExport(
            path=output_path,
            probe=_probe(OUTPUT_HASH, timeline.total_duration_frames),
            output_sha256=OUTPUT_HASH,
            render_plan=plan,
            render_plan_sha256=SOURCE_HASH,
        )

    encoder = Mock(side_effect=encode)
    monkeypatch.setattr(export, "export_timeline_mp4", encoder)
    return SimpleNamespace(
        repository=repository,
        service=service,
        project=project,
        payload=payload,
        root=root,
        workspace=workspace,
        manifest=manifest,
        timeline=timeline,
        encoder=encoder,
        encode=encode,
    )


def create(development):
    return development.service.create(development.project.id, development.payload)


def test_success_receipt_is_bound_to_persisted_timeline_and_replay_never_encodes(development):
    result, replayed = create(development)
    assert result.status == "SUCCEEDED" and not replayed
    assert result.timeline_version_id == development.payload.timeline_version_id
    assert result.timeline_content_hash == canonical_content_hash(
        development.timeline.model_dump(mode="python", exclude_computed_fields=True)
    )
    assert result.output.sha256 == OUTPUT_HASH and result.output.duration_frames == 30
    assert result.output.duration_seconds == 1.2 and result.output.has_audio
    assert (development.workspace / result.output.relative_path).read_bytes() == OUTPUT_BYTES
    assert (
        development.service.get(development.project.id, development.payload.operation_id) == result
    )
    assert create(development) == (result, True)
    development.encoder.assert_called_once()


@pytest.mark.parametrize(
    "fault,code",
    [
        (TimelineExportError, "EXPORT_PIPELINE_UNKNOWN"),
        (export.DevelopmentTimelineExportInvalidError, "OUTPUT_SPEC_UNKNOWN"),
        (OSError, "OUTPUT_IO_UNKNOWN"),
        (ValueError, "OUTPUT_METADATA_UNKNOWN"),
    ],
)
def test_encoder_failure_keeps_original_unknown_and_prohibits_replay(development, fault, code):
    development.encoder.side_effect = fault("synthetic internal detail must not escape")
    with pytest.raises(export.DevelopmentTimelineExportUnknownError):
        create(development)
    result = development.service.get(development.project.id, development.payload.operation_id)
    assert result.status == "UNKNOWN" and result.message.startswith(code)
    assert "synthetic internal detail" not in result.message
    with pytest.raises(export.DevelopmentTimelineExportUnknownError):
        create(development)
    development.encoder.assert_called_once()


@pytest.mark.parametrize("state", ["pending", "unknown", "succeeded"])
def test_same_operation_with_different_request_is_always_conflict(development, state):
    if state == "succeeded":
        create(development)
    else:
        stored, _ = development.service._insert_pending(
            development.project.id, development.payload, SOURCE_HASH
        )
        if state == "unknown":
            development.service._mark_unknown(stored, "synthetic unknown")
    development.payload = development.payload.model_copy(update={"expected_revision": 2})
    with pytest.raises(export.DevelopmentTimelineExportConflictError):
        create(development)
    assert development.encoder.call_count == (1 if state == "succeeded" else 0)


@pytest.mark.parametrize(
    "fault",
    [
        "missing-manifest",
        "invalid-manifest",
        "project-drift",
        "package-drift",
        "hash-drift",
        "missing-preview",
        "preview-size",
    ],
)
def test_preflight_files_fail_before_claim_or_encoder(development, fault):
    path = development.root / "manifest.json"
    if fault == "missing-manifest":
        path.unlink()
    elif fault == "invalid-manifest":
        path.write_text("{}", encoding="utf-8")
    elif fault in {"project-drift", "package-drift", "hash-drift"}:
        field, value = {
            "project-drift": ("project_id", "prj_" + "f" * 32),
            "package-drift": ("package_id", "fmp_" + "f" * 32),
            "hash-drift": ("toolchain_profile_id", "changed-test-profile"),
        }[fault]
        path.write_text(
            development.manifest.model_copy(update={field: value}).model_dump_json(),
            encoding="utf-8",
        )
    elif fault == "missing-preview":
        (development.root / "shot-01" / "preview.webm").unlink()
    else:
        (development.root / "shot-01" / "preview.webm").write_bytes(b"changed")
    with pytest.raises(export.DevelopmentTimelineExportPreflightRejectedError) as caught:
        create(development)
    assert caught.value.operation_id == str(development.payload.operation_id)
    assert caught.value.project_id == development.project.id
    assert (
        development.service._load(development.project.id, str(development.payload.operation_id))
        is None
    )
    development.encoder.assert_not_called()


@pytest.mark.parametrize(
    "field",
    [
        "relative_path",
        "output_sha256",
        "byte_length",
        "width",
        "height",
        "frame_rate_num",
        "frame_rate_den",
        "duration_frames",
        "duration_seconds",
        "has_audio",
    ],
)
def test_incomplete_success_receipt_is_unknown_not_reconstructed(development, field):
    create(development)
    # Corrupt only the isolated test ledger. Production schema/guards are unchanged.
    with sqlite3.connect(development.repository.database_path) as connection:
        connection.execute(f"UPDATE development_timeline_exports SET {field} = NULL")
    with pytest.raises(export.DevelopmentTimelineExportUnknownError):
        development.service.get(development.project.id, development.payload.operation_id)
    development.encoder.assert_called_once()


@pytest.mark.parametrize("width,height", [(1920, 1080), (1080, 1080)])
def test_wrong_persisted_dimensions_are_not_reported_as_success(development, width, height):
    create(development)
    with sqlite3.connect(development.repository.database_path) as connection:
        connection.execute(
            "UPDATE development_timeline_exports SET width = ?, height = ?", (width, height)
        )
    with pytest.raises(export.DevelopmentTimelineExportUnknownError):
        development.service.get(development.project.id, development.payload.operation_id)


def test_stale_timeline_revision_is_rejected_without_claim(development):
    development.payload = development.payload.model_copy(update={"expected_revision": 2})
    with pytest.raises(export.DevelopmentTimelineExportConflictError, match="revision changed"):
        create(development)
    development.encoder.assert_not_called()


def test_pending_insert_race_preserves_first_identity_and_cannot_encode_again(
    development, monkeypatch
):
    original = development.service._insert_pending

    def concurrent(project, payload, content_hash):
        original(project, payload, content_hash)
        return original(project, payload, content_hash)

    monkeypatch.setattr(development.service, "_insert_pending", concurrent)
    with pytest.raises(export.DevelopmentTimelineExportUnknownError):
        create(development)
    development.encoder.assert_not_called()
    assert (
        development.service.get(development.project.id, development.payload.operation_id).status
        == "UNKNOWN"
    )


@pytest.mark.parametrize("kind", ["file", "directory"])
@pytest.mark.parametrize("fault", ["missing", "wrong-type", "outside"])
def test_containment_helpers_reject_unusable_paths(tmp_path, kind, fault):
    root = tmp_path / "root"
    root.mkdir()
    target = root / "target" if fault != "outside" else tmp_path / "outside"
    if fault != "missing":
        if (kind == "directory") != (fault == "wrong-type"):
            target.mkdir()
        else:
            target.write_bytes(b"synthetic")
    helper = export._contained_file if kind == "file" else export._contained_directory
    with pytest.raises(export.DevelopmentTimelineExportInvalidError):
        helper(target, root, label="synthetic input")


def test_read_missing_operation_does_not_claim_and_invalid_project_fails_closed(development):
    with pytest.raises(export.DevelopmentTimelineExportNotFoundError):
        development.service.get(development.project.id, development.payload.operation_id)
    with pytest.raises(export.DevelopmentTimelineExportInvalidError):
        development.service.get("invalid", development.payload.operation_id)
    development.encoder.assert_not_called()
