"""Stdlib execution of the actual pure comparison helpers without runtime dependencies."""

import ast
import hashlib
import json
import re
import sqlite3
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

SOURCE = Path(__file__).parents[1] / "src/aijian_api/draft_review_revision_store.py"
TREE = ast.parse(SOURCE.read_text())
HELPERS = ast.Module(
    body=[
        node
        for node in TREE.body
        if isinstance(node, ast.FunctionDef)
        and node.name in {"_segments", "_comparison", "_hash_event", "_time"}
    ],
    type_ignores=[],
)


def content_hash(value):
    raw = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()
    return "sha256:" + hashlib.sha256(raw).hexdigest()


class Segment:
    def __init__(self, segment_id, start=0, end=24, **extra):
        self.segment_id, self.start_frame, self.end_frame = segment_id, start, end
        self.extra = extra

    def model_dump(self, **kwargs):
        return dict(
            segment_id=self.segment_id,
            start_frame=self.start_frame,
            end_frame=self.end_frame,
            **self.extra,
        )


class Snapshot(SimpleNamespace):
    pass


NAMESPACE = {
    "Any": object,
    "DraftReviewRevisionSegment": Snapshot,
    "canonical_content_hash": content_hash,
}
NAMESPACE["datetime"] = datetime
exec(compile(HELPERS, str(SOURCE), "exec"), NAMESPACE)


def assembly(segments, width=160):
    return SimpleNamespace(
        visual_segments=segments,
        audio_segments=[],
        subtitle_segments=[],
        sequence_timebase={"frame_rate": {"num": 24, "den": 1}},
        canvas_width=width,
        canvas_height=90,
        total_frames=24,
    )


class RevisionHelperIsolation(unittest.TestCase):
    def test_changed_removed_added_and_outside_declared_scope(self):
        old = assembly([Segment("seg_a", end=12), Segment("seg_b", start=12)])
        new = assembly([Segment("seg_a", end=10), Segment("seg_c", start=10)], width=180)
        result = NAMESPACE["_comparison"](old, new, {"seg_a"})
        self.assertEqual(result["changed_segment_ids"], ["seg_a"])
        self.assertEqual(result["removed_segment_ids"], ["seg_b"])
        self.assertEqual(result["added_segment_ids"], ["seg_c"])
        self.assertEqual(result["out_of_scope_segment_ids"], ["seg_b", "seg_c"])
        self.assertTrue(result["sequence_settings_changed"])

    def test_same_geometry_new_media_is_changed_and_input_untouched(self):
        old = assembly([Segment("seg_a", media={"sha256": "a"})])
        new = assembly([Segment("seg_a", media={"sha256": "b"})])
        before = old.visual_segments[0].model_dump()
        result = NAMESPACE["_comparison"](old, new, {"seg_a"})
        self.assertEqual(result["changed_segment_ids"], ["seg_a"])
        self.assertFalse(result["sequence_settings_changed"])
        self.assertEqual(old.visual_segments[0].model_dump(), before)

    def test_hash_excludes_only_own_hash_and_unicode_stays_exact(self):
        payload = {"instruction": "动作检查 🎬", "plan_hash": "old"}
        self.assertEqual(
            NAMESPACE["_hash_event"](payload, "plan_hash"),
            content_hash({"instruction": "动作检查 🎬"}),
        )
        with self.assertRaises(ValueError):
            NAMESPACE["_time"]("2026-10-09T12:00:00")
        self.assertIsNotNone(NAMESPACE["_time"]("2026-10-09T12:00:00Z").tzinfo)

    def test_no_execution_release_or_export_mutation_capability(self):
        calls = [node for node in ast.walk(TREE) if isinstance(node, ast.Call)]
        forbidden = {
            "submit",
            "create_version",
            "_update",
            "generate",
            "approve_release",
            "signoff",
        }
        self.assertFalse(
            [
                node.func.attr
                for node in calls
                if isinstance(node.func, ast.Attribute) and node.func.attr in forbidden
            ]
        )
        self.assertFalse(
            [
                node
                for node in calls
                if isinstance(node.func, ast.Attribute)
                and node.func.attr == "get"
                and isinstance(node.func.value, ast.Attribute)
                and node.func.value.attr == "runtime"
            ]
        )


# Execute the actual proof comparison against synthetic DTOs, not Pydantic/runtime.
PROOF_SOURCE = SOURCE.with_name("draft_review_revision_output.py")
PROOF_TREE = ast.parse(PROOF_SOURCE.read_text())
PROOF_HELPERS = ast.Module(
    body=[node for node in PROOF_TREE.body if isinstance(node, ast.FunctionDef)], type_ignores=[]
)


