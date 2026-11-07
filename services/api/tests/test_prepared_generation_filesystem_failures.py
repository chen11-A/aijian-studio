"""Real bounded media/cache failures never become cache grants or silent fallback."""

import base64
import hashlib
import json
from contextlib import contextmanager
from dataclasses import replace

import pytest
from aijian_api.prepared_generation_sources import (
    materialize_request,
    parse_sources,
    reference_snapshot,
)
from aijian_api.story_creation_cache import StoryCreationCacheError
from aijian_api.story_film import StoryShot
from test_prepared_generation_sources import request_for, source_row
from test_story_creation_cache import PROJECT, cache, fill
from test_story_film import _byte_image, _request


@pytest.mark.parametrize(
    "source",
    [
        "relative.png",
        "aivora-media://invalid",
        "data:image/png;base64,not-base64",
        "http://untrusted.invalid/image.png",
    ],
)
def test_unavailable_or_unbounded_source_protocols_cannot_supply_an_arm(source):
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        reference_snapshot(source)


@pytest.mark.parametrize("rows", [None, (), [None] * 16])
def test_bounded_role_table_rejects_missing_or_excess_rows(rows):
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        parse_sources(rows)


def test_repeated_media_roles_share_bytes_but_keep_their_exact_role_binding():
    source = _byte_image("same actual reference in three roles")
    request = _request(
        "grok_subscription",
        shots=(
            StoryShot(
                "你好。", "画面", 3, "", still=source, reference=source, references=(source,)
            ),
        ),
    )
    row = source_row(source)
    pinned = materialize_request(
        request, (row, replace(row, role="reference"), replace(row, role="references"))
    )
    assert pinned.shots[0].still == pinned.shots[0].reference == pinned.shots[0].references[0]
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        materialize_request(replace(request, shots=()), ())
    wrong = replace(row, role="references", index=1)
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        materialize_request(request_for(source), (wrong,))


def test_source_changed_during_a_real_fd_read_is_rejected_or_prevented_by_the_os(
    tmp_path, monkeypatch
):
    import aijian_api.prepared_generation_sources as module

    path = tmp_path / "current.png"
    original = base64.b64decode(_byte_image("owned bytes").split(",", 1)[1])
    path.write_bytes(original)
    opener = module._open_local_source
    write_blocked = []

    class Observed:
        def __init__(self, stream):
            self.stream = stream

        def fileno(self):
            return self.stream.fileno()

        def read(self, maximum):
            data = self.stream.read(maximum)
            try:
                with path.open("ab") as writer:
                    writer.write(b"later actual mutation")
            except PermissionError:
                write_blocked.append(True)
            return data

    @contextmanager
    def during_read(source):
        with opener(source) as stream:
            yield Observed(stream)

    monkeypatch.setattr(module, "_open_local_source", during_read)
    try:
        observed = reference_snapshot(str(path))
    except ValueError as error:
        assert str(error) == "INPUT_UNVERIFIABLE"
        assert not write_blocked
        assert path.read_bytes() != original
    else:
        # Windows' original no-reparse read handle denies writes. That is an
        # actual OS prevention, not a skipped identity or platform assertion.
        assert write_blocked == [True]
        assert path.read_bytes() == original
        assert base64.b64decode(observed[0].split(",", 1)[1]) == original


@pytest.mark.parametrize("change", ["project", "root", "oversized-recipe"])
def test_cache_cannot_create_files_in_an_unverified_namespace(tmp_path, change):
    from aijian_api.story_creation_cache import StoryCreationCache

    project = "../foreign" if change == "project" else PROJECT
    root = tmp_path / ("foreign" if change == "root" else "story-films")
    recipe = (
        {"text": "x" * (1024 * 1024 + 1)} if change == "oversized-recipe" else {"full": "input"}
    )
    with pytest.raises(StoryCreationCacheError, match="CACHE_UNVERIFIABLE"):
        StoryCreationCache(root, project, recipe, tmp_path / "studio.sqlite3")
    assert list(tmp_path.iterdir()) == []


def test_cache_directory_type_and_content_address_collision_preserve_existing_bytes(tmp_path):
    value = cache(tmp_path)
    value.directory.parent.mkdir(parents=True)
    value.directory.write_bytes(b"unknown retained file")
    with pytest.raises(StoryCreationCacheError, match="CACHE_UNVERIFIABLE"):
        value.bundle()
    assert value.directory.read_bytes() == b"unknown retained file"
    value.directory.unlink()
    value.directory.mkdir()
    digest = hashlib.sha256(b"actual image").hexdigest()
    collision = value.directory / f"image-{digest}.bin"
    collision.write_bytes(b"damaged retained file")
    with pytest.raises(StoryCreationCacheError, match="CACHE_UNVERIFIABLE"):
        value.put("image", b"actual image")
    assert collision.read_bytes() == b"damaged retained file"
    assert value.bundle() is None


def test_oversized_cache_part_is_rejected_from_stat_without_reading_the_whole_file(
    tmp_path, monkeypatch
):
    import aijian_api.story_creation_cache as module

    value = cache(tmp_path)
    fill(value)
    manifest = json.loads((value.directory / "bundle.json").read_bytes())
    path = value.directory / manifest["parts"]["video"]["file"]
    with path.open("wb") as stream:
        stream.truncate(80 * 1024 * 1024 + 1)
    opener = module._open_local_source
    reads = []

    class Observed:
        def __init__(self, stream):
            self.stream = stream

        def fileno(self):
            return self.stream.fileno()

        def read(self, maximum):
            reads.append(maximum)
            return self.stream.read(maximum)

    @contextmanager
    def observed(source):
        with opener(source) as stream:
            yield Observed(stream) if source == path else stream

    monkeypatch.setattr(module, "_open_local_source", observed)
    with pytest.raises(StoryCreationCacheError, match="CACHE_UNVERIFIABLE"):
        value.bundle()
    assert reads == []
    assert json.loads((value.directory / "bundle.json").read_bytes()) == manifest


def test_incomplete_new_bundle_does_not_replace_a_previous_complete_bundle(tmp_path):
    value = cache(tmp_path)
    fill(value)
    old = {path.name: path.read_bytes() for path in value.directory.glob("*.bin")}
    with pytest.raises(StoryCreationCacheError, match="CACHE_UNVERIFIABLE"):
        value.put_bundle(b"new actual image", b"new actual video", b"")
    assert value.bundle() == (b"image", b"video", b"voice")
    assert all((value.directory / name).read_bytes() == data for name, data in old.items())
    assert value.part("video") is None
