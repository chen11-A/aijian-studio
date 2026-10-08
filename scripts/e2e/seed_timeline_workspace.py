"""Seed a disposable Electron profile with a persisted UI01 timeline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from aijian_api.media_contracts import SequenceFrameRateData, SequenceTimebaseData
from aijian_api.repository import StudioRepository
from aijian_api.timeline import TimelineAssetV1, TimelineClipV1, TimelineVersionV1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    arguments = parser.parse_args()
    repository = StudioRepository(arguments.workspace / "workspace.sqlite3")
    project = repository.create_project(
        name="雾城来信 · Electron 时间线验收",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    timeline = TimelineVersionV1(
        timeline_id="episode-01-main",
        revision=1,
        sequence_timebase=SequenceTimebaseData(
            frame_rate=SequenceFrameRateData(num=24, den=1),
            timecode_mode="NON_DROP_FRAME",
        ),
        assets=(
            TimelineAssetV1(
                asset_id="shot-rain",
                source_asset_sha256="sha256:" + "a" * 64,
                source_frame_count=120,
            ),
            TimelineAssetV1(
                asset_id="shot-letter",
                source_asset_sha256="sha256:" + "b" * 64,
                source_frame_count=96,
            ),
        ),
        clips=(
            TimelineClipV1(
                clip_id="clip-rain",
                asset_id="shot-rain",
                source_in_frame=0,
                duration_frames=48,
            ),
            TimelineClipV1(
                clip_id="clip-letter",
                asset_id="shot-letter",
                source_in_frame=12,
                duration_frames=36,
            ),
        ),
    )
    record = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="timeline",
        schema_version="1.0.0",
        content=timeline.model_dump(mode="python", exclude_computed_fields=True),
        author_actor_type="system",
        author_actor_id="electron-e2e-seed",
        change_summary="建立 Electron 验收时间线",
    )
    print(json.dumps({"project_id": project.id, "version_id": record.version.id}))


if __name__ == "__main__":
    main()
