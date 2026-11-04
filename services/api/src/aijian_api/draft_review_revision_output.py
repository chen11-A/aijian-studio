"""Read-only validation of the existing draft encoder's saved verification evidence."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from typing import Any

from aijian_api.artifacts import canonical_content_hash
from aijian_api.assembly_subtitles import (
    SUBTITLE_FONT_NAME,
    SUBTITLE_FONT_SHA256,
    SUBTITLE_LICENSE_SHA256,
    SUBTITLE_PROFILE,
)
from aijian_api.draft_export_contracts import CreateDraftExportRequest
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyVersionData
from aijian_api.media_contracts import sequence_frame_to_audio_sample


def _same(actual: object, expected: object) -> bool:
    if type(actual) is not type(expected):
        return False
    if isinstance(actual, dict) and isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(
            _same(actual[key], value) for key, value in expected.items()
        )
    if isinstance(actual, list) and isinstance(expected, list):
        return len(actual) == len(expected) and all(
            _same(left, right) for left, right in zip(actual, expected, strict=True)
        )
    return actual == expected


def validate_saved_draft_output(
    row: sqlite3.Row, assembly: EpisodeMediaAssemblyVersionData
) -> None:
    """Raise ValueError on malformed/contradictory proof; never probe or execute media."""
    raw = row["verification_json"]
    if not isinstance(raw, str) or len(raw) > 2 * 1024 * 1024:
        raise ValueError("Invalid saved verification")
    proof = json.loads(raw)
    provenance = json.loads(row["provenance_json"])
    request = json.loads(row["request_json"])
    if (
        not isinstance(proof, dict)
        or not isinstance(provenance, dict)
        or not isinstance(request, dict)
    ):
        raise ValueError("Invalid saved receipt")
    command = CreateDraftExportRequest.model_validate(request)
    if not _same(request, command.model_dump(mode="json")):
        raise ValueError("Invalid closed request")
    if (
        row["request_hash"]
        != canonical_content_hash(
            {"project": row["project_id"], "episode": row["episode_id"], **request}
        )
        or request.get("operation_id") != row["operation_id"]
        or request.get("assembly_version_id") != assembly.version_id
        or request.get("assembly_content_hash") != assembly.content_hash
        or request.get("output_path") != row["output_path"]
        or request.get("rights_declaration") != "OWNED_OR_SYNTHETIC"
    ):
        raise ValueError("Request identity differs")
    pinned, tools = provenance.get("assembly"), provenance.get("toolchain")
    if (
        not isinstance(pinned, dict)
        or not isinstance(tools, dict)
        or pinned.get("version_id") != assembly.version_id
        or pinned.get("content_hash") != assembly.content_hash
        or not _same(pinned.get("content"), assembly.content.model_dump(mode="json"))
        or tools.get("profile_id") != row["toolchain_profile_id"]
    ):
        raise ValueError("Provenance differs")
    if any(
        not isinstance(tools.get(key), str) or re.fullmatch(r"[0-9a-f]{64}", tools[key]) is None
        for key in ("ffmpeg_sha256", "ffprobe_sha256")
    ):
        raise ValueError("Invalid pinned tool identities")
    content = assembly.content
    rate = content.sequence_timebase.frame_rate
    expected: dict[str, Any] = {
        "schema": "aivora.draft-mp4-verification.v1",
        "assembly_content_hash": assembly.content_hash,
        "sha256": row["output_sha256"],
        "byte_size": row["output_bytes"],
        "toolchain_profile_id": row["toolchain_profile_id"],
        "ffmpeg_sha256": tools.get("ffmpeg_sha256"),
        "ffprobe_sha256": tools.get("ffprobe_sha256"),
        "container": "MP4",
        "title": "AIVORA DRAFT",
        "comment": "AIVORA DRAFT - No release approval.",
        "video_codec": "h264",
        "pixel_format": "yuv420p",
        "width": content.canvas_width,
        "height": content.canvas_height,
        "frames": content.total_frames,
        "frame_rate": {"num": rate.num, "den": rate.den},
        "cfr_pts_verified": True,
        "full_decode_verified": True,
        "audio": None,
    }
    if content.audio_segments or any(
        item.embedded_audio == "PLAY" for item in content.visual_segments
    ):
        samples = sequence_frame_to_audio_sample(content.total_frames, content.sequence_timebase)
        audio = proof.get("audio")
        decoded = audio.get("decoded_samples") if isinstance(audio, dict) else None
        if type(decoded) is not int or not samples <= decoded <= samples + 1024:
            raise ValueError("Invalid saved audio verification")
        expected["audio"] = {
            "codec": "aac",
            "sample_rate": 48000,
            "channels": 2,
            "decoded_samples": decoded,
            "assembly_samples": samples,
            "mix": "unity_sum_peak_limited",
        }
    if content.subtitle_segments:
        size = max(1, min(content.canvas_width // 32, content.canvas_height // 18))
        cues = []
        for cue in content.subtitle_segments:
            if not hasattr(cue, "text"):
                raise ValueError("Unsupported saved subtitle proof")
            cues.append(
                {
                    "segment_id": cue.segment_id,
                    "start_frame": cue.start_frame,
                    "end_frame": cue.end_frame,
                    "text_sha256": hashlib.sha256(cue.text.encode("utf-8")).hexdigest(),
                }
            )
        expected["subtitles"] = {
            "render_profile": SUBTITLE_PROFILE,
            "font_name": SUBTITLE_FONT_NAME,
            "font_sha256": SUBTITLE_FONT_SHA256,
            "font_license": "OFL-1.1",
            "font_license_sha256": SUBTITLE_LICENSE_SHA256,
            "renderer": "ffmpeg_drawtext_literal_textfile",
            "frame_enable": "start_inclusive_end_exclusive",
            "fontsize_px": size,
            "border_px": max(1, size // 16),
            "line_spacing_px": max(1, size // 4),
            "bottom_margin_px": size,
            "fontcolor": "white",
            "bordercolor": "black",
            "alignment": "bottom_center",
            "line_alignment": "center",
            "text_shaping": False,
            "cues": cues,
        }
    if not _same(proof, expected):
        raise ValueError("Saved output proof contradicts assembly")
    if row["progress_frames"] != content.total_frames:
        raise ValueError("Saved proof has incomplete output progress")