class ClosedRequest:
    @classmethod
    def model_validate(cls, value):
        expected = {
            "operation_id",
            "assembly_version_id",
            "assembly_content_hash",
            "rights_declaration",
            "output_path",
        }
        if set(value) != expected:
            raise ValueError("Closed request")
        return SimpleNamespace(model_dump=lambda **kwargs: value)


PROOF_NAMESPACE = dict(
    Any=object,
    sqlite3=sqlite3,
    re=re,
    json=json,
    hashlib=hashlib,
    EpisodeMediaAssemblyVersionData=object,
    CreateDraftExportRequest=ClosedRequest,
    canonical_content_hash=content_hash,
    SUBTITLE_PROFILE="profile",
    SUBTITLE_FONT_NAME="font",
    SUBTITLE_FONT_SHA256="font-hash",
    SUBTITLE_LICENSE_SHA256="license-hash",
    sequence_frame_to_audio_sample=lambda frames, rate: frames * 2000,
)
exec(compile(PROOF_HELPERS, str(PROOF_SOURCE), "exec"), PROOF_NAMESPACE)


class ProofIsolation(unittest.TestCase):
    def fixture(self):
        content = assembly([Segment("seg_a")])
        content.sequence_timebase = SimpleNamespace(frame_rate=SimpleNamespace(num=24, den=1))
        content.model_dump = lambda **kwargs: {"total_frames": 24, "source_in_frame": 0}
        content.visual_segments[0].embedded_audio = "MUTE"
        frozen = SimpleNamespace(version_id="version", content_hash="hash", content=content)
        command = dict(
            operation_id="op",
            assembly_version_id="version",
            assembly_content_hash="hash",
            rights_declaration="OWNED_OR_SYNTHETIC",
            output_path="/synthetic/DRAFT.mp4",
        )
        tools = dict(profile_id="test", ffmpeg_sha256="a" * 64, ffprobe_sha256="b" * 64)
        provenance = {
            "assembly": {
                "version_id": "version",
                "content_hash": "hash",
                "content": content.model_dump(),
            },
            "toolchain": tools,
        }
        proof = dict(
            schema="aivora.draft-mp4-verification.v1",
            assembly_content_hash="hash",
            sha256="c" * 64,
            byte_size=123,
            toolchain_profile_id="test",
            ffmpeg_sha256="a" * 64,
            ffprobe_sha256="b" * 64,
            container="MP4",
            title="AIVORA DRAFT",
            comment="AIVORA DRAFT - No release approval.",
            video_codec="h264",
            pixel_format="yuv420p",
            width=160,
            height=90,
            frames=24,
            frame_rate={"num": 24, "den": 1},
            cfr_pts_verified=True,
            full_decode_verified=True,
            audio=None,
        )
        row = dict(
            command,
            project_id="p",
            episode_id="e",
            request_json=json.dumps(command),
            request_hash=content_hash({"project": "p", "episode": "e", **command}),
            provenance_json=json.dumps(provenance),
            verification_json=json.dumps(proof),
            output_sha256="c" * 64,
            output_bytes=123,
            toolchain_profile_id="test",
            status="SUCCEEDED",
            progress_frames=24,
        )
        return row, frozen, proof, provenance

    def test_saved_proof_accepts_exact_evidence(self):
        row, frozen, proof, provenance = self.fixture()
        PROOF_NAMESPACE["validate_saved_draft_output"](row, frozen)

    def test_changed_codec_hash_frames_flags_and_extra_fields_rejected(self):
        for change in (
            {"video_codec": "hevc"},
            {"sha256": "0" * 64},
            {"frames": 1},
            {"cfr_pts_verified": 1},
            {"extra": True},
        ):
            row, frozen, proof, provenance = self.fixture()
            row["verification_json"] = json.dumps({**proof, **change})
            with self.assertRaises(ValueError):
                PROOF_NAMESPACE["validate_saved_draft_output"](row, frozen)

    def test_corrupt_progress_tool_identity_and_coerced_content_rejected(self):
        row, frozen, proof, provenance = self.fixture()
        row["progress_frames"] = 0
        with self.assertRaises(ValueError):
            PROOF_NAMESPACE["validate_saved_draft_output"](row, frozen)
        row, frozen, proof, provenance = self.fixture()
        provenance["toolchain"]["ffmpeg_sha256"] = None
        row["provenance_json"] = json.dumps(provenance)
        proof["ffmpeg_sha256"] = None
        row["verification_json"] = json.dumps(proof)
        with self.assertRaises(ValueError):
            PROOF_NAMESPACE["validate_saved_draft_output"](row, frozen)
        row, frozen, proof, provenance = self.fixture()
        provenance["assembly"]["content"]["source_in_frame"] = False
        row["provenance_json"] = json.dumps(provenance)
        with self.assertRaises(ValueError):
            PROOF_NAMESPACE["validate_saved_draft_output"](row, frozen)


if __name__ == "__main__":
    unittest.main()
