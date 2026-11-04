"""Managed synthetic media storage and reference lifecycle; no decoder invocation."""

import hashlib
import sqlite3
from pathlib import Path

import pytest
from aijian_api import media_asset_store as assets
from test_media_asset_read_boundaries import media as media


def dump(media):
    with sqlite3.connect(media.repository.database_path) as connection:
        return tuple(connection.iterdump())


@pytest.mark.parametrize(
    "body,kind,mime",
    [
        (b"\xff\xd8\xffsynthetic", "image", "image/jpeg"),
        (b"RIFF0000WEBPsynthetic", "image", "image/webp"),
        (b"0000ftypisom", "video", "video/mp4"),
        (b"\x1a\x45\xdf\xa3synthetic", "video", "video/webm"),
        (b"RIFF0000WAVEsynthetic", "audio", "audio/wav"),
        (b"ID3synthetic", "audio", "audio/mpeg"),
        (b"\xff\xe0synthetic", "audio", "audio/mpeg"),
    ],
)
def test_header_classification_does_not_claim_decoding(tmp_path, body, kind, mime):
    path = tmp_path / "stand-in"
    path.write_bytes(body)
    classified, content_type, technical = assets._classify(path)
    assert (classified, content_type) == (kind, mime)
    assert technical["inspection_status"] in {"PENDING_MEDIA_PROBE", "DIMENSIONS_UNINSPECTED"}


@pytest.mark.parametrize("body", [b"", b"plain text", b"\x89PNG\r\n\x1a\n0000IHDR" + b"\x00" * 8])
def test_unrecognized_header_is_not_admitted(tmp_path, body):
    path = tmp_path / "stand-in"
    path.write_bytes(body)
    with pytest.raises(assets.MediaAssetError) as caught:
        assets._classify(path)
    assert caught.value.code == "UNSUPPORTED_MEDIA"


@pytest.mark.parametrize(
    "filename",
    ["", "x" * 256, "dir/file.png", "dir\\file.png", "line\nbreak", "nul\x00", "del\x7f"],
)
def test_invalid_display_name_cannot_create_asset(media, filename):
    before = dump(media)
    with pytest.raises(assets.MediaAssetError) as caught:
        media.store.import_local(media.project.id, media.source, display_filename=filename)
    assert caught.value.code == "INVALID_FILENAME"
    assert dump(media) == before


@pytest.mark.parametrize(
    "fault,code",
    [
        ("relative", "SOURCE_NOT_LOCAL"),
        ("missing", "SOURCE_MISSING"),
        ("directory", "SOURCE_NOT_LOCAL"),
        ("empty", "SOURCE_SIZE"),
        ("unsupported", "UNSUPPORTED_MEDIA"),
        ("project", "PROJECT_NOT_FOUND"),
        ("asset", "ASSET_NOT_FOUND"),
    ],
)
def test_import_failure_leaves_database_unchanged(media, tmp_path, fault, code):
    path = media.source
    if fault == "relative":
        path = Path("relative.png")
    elif fault == "missing":
        path = tmp_path / "absent.png"
    elif fault == "directory":
        path = tmp_path
    elif fault == "empty":
        path = tmp_path / "empty.png"
        path.touch()
    elif fault == "unsupported":
        path = tmp_path / "text.bin"
        path.write_bytes(b"unsupported synthetic file")
    before = dump(media)
    with pytest.raises(assets.MediaAssetError) as caught:
        media.store.import_local(
            "prj_" + "0" * 32 if fault == "project" else media.project.id,
            path,
            asset_id="asset_" + "0" * 32 if fault == "asset" else None,
        )
    assert caught.value.code == code
    assert dump(media) == before
    assert (
        list((media.repository.database_path.parent / "media-assets" / "staging").iterdir()) == []
    )


def test_new_asset_version_reuses_identical_blob_but_preserves_old_version(media):
    revised = media.store.import_local(media.project.id, media.source, asset_id=media.asset.id)
    assert [v.ordinal for v in revised.versions] == [2, 1]
    assert revised.latest_version.sha256 == media.version.sha256
    assert revised.latest_version.id != media.version.id
    assert media.store.read_verified_preview(
        media.project.id, media.asset.id, media.version.id
    ) == (
        media.body,
        "image/png",
        hashlib.sha256(media.body).hexdigest(),
    )
    assert len(media.store.list_assets(media.project.id)) == 1


