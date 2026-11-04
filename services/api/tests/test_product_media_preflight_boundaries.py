"""Pure preflight with typed synthetic read receipts; never claims or encodes."""

from dataclasses import replace
from pathlib import Path

import pytest
from aijian_api.media_asset_selected_reader import (
    SelectedEpisodeUse,
    SelectedMediaAssetRead,
    SelectedMediaAssetVersion,
)
from aijian_api.product_timeline_export_contracts import ProductExportPreflightRequest
from aijian_api.product_timeline_export_media_preflight import inspect_selected_product_media

PROJECT = "prj_" + "1" * 32
EPISODE = "ep_" + "2" * 32
ASSET = "asset_" + "3" * 32
VERSION = "asv_" + "4" * 32
HASH = "5" * 64
TRACKS = [
    ("video_master", "VIDEO", "video"),
    ("dialogue_mix", "DIALOGUE", "audio"),
    ("bgm_mix", "BGM", "audio"),
    ("sfx_mix", "SFX", "audio"),
]


def payload(**fields):
    return ProductExportPreflightRequest.model_validate(
        {
            "timeline": {"version_id": "ver_" + "6" * 32, "content_hash": "sha256:" + HASH},
            "expected_revision": 1,
            "spec": {
                "container": "MP4",
                "width": 1080,
                "height": 1920,
                "frame_rate_num": 25,
                "frame_rate_den": 1,
                "video_codec": "H264",
                "audio_codec": "AAC",
            },
            **fields,
        }
    )


def reference():
    return {"asset_id": ASSET, "version_id": VERSION, "sha256": HASH}


def version(kind="video", **changes):
    value = SelectedMediaAssetVersion(
        PROJECT,
        ASSET,
        VERSION,
        1,
        "synthetic.bin",
        kind,
        "application/octet-stream",
        10,
        HASH,
        "CLEARED",
        "LOCAL_IMPORT",
        {},
        (SelectedEpisodeUse(EPISODE, "reference"),),
    )
    return replace(value, **changes)


def inspect(request, result):
    calls = []

    def reader(*args):
        calls.append(args)
        return result

    issues = inspect_selected_product_media(
        Path("unused.sqlite3"), PROJECT, EPISODE, request, reader=reader, clock=lambda: 0
    )
    return issues, calls


@pytest.mark.parametrize("field,scope,kind", TRACKS)
def test_verified_bytes_never_prove_rights_technique_or_formal_binding(field, scope, kind):
    issues, calls = inspect(
        payload(**{field: reference()}), SelectedMediaAssetRead("VERIFIED", version(kind))
    )
    assert [issue.code for issue in issues] == [
        scope + "_" + suffix
        for suffix in (
            "RIGHTS_DECISION_UNVERIFIED",
            "TECHNICAL_PROBE_UNVERIFIED",
            "FORMAL_BINDING_UNVERIFIED",
        )
    ]
    assert all(issue.scope == scope for issue in issues)
    assert calls == [(Path("unused.sqlite3"), PROJECT, ASSET, VERSION)]


@pytest.mark.parametrize(
    "status",
    [
        "MISSING",
        "CORRUPT",
        "UNVERIFIED_SIZE_LIMIT",
        "NOT_FOUND",
        "UNKNOWN_DATABASE",
        "UNKNOWN_DATABASE_BUSY",
        "UNKNOWN_DATABASE_CHANGED",
        "UNKNOWN_MEDIA_CHANGED",
        "UNKNOWN_UNSAFE_PATH",
        "UNKNOWN_INVALID_RECORD",
        "UNKNOWN_READ_BUDGET",
        "UNKNOWN_UNSUPPORTED_PLATFORM",
    ],
)
def test_unverified_reader_status_is_preserved_and_not_retried(status):
    issues, calls = inspect(payload(video_master=reference()), SelectedMediaAssetRead(status))
    assert len(calls) == 1
    assert [issue.code for issue in issues] == ["VIDEO_" + status]


def test_artifact_and_missing_references_do_not_read_asset_storage():
    request = payload(
        dialogue_mix={"version_id": "ver_" + "7" * 32, "content_hash": "sha256:" + HASH}
    )
    issues, calls = inspect(request, SelectedMediaAssetRead("MISSING"))
    assert issues == () and calls == []


@pytest.mark.parametrize("mismatch", ["none", "project", "asset", "version"])
def test_verified_receipt_must_bind_all_selected_identifiers(mismatch):
    selected = version()
    if mismatch == "none":
        selected = None
    elif mismatch == "project":
        selected = replace(selected, project_id="prj_" + "a" * 32)
    elif mismatch == "asset":
        selected = replace(selected, asset_id="asset_" + "a" * 32)
    else:
        selected = replace(selected, version_id="asv_" + "a" * 32)
    issues, calls = inspect(
        payload(video_master=reference()), SelectedMediaAssetRead("VERIFIED", selected)
    )
    assert [issue.code for issue in issues] == ["VIDEO_RECORD_IDENTITY_INVALID"]
    assert len(calls) == 1


@pytest.mark.parametrize("rights", ["PENDING_REVIEW", "RESTRICTED"])
def test_independent_hash_kind_episode_and_rights_issues_accumulate(rights):
    selected = version("audio", sha256="a" * 64, episode_uses=(), rights_status=rights)
    issues, _ = inspect(
        payload(video_master=reference()), SelectedMediaAssetRead("VERIFIED", selected)
    )
    assert [issue.code for issue in issues] == [
        "VIDEO_HASH_CHANGED",
        "VIDEO_KIND_MISMATCH",
        "VIDEO_EPISODE_REFERENCE_MISSING",
        "VIDEO_RIGHTS_" + rights,
        "VIDEO_RIGHTS_DECISION_UNVERIFIED",
        "VIDEO_TECHNICAL_PROBE_UNVERIFIED",
        "VIDEO_FORMAL_BINDING_UNVERIFIED",
    ]


def test_each_selected_track_is_read_at_most_once_and_failures_are_redacted():
    calls = []

    def reader(*args):
        calls.append(args)
        raise OSError("SECRET database location")

    issues = inspect_selected_product_media(
        Path("unused.sqlite3"),
        PROJECT,
        EPISODE,
        payload(**{field: reference() for field, _, _ in TRACKS}),
        reader=reader,
        clock=lambda: 0,
    )
    assert len(calls) == 4
    assert [issue.code for issue in issues] == [scope + "_READ_UNKNOWN" for _, scope, _ in TRACKS]
    assert all("SECRET" not in issue.message for issue in issues)


@pytest.mark.parametrize("times,expected_calls", [([0, 125], 0), ([0, 0, 125], 1)])
def test_shared_budget_prevents_or_rejects_a_late_read(times, expected_calls):
    calls = []
    ticks = iter(times)

    def reader(*args):
        calls.append(args)
        return SelectedMediaAssetRead("VERIFIED", version())

    issues = inspect_selected_product_media(
        Path("unused.sqlite3"),
        PROJECT,
        EPISODE,
        payload(video_master=reference()),
        reader=reader,
        clock=lambda: next(ticks),
    )
    assert len(calls) == expected_calls
    assert [issue.code for issue in issues] == ["VIDEO_READ_BUDGET_EXHAUSTED"]


def test_unsupported_future_reader_status_is_never_reported_as_verified():
    issues, calls = inspect(
        payload(video_master=reference()), SelectedMediaAssetRead("FUTURE_UNKNOWN")
    )
    assert [issue.code for issue in issues] == ["VIDEO_READ_UNKNOWN"]
    assert len(calls) == 1
