"""Closed parent-pipe contracts; not registered in HTTP or persisted as user data."""

from __future__ import annotations

import hashlib
import json
import struct
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.media_execution_plan_contracts import MediaExecutionPlanReceiptV1


def canonical(value: object) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


def digest(value: object) -> str:
    return "sha256:" + hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


class PrivateOpening(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    open_request_id: str = Field(pattern=r"^pvo_[0-9a-f]{32}$")
    identity: dict[str, Any]
    session_id: str = Field(pattern=r"^pvs_[0-9a-f]{32}$")
    generation: int = Field(ge=1, le=0xFFFFFFFF)
    expires_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
    plan: MediaExecutionPlanReceiptV1

    def check(self) -> None:
        expires = datetime.fromisoformat(self.expires_at)
        remaining = (expires - datetime.now(UTC)).total_seconds()
        source, plan = self.plan.plan.source, self.plan.plan
        expected = {
            "project_id": source.project_id,
            "episode_id": source.episode_id,
            "assembly_artifact_id": source.assembly_artifact_id,
            "assembly_version_id": source.assembly_version_id,
            "assembly_content_hash": source.assembly_content_hash,
            "assembly_head_revision": source.assembly_head_revision,
            "plan_hash": self.plan.plan_hash,
        }
        if canonical(self.identity) != canonical(expected) or not 0 < remaining <= 300:
            raise ValueError("Private opening identity or lease is invalid")
        if (
            plan.scope != "DRAFT_PREVIEW"
            or source.origin != "EPISODE_ASSEMBLY"
            or source.assembly_version_id is None
            or len(plan.video_tracks) != 1
            or plan.video_tracks[0].layer_index != 0
            or plan.audio_tracks
            or plan.subtitle_cues
            or plan.video_transitions
            or plan.absent_test_roles
            or plan.subtitle_output_mode != "NONE"
            or plan.dialogue_speech_status != "NOT_APPLICABLE"
        ):
            raise ValueError("Private native capability does not cover the saved plan")
        clips = plan.video_tracks[0].clips
        if not 1 <= len(clips) <= 32:
            raise ValueError("Private native clip count is invalid")
        for clip in clips:
            if (
                clip.scale_mode != "IDENTITY"
                or clip.embedded_audio != "MUTE"
                or clip.source_width != plan.canvas_width
                or clip.source_height != plan.canvas_height
            ):
                raise ValueError("Private native clip needs an unsupported transform")


class PrivatePrepare(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    opening: PrivateOpening
    profile_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


def encode_opening(opening: PrivateOpening, material: dict[str, Any]) -> bytes:
    """Independently reconstruct the same binary packet from the owned exact material."""
    opening.check()
    parts: list[bytes] = []

    def u32(value: int) -> None:
        parts.append(struct.pack("<I", value))

    def text(value: str) -> None:
        data = value.encode("utf-8")
        if len(data) > 16_384 or "\0" in value:
            raise ValueError("Private native text is out of bounds")
        u32(len(data))
        parts.append(data)

    u32(1)
    u32(1)
    text(opening.session_id)
    u32(opening.generation)
    text(opening.open_request_id)
    text(canonical(opening.identity))
    text(opening.expires_at)
    text(material["profile_hash"])
    for name in ("framework_path", "module_directory", "data_directory"):
        text(material[name])
    files = material["runtime_files"]
    u32(len(files))
    for file in files:
        text(file["path"])
        text(file["sha256"])
        u32(file["byte_size"])
    plan = opening.plan.plan
    for value in (
        plan.canvas_width,
        plan.canvas_height,
        plan.sequence_timebase.frame_rate.num,
        plan.sequence_timebase.frame_rate.den,
        plan.total_frames,
    ):
        u32(value)
    clips = plan.video_tracks[0].clips
    u32(len(clips))
    for clip in clips:
        matches = [
            s
            for s in material["sources"]
            if s["asset_id"] == clip.media.asset_id
            and s["asset_version_id"] == clip.media.asset_version_id
            and s["sha256"] == clip.media.sha256
            and s["byte_size"] == clip.media.byte_size
        ]
        if len(matches) != 1:
            raise ValueError("Private source inventory differs from saved clip")
        file = matches[0]
        text(file["path"])
        text(file["sha256"])
        u32(file["byte_size"])
        for value in (
            clip.start_frame,
            clip.end_frame,
            clip.source_in_frame,
            clip.source_frame_count,
        ):
            u32(value)
    body = b"".join(parts)
    if len(body) > 131_072:
        raise ValueError("Private opening packet is out of bounds")
    return struct.pack("<I", len(body)) + body
