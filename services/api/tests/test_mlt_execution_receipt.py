"""Synthetic process-boundary tests; no MLT binary or distributable export is run."""

import hashlib
import io
import json
import subprocess
from dataclasses import replace

import pytest
from aijian_api import mlt_execution_worker as worker
from aijian_api.episode_media_execution_plan import ART04_MLT_TEST_SPEC_SHA256
from aijian_api.media_execution_plan_contracts import MediaExecutionPlanV1
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_output_verify import VerifiedProductOutput
from aijian_api.product_timeline_export_contracts import ProductExportSpec


def fixture(tmp_path):
    def identity(path, body=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body or path.name.encode())
        return worker.MltFileIdentity(path, hashlib.sha256(path.read_bytes()).hexdigest())

    root = tmp_path / "runtime"
    melt = identity(root / "melt.bin")
    module = identity(root / "modules" / "module.bin")
    runtime = worker.MltEngineeringRuntime(root, melt, module.path.parent, (module,), "7.40.0")
    ffmpeg = identity(tmp_path / "tools" / "ffmpeg.bin")
    ffprobe = identity(tmp_path / "tools" / "ffprobe.bin")
    verifier = MediaToolchain(
        profile_id="synthetic-verifier",
        version="1.0.0",
        ffmpeg_path=ffmpeg.path,
        ffprobe_path=ffprobe.path,
        ffmpeg_sha256=ffmpeg.sha256,
        ffprobe_sha256=ffprobe.sha256,
        configuration_flags=(),
        license_class="LGPL",
        spdx_license="LGPL-2.1-or-later",
        distribution_status="DEVELOPMENT_ONLY",
    )
    lock = identity(
        tmp_path / "tools" / "lock.json",
        json.dumps(
            {
                "schema_version": 1,
                "expected_version": verifier.version,
                "profiles": [
                    {
                        "profile_id": verifier.profile_id,
                        "ffmpeg_sha256": ffmpeg.sha256,
                        "ffprobe_sha256": ffprobe.sha256,
                        "source_url": "https://synthetic.example/",
                        "license_class": verifier.license_class,
                        "spdx_license": verifier.spdx_license,
                        "distribution_status": verifier.distribution_status,
                    }
                ],
            }
        ).encode(),
    )
    job = tmp_path / "job"
    xml = identity(job / "job.xml")
    profile = identity(job / "profile")
    resource = identity(job / "source.bin")
    manifest = identity(job / "manifest.json")
    qa = tuple(identity(job / f"qa-{index}.bin") for index in range(5))
    plan = MediaExecutionPlanV1.model_validate(
        {
            "scope": "ENGINEERING_TEST",
            "source": {
                "origin": "FROZEN_ENGINEERING_TEST",
                "project_id": "prj_" + "1" * 32,
                "episode_id": "ep_" + "2" * 32,
                "test_spec_sha256": ART04_MLT_TEST_SPEC_SHA256,
                "fixture_manifest_sha256": manifest.sha256,
            },
            "sequence_timebase": {
                "frame_rate": {"num": 25, "den": 1},
                "timecode_mode": "NON_DROP_FRAME",
            },
            "canvas_width": 1080,
            "canvas_height": 1920,
            "total_frames": 125,
            "subtitle_output_mode": "NONE",
            "dialogue_speech_status": "DIALOGUE_SPEECH_NOT_TESTED",
            "absent_test_roles": ["SFX"],
            "video_tracks": [
                {
                    "track_id": "video",
                    "layer_index": 0,
                    "clips": [
                        {
                            "clip_id": "clip",
                            "media": {
                                "asset_id": "asset_" + "3" * 32,
                                "asset_version_id": "asv_" + "4" * 32,
                                "sha256": resource.sha256,
                                "byte_size": resource.path.stat().st_size,
                                "rights_status": "PENDING_REVIEW",
                                "probe_evidence_id": "mpe_" + "5" * 32,
                                "probe_sha256": "6" * 64,
                            },
                            "start_frame": 0,
                            "end_frame": 125,
                            "source_in_frame": 0,
                            "source_frame_count": 125,
                            "embedded_audio": "MUTE",
                            "source_width": 1080,
                            "source_height": 1920,
                            "scale_mode": "IDENTITY",
                        }
                    ],
                }
            ],
        }
    )
    task = worker.MltExecutionTask(
        operation_id="eteop_" + "7" * 32,
        plan=plan,
        execution_plan_hash=plan.content_hash,
        assembly_artifact_id=None,
        assembly_version_id=None,
        assembly_content_hash=None,
        xml=xml,
        profile=profile,
        resources=(resource,),
        fixture_manifest=manifest,
        qa_origin_files=qa,
        generation_lock=lock,
        generation_ffmpeg=ffmpeg,
        generation_ffprobe=ffprobe,
        temporary_output=job / "synthetic.mp4",
        total_frames=125,
        spec=ProductExportSpec(
            container="MP4",
            width=1080,
            height=1920,
            frame_rate_num=25,
            frame_rate_den=1,
            video_codec="H264",
            audio_codec="AAC",
        ),
        expect_audio=True,
    )
    return task, runtime, verifier