def test_new_version_cannot_change_media_kind(media, tmp_path):
    path = tmp_path / "video.webm"
    path.write_bytes(b"\x1a\x45\xdf\xa3synthetic")
    before = dump(media)
    with pytest.raises(assets.MediaAssetError) as caught:
        media.store.import_local(media.project.id, path, asset_id=media.asset.id)
    assert caught.value.code == "MEDIA_KIND_CONFLICT"
    assert dump(media) == before


@pytest.mark.parametrize(
    "fault,code",
    [
        ("missing", "MEDIA_MISSING"),
        ("hash", "MEDIA_CORRUPT"),
        ("version", "VERSION_NOT_FOUND"),
        ("size-limit", "PREVIEW_TOO_LARGE"),
    ],
)
def test_preview_failure_never_returns_unverified_bytes(media, monkeypatch, fault, code):
    if fault == "missing":
        media.blob.unlink()
    if fault == "hash":
        media.blob.write_bytes(b"x" * len(media.body))
    if fault == "size-limit":
        monkeypatch.setattr(assets, "MAX_INLINE_PREVIEW_BYTES", 1)
    with pytest.raises(assets.MediaAssetError) as caught:
        media.store.read_verified_preview(
            media.project.id,
            media.asset.id,
            "asv_" + "0" * 32 if fault == "version" else media.version.id,
        )
    assert caught.value.code == code


def test_referenced_asset_cannot_be_deleted_until_explicit_reference_removal(media):
    episode = media.repository.create_episode(media.project.id, title="Reference fixture")
    referenced = media.store.add_episode_reference(
        media.project.id, media.asset.id, episode.id, media.version.id, "visual"
    )
    assert referenced.episode_references[0].version_id == media.version.id
    before = dump(media)
    with pytest.raises(assets.MediaAssetError) as caught:
        media.store.soft_delete(media.project.id, media.asset.id)
    assert caught.value.code == "ASSET_REFERENCED"
    assert dump(media) == before
    with pytest.raises(assets.MediaAssetError) as duplicate:
        media.store.add_episode_reference(
            media.project.id, media.asset.id, episode.id, media.version.id, "visual"
        )
    assert duplicate.value.code == "REFERENCE_EXISTS"
    assert (
        media.store.remove_episode_reference(
            media.project.id, media.asset.id, episode.id, "visual"
        ).episode_references
        == ()
    )
    media.store.soft_delete(media.project.id, media.asset.id)
    assert media.store.list_assets(media.project.id) == ()
    assert media.blob.exists()
    with pytest.raises(assets.MediaAssetError) as deleted:
        media.store.soft_delete(media.project.id, media.asset.id)
    assert deleted.value.code == "ASSET_NOT_FOUND"


@pytest.mark.parametrize(
    "fault,code",
    [
        ("role", "INVALID_ROLE"),
        ("episode", "EPISODE_NOT_FOUND"),
        ("version", "ASSET_NOT_FOUND"),
        ("removal", "REFERENCE_NOT_FOUND"),
    ],
)
def test_reference_failure_is_atomic(media, fault, code):
    episode = media.repository.create_episode(media.project.id, title="Reference fixture")
    before = dump(media)
    with pytest.raises(assets.MediaAssetError) as caught:
        if fault == "removal":
            media.store.remove_episode_reference(
                media.project.id, media.asset.id, episode.id, "absent"
            )
        else:
            media.store.add_episode_reference(
                media.project.id,
                media.asset.id,
                "ep_missing" if fault == "episode" else episode.id,
                "asv_" + "0" * 32 if fault == "version" else media.version.id,
                "" if fault == "role" else "visual",
            )
    assert caught.value.code == code
    assert dump(media) == before


@pytest.mark.parametrize(
    "value,expected",
    [
        ("asset", True),
        ([{"nested": "asset"}], True),
        ({"nested": ["unrelated"]}, False),
        (None, False),
        (42, False),
    ],
)
def test_nested_reference_detection_is_identity_exact(value, expected):
    assert assets._contains_identity(value, {"asset"}) is expected
