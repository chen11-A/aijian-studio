"""Closed private metadata is checked before it can select a product or source."""

from copy import deepcopy

import pytest
from aijian_api.prepared_generation_sources import verify_intent_sources
from aijian_api.story_creation_cache import (
    StoryCreationCacheError,
    validate_cache_snapshot,
)


def descriptor():
    return {
        "schema": 1,
        "input_sha256": "a" * 64,
        "runtime_recipe": {
            "image_prompt": None,
            "image_model": None,
            "prepared_image": {"sha256": "b" * 64, "mime": "image/png"},
            "image_references": [],
            "video_prompt": "原始实际请求",
            "video_model": "grok-imagine-video-1.5",
            "video_references": [],
            "requested_seconds": 3,
            "cap": 15,
            "resolution": None,
            "aspect_ratio": "9:16",
            "speech": [],
            "speech_window": None,
            "actual_video": {"image": {"sha256": "b" * 64, "mime": "image/png"}, "seconds": 3},
        },
        "parts": {role: {"sha256": "b" * 64, "bytes": 10} for role in ("image", "video", "voice")},
    }


@pytest.mark.parametrize(
    "change",
    [
        "not-object",
        "extra",
        "schema-bool",
        "input",
        "parts-list",
        "role-extra",
        "part-list",
        "part-extra",
        "part-sha",
        "part-zero",
        "part-bool",
        "part-limit",
        "runtime-extra",
        "runtime-list",
        "actual-list",
        "actual-extra",
        "duration-bool",
        "duration-range",
        "image-list",
        "image-extra",
        "image-hash",
        "mime-list",
        "mime",
        "nan",
        "runtime-limit",
    ],
)
def test_invalid_snapshot_cannot_supply_a_hash_path_or_media_grant(change):
    value = deepcopy(descriptor())
    if change == "not-object":
        value = []
    elif change == "extra":
        value["path"] = "/not-a-trusted-source"
    elif change == "schema-bool":
        value["schema"] = True
    elif change == "input":
        value["input_sha256"] = "f" * 64
    elif change == "parts-list":
        value["parts"] = []
    elif change == "role-extra":
        value["parts"]["authorization"] = {"sha256": "b" * 64, "bytes": 10}
    elif change == "part-list":
        value["parts"]["video"] = []
    elif change == "part-extra":
        value["parts"]["video"]["file"] = "../outside"
    elif change.startswith("part-"):
        field, replacement = {
            "part-sha": ("sha256", "../outside"),
            "part-zero": ("bytes", 0),
            "part-bool": ("bytes", True),
            "part-limit": ("bytes", 80 * 1024 * 1024 + 1),
        }[change]
        value["parts"]["video"][field] = replacement
    else:
        runtime = value["runtime_recipe"]
        if change == "runtime-extra":
            runtime["grant"] = "not-authorization"
        elif change == "runtime-list":
            value["runtime_recipe"] = []
        elif change == "actual-list":
            runtime["actual_video"] = []
        elif change == "actual-extra":
            runtime["actual_video"]["request_id"] = "not-a-result-proof"
        elif change == "duration-bool":
            runtime["actual_video"]["seconds"] = True
        elif change == "duration-range":
            runtime["actual_video"]["seconds"] = 16
        elif change == "image-list":
            runtime["actual_video"]["image"] = []
        elif change == "image-extra":
            runtime["actual_video"]["image"]["path"] = "../outside"
        elif change == "image-hash":
            runtime["actual_video"]["image"]["sha256"] = "A" * 64
        elif change == "mime-list":
            runtime["actual_video"]["image"]["mime"] = []
        elif change == "mime":
            runtime["actual_video"]["image"]["mime"] = "application/octet-stream"
        elif change == "nan":
            runtime["requested_seconds"] = float("nan")
        else:
            runtime["video_prompt"] = "界" * (1024 * 1024)
    with pytest.raises(StoryCreationCacheError, match="CACHE_UNVERIFIABLE"):
        validate_cache_snapshot(value, "a" * 64)


@pytest.mark.parametrize(
    "rows",
    [
        None,
        {},
        [None],
        [{}],
        [
            {
                "source": "relative.png",
                "canonical_path": "relative.png",
                "sha256": "a" * 64,
                "mime": "image/png",
            }
        ],
        [
            {
                "source": "/owned.png",
                "canonical_path": "/owned.png",
                "sha256": "a" * 64,
                "mime": "image/png",
                "grant": True,
            }
        ],
        [
            {
                "source": "/owned.png",
                "canonical_path": "/owned.png",
                "sha256": "a" * 64,
                "mime": "image/png",
            }
        ]
        * 2,
        [None] * 21,
    ],
)
def test_bad_original_intent_source_table_is_rejected_before_any_file_read(rows, monkeypatch):
    opened = []

    def unexpected_read(source):
        opened.append(True)
        raise AssertionError("invalid source table must not read files")

    monkeypatch.setattr(
        "aijian_api.prepared_generation_sources.reference_snapshot", unexpected_read
    )
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        verify_intent_sources(rows)
    assert opened == []