def synthetic_processes(monkeypatch, task):
    launches = []

    def run(command, **kwargs):
        if "-version" in command:
            body = b"melt 7.40.0"
        else:
            assert "-query" in command
            body = (
                b"consumers:\n - avformat\nfilters:\n - qtext\n - affine\n"
                b"producers:\n - avformat\n - xml\ntransitions:\n - luma\n - mix\n - affine\n"
            )
        return subprocess.CompletedProcess(command, 0, body)

    class Process:
        returncode = 0

        def __init__(self, command, **kwargs):
            launches.append(command)
            self.stdout = io.BytesIO(b"Current Frame: 125, percentage: 100\n")

        def poll(self):
            return self.returncode

    output = VerifiedProductOutput(
        str(task.temporary_output),
        "8" * 64,
        100,
        "{}",
        "sha256:" + "9" * 64,
        "2026-10-08T00:00:00+00:00",
    )
    monkeypatch.setattr(worker.subprocess, "run", run)
    monkeypatch.setattr(worker.subprocess, "Popen", Process)
    monkeypatch.setattr(worker, "verify_local_mp4", lambda *args, **kwargs: output)
    return launches, output


def test_success_receipt_uses_exact_task_plan_provenance(tmp_path, monkeypatch):
    task, runtime, verifier = fixture(tmp_path)
    launches, output = synthetic_processes(monkeypatch, task)
    selected = []
    progress = []

    def revalidate(plan, resources):
        selected.append((plan, resources))

    receipt = worker.run_mlt_engineering_task(
        task,
        runtime,
        verifier,
        on_progress=progress.append,
        stop_requested=lambda: False,
        revalidate_selection=revalidate,
    )
    assert len(launches) == 1
    assert selected == [(task.plan, task.resources)]
    assert receipt.scope == "ENGINEERING_TEST"
    assert receipt.test_spec_sha256 == task.plan.source.test_spec_sha256
    assert receipt.fixture_manifest_sha256 == task.plan.source.fixture_manifest_sha256
    assert receipt.project_id == task.plan.source.project_id
    assert receipt.episode_id == task.plan.source.episode_id
    assert receipt.execution_plan_hash == task.plan.content_hash
    assert receipt.assembly_version_id is None
    assert receipt.temporary_output is output
    assert receipt.maximum_progress_frame == 125
    assert progress == [125]


def test_invalid_revalidation_return_never_launches_render(tmp_path, monkeypatch):
    task, runtime, verifier = fixture(tmp_path)
    launches, _output = synthetic_processes(monkeypatch, task)
    with pytest.raises(worker.MltExecutionError) as caught:
        worker.run_mlt_engineering_task(
            task,
            runtime,
            verifier,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
            revalidate_selection=lambda *args: False,
        )
    assert caught.value.code == "SELECTION_REVALIDATION_FAILED"
    assert not launches


@pytest.mark.parametrize("field", ["test_spec_sha256", "fixture_manifest_sha256"])
def test_missing_frozen_provenance_never_launches(tmp_path, monkeypatch, field):
    task, runtime, verifier = fixture(tmp_path)
    launches, _output = synthetic_processes(monkeypatch, task)
    changed = task.plan.model_copy(
        update={
            "source": task.plan.source.model_copy(update={field: None}),
        }
    )
    task = replace(task, plan=changed, execution_plan_hash=changed.content_hash)
    with pytest.raises(worker.MltExecutionError) as caught:
        worker.run_mlt_engineering_task(
            task,
            runtime,
            verifier,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
            revalidate_selection=lambda *args: None,
        )
    assert caught.value.code == "PLAN_OR_TOOLCHAIN_INVALID"
    assert not launches
