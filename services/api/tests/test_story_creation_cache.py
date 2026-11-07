"""Complete recipe and three immutable raw parts; no provider or budget settlement."""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from aijian_api.story_creation_cache import StoryCreationCache, StoryCreationCacheError
from aijian_api.video_recovery_lock import VideoRecoveryLock

PROJECT = "prj_" + "a" * 32


def cache(tmp_path, recipe=None, project=PROJECT):
    return StoryCreationCache(
        tmp_path / "story-films",
        project,
        recipe or {"full": "original", "references": []},
        tmp_path / "studio.sqlite3",
    )


def fill(value):
    for role, data in (("image", b"image"), ("voice", b"voice"), ("video", b"video")):
        value.put(role, data)


def test_all_parts_and_full_recipe_required_old_bytes_preserved_across_voice_changes(tmp_path):
    value = cache(tmp_path)
    assert value.bundle() is None
    value.put("image", b"image")
    assert value.bundle() is None
    value.put("voice", b"voice")
    assert value.bundle() is None
    value.put("video", b"video")
    assert value.bundle() == (b"image", b"video", b"voice")
    old_files = {path.name: path.read_bytes() for path in value.directory.glob("*.bin")}
    value.put("voice", b"voice")
    assert value.bundle() == (b"image", b"video", b"voice")
    value.put("voice", b"different voice")
    # A partial/new voice must not hide the last coherent complete bundle.
    assert value.bundle() == (b"image", b"video", b"voice")
    assert value.part("voice") == b"different voice"
    assert all((value.directory / name).read_bytes() == data for name, data in old_files.items())
    value.put("video", b"new video")
    assert value.bundle() == (b"image", b"new video", b"different voice")
    assert cache(tmp_path, {"full": "different", "references": []}).bundle() is None
    assert cache(tmp_path, project="prj_" + "b" * 32).bundle() is None


@pytest.mark.parametrize("change", ["schema", "project", "input", "extra", "escape", "count"])
def test_bad_manifest_is_unverifiable_not_a_cache_miss_or_authority(tmp_path, change):
    value = cache(tmp_path)
    fill(value)
    path = value.directory / "bundle.json"
    row = json.loads(path.read_bytes())
    if change == "schema":
        row["schema"] = True
    elif change == "project":
        row["project"] = "another-project"
    elif change == "input":
        row["input_sha256"] = "f" * 64
    elif change == "extra":
        row["opaque_grant"] = "must-not-be-authority"
    elif change == "escape":
        row["parts"]["image"]["file"] = "../outside"
    else:
        row["parts"]["voice"]["bytes"] = 0
    path.write_text(json.dumps(row))
    with pytest.raises(StoryCreationCacheError, match="CACHE_UNVERIFIABLE"):
        value.bundle()


@pytest.mark.parametrize("change", ["same-size", "missing", "symlink"])
def test_changed_part_does_not_fall_back_to_generation(tmp_path, change):
    value = cache(tmp_path)
    fill(value)
    row = json.loads((value.directory / "record.json").read_bytes())
    path = value.directory / row["parts"]["video"]["file"]
    if change == "same-size":
        path.write_bytes(b"other")
    else:
        path.unlink()
        if change == "symlink":
            original = tmp_path / "outside-video"
            original.write_bytes(b"video")
            try:
                path.symlink_to(original)
            except OSError:
                pytest.skip("host cannot create a symbolic link")
    with pytest.raises(StoryCreationCacheError, match="CACHE_UNVERIFIABLE"):
        value.bundle()
    if change == "symlink":
        assert original.read_bytes() == b"video"


def test_os_lock_and_write_failure_do_not_publish_a_fake_complete_bundle(tmp_path, monkeypatch):
    value = cache(tmp_path)
    identifier = hashlib.sha256(f"cache-v2:{value.input_sha256}".encode()).hexdigest()[:32]
    lock = VideoRecoveryLock(tmp_path / "studio.sqlite3", identifier)
    try:
        with pytest.raises(StoryCreationCacheError, match="CACHE_BUSY"):
            value.put("image", b"image")
    finally:
        lock.close()
    import aijian_api.story_creation_cache as module

    original = module.os.replace

    def failed_replace(*_args):
        raise OSError("private synthetic failure")

    monkeypatch.setattr(module.os, "replace", failed_replace)
    with pytest.raises(StoryCreationCacheError, match="CACHE_UNVERIFIABLE"):
        value.put("image", b"image")
    assert value.bundle() is None
    assert list(value.directory.glob("*.pending")) == []
    assert list(value.directory.glob("*.record")) == []
    monkeypatch.setattr(module.os, "replace", original)
    fill(value)
    assert value.bundle() == (b"image", b"video", b"voice")


def test_concurrent_process_lifetime_ownership_is_not_a_timeout_or_last_writer_guess(
    tmp_path, monkeypatch
):
    import aijian_api.story_creation_cache as module

    value = cache(tmp_path)
    entered, release = Event(), Event()
    link = module.os.link

    def held_link(*args):
        entered.set()
        assert release.wait(5)
        return link(*args)

    monkeypatch.setattr(module.os, "link", held_link)
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(value.put, "image", b"image")
        try:
            assert entered.wait(5)
            with pytest.raises(StoryCreationCacheError, match="CACHE_BUSY"):
                cache(tmp_path).put("voice", b"voice")
        finally:
            release.set()
            pending.result(timeout=5)
    assert value.part("image") == b"image"
