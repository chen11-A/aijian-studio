"""Actual source role/identity snapshots reject arm-to-create byte and alias changes."""

import base64
from dataclasses import asdict, replace
from pathlib import Path

import pytest
from aijian_api.generation_dispatch_identity import story_reference_identity
from aijian_api.prepared_generation_sources import (
    RuntimeSource,
    materialize_request,
    parse_sources,
    reference_snapshot,
)
from aijian_api.story_film import StoryShot
from test_story_film import _byte_image, _request


def source_row(source, *, role="still", index=0):
    uri, canonical = reference_snapshot(source)
    return RuntimeSource(role, index, source, canonical, **story_reference_identity(uri))


def request_for(source):
    return _request("grok_subscription", shots=(StoryShot("你好。", "画面", 3, "", still=source),))


def test_local_source_becomes_only_internal_immutable_bytes_without_relaxing_legacy_fields(
    tmp_path,
):
    path = tmp_path / "actual.png"
    data = base64.b64decode(_byte_image("real").split(",", 1)[1])
    path.write_bytes(data)
    request = request_for(str(path))
    row = source_row(str(path))
    pinned = materialize_request(request, (row,))
    assert request.shots[0].still == str(path)
    assert pinned.shots[0].still.startswith("data:image/png;base64,")
    assert story_reference_identity(pinned.shots[0].still) == {
        "sha256": row.sha256,
        "mime": row.mime,
    }
    path.write_bytes(b"later user change")
    assert base64.b64decode(pinned.shots[0].still.split(",", 1)[1]) == data
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        materialize_request(request, (row,))


def test_null_canonical_is_only_valid_for_actual_immutable_data_and_roles_are_exact():
    data = _byte_image("immutable")
    request = request_for(data)
    row = source_row(data)
    assert row.canonical_path is None
    assert materialize_request(request, (row,)).shots[0].still == data
    for bad in (
        replace(row, canonical_path=str(Path.cwd() / "invented.png")),
        replace(row, role="reference"),
        replace(row, index=1),
        replace(row, sha256="f" * 64),
        replace(row, mime="image/jpeg"),
    ):
        with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
            materialize_request(request, (bad,))
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        materialize_request(request, (row, row))


def test_alias_changed_to_other_canonical_file_is_rejected_even_with_identical_bytes(tmp_path):
    first, second = tmp_path / "first.png", tmp_path / "second.png"
    data = base64.b64decode(_byte_image("same bytes").split(",", 1)[1])
    first.write_bytes(data)
    second.write_bytes(data)
    alias = tmp_path / "alias.png"
    try:
        alias.symlink_to(first)
    except OSError:
        pytest.skip("host cannot create a symbolic link")
    row = source_row(str(alias))
    assert materialize_request(request_for(str(alias)), (row,))
    alias.unlink()
    alias.symlink_to(second)
    assert source_row(str(alias)).sha256 == row.sha256
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        materialize_request(request_for(str(alias)), (row,))
    assert first.read_bytes() == second.read_bytes() == data


@pytest.mark.parametrize(
    "change", ["extra", "index-bool", "path-null", "role-list", "mime-list", "sha", "path-relative"]
)
def test_closed_source_table_does_not_grant_authority_to_malformed_private_rows(change):
    row = asdict(source_row(_byte_image("data")))
    if change == "extra":
        row["untrusted_grant"] = True
    elif change == "index-bool":
        row["index"] = True
    elif change == "path-null":
        row["canonical_path"] = "\0"
    elif change == "role-list":
        row["role"] = []
    elif change == "mime-list":
        row["mime"] = []
    elif change == "sha":
        row["sha256"] = "not-a-digest"
    else:
        row["canonical_path"] = "relative.png"
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        parse_sources([row])


def test_oversized_sparse_source_is_rejected_before_any_full_read(tmp_path, monkeypatch):
    import aijian_api.prepared_generation_sources as module

    path = tmp_path / "oversized.png"
    with path.open("wb") as stream:
        stream.truncate(12_000_001)
    opener = module._open_local_source
    reads = []

    class Observed:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            self.stream.__enter__()
            return self

        def __exit__(self, *args):
            return self.stream.__exit__(*args)

        def fileno(self):
            return self.stream.fileno()

        def read(self, limit):
            reads.append(limit)
            return self.stream.read(limit)

    monkeypatch.setattr(module, "_open_local_source", lambda value: Observed(opener(value)))
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        reference_snapshot(str(path))
    assert reads == []
