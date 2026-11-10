"""Bounded role-specific snapshots for main-attested prepared video requests."""

from __future__ import annotations

import base64
import os
import re
import stat
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from aijian_api.generation_dispatch_identity import story_reference_identity
from aijian_api.media_probe import _open_local_source
from aijian_api.xai_media import IMAGE_MODEL, XaiImage, _image_reference

if TYPE_CHECKING:
    from aijian_api.story_film import StoryFilmRequest


@dataclass(frozen=True, slots=True)
class RuntimeSource:
    role: Literal["still", "reference", "references"]
    index: int
    source: str
    canonical_path: str | None
    sha256: str
    mime: Literal["image/png", "image/jpeg", "image/webp"]


def parse_sources(rows: object) -> tuple[RuntimeSource, ...]:
    if not isinstance(rows, list) or len(rows) > 15:
        raise ValueError("INPUT_UNVERIFIABLE")
    result = []
    fields = {"role", "index", "source", "canonical_path", "sha256", "mime"}
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != fields
            or not isinstance(row["role"], str)
            or row["role"] not in {"still", "reference", "references"}
            or type(row["index"]) is not int
            or not 0 <= row["index"] <= 12
            or not isinstance(row["source"], str)
            or not 0 < len(row["source"]) <= 4096
            or "\0" in row["source"]
            or not isinstance(row["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"])
            or not isinstance(row["mime"], str)
            or row["mime"] not in {"image/png", "image/jpeg", "image/webp"}
            or row["canonical_path"] is not None
            and (
                not isinstance(row["canonical_path"], str)
                or not row["canonical_path"]
                or len(row["canonical_path"]) > 4096
                or "\0" in row["canonical_path"]
                or not Path(row["canonical_path"]).is_absolute()
            )
        ):
            raise ValueError("INPUT_UNVERIFIABLE")
        result.append(RuntimeSource(**row))
    return tuple(result)


def reference_snapshot(source: str) -> tuple[str, str | None]:
    # Reuse the original protocol/root translation, not a second media permission.
    from aijian_api.story_film import _media_file, reference_image_url

    if source.startswith(("data:", "https://", "http://")):
        value = reference_image_url(source)
        if value is None:
            raise ValueError("INPUT_UNVERIFIABLE")
        story_reference_identity(value)  # Mutable HTTP references are not byte evidence.
        return value, None
    try:
        path = _media_file(source) if source.startswith("aivora-media:") else Path(source)
        if (
            path is None
            or not path.is_absolute()
            or path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}
        ):
            raise ValueError("INPUT_UNVERIFIABLE")
        canonical = path.resolve(strict=True)
        with _open_local_source(canonical) as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= 12_000_000:
                raise ValueError("INPUT_UNVERIFIABLE")
            data = stream.read(12_000_001)
            after = os.fstat(stream.fileno())
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if (
            len(data) != before.st_size
            or path.resolve(strict=True) != canonical
            or any(getattr(before, field) != getattr(after, field) for field in fields)
        ):
            raise ValueError("INPUT_UNVERIFIABLE")
        return _image_reference(XaiImage(data=data, source_url=None, model=IMAGE_MODEL))[
            "url"
        ], str(canonical)
    except OSError as error:
        raise ValueError("INPUT_UNVERIFIABLE") from error


def role_snapshots(
    expected: tuple[tuple[str, int, str], ...],
    rows: tuple[RuntimeSource, ...],
) -> dict[tuple[str, int], str]:
    if tuple((row.role, row.index, row.source) for row in rows) != expected:
        raise ValueError("INPUT_UNVERIFIABLE")
    pool: dict[str, tuple[str, str | None]] = {}
    result: dict[tuple[str, int], str] = {}
    total = 0
    for row in rows:
        if row.source not in pool:
            pool[row.source] = reference_snapshot(row.source)
            total += len(pool[row.source][0])
            if total > 96 * 1024 * 1024:
                raise ValueError("INPUT_UNVERIFIABLE")
        uri, canonical = pool[row.source]
        if (canonical is None) != (row.canonical_path is None) or (
            canonical is not None
            and row.canonical_path is not None
            and Path(canonical) != Path(row.canonical_path)
        ):
            raise ValueError("INPUT_UNVERIFIABLE")
        if row.role == "still":
            raw = base64.b64decode(uri.split(",", 1)[1], validate=True)
            uri = _image_reference(XaiImage(data=raw, source_url=None, model=IMAGE_MODEL))["url"]
        if story_reference_identity(uri) != {"sha256": row.sha256, "mime": row.mime}:
            raise ValueError("INPUT_UNVERIFIABLE")
        result[(row.role, row.index)] = uri
    return result


def materialize_request(
    request: StoryFilmRequest, rows: tuple[RuntimeSource, ...]
) -> StoryFilmRequest:
    if len(request.shots) != 1:
        raise ValueError("INPUT_UNVERIFIABLE")
    shot = request.shots[0]
    roles = tuple(
        [
            *([("still", 0, shot.still)] if shot.still else []),
            *([("reference", 0, shot.reference)] if shot.reference else []),
            *(("references", index, source) for index, source in enumerate(shot.references)),
        ]
    )
    pinned = role_snapshots(roles, rows)
    return replace(
        request,
        shots=(
            replace(
                shot,
                still=pinned.get(("still", 0), ""),
                reference=pinned.get(("reference", 0), ""),
                references=tuple(
                    pinned[("references", index)] for index in range(len(shot.references))
                ),
            ),
        ),
    )


def validate_intent_sources(rows: object) -> tuple[dict[str, object], ...]:
    """Closed, bounded original-reference facts; not permission to open a new source."""
    if not isinstance(rows, list) or len(rows) > 20:
        raise ValueError("INPUT_UNVERIFIABLE")
    result = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"source", "canonical_path", "sha256", "mime"}:
            raise ValueError("INPUT_UNVERIFIABLE")
        # Reuse the same role-format parser rather than a second path/hash grammar.
        parsed = parse_sources([{**row, "role": "reference", "index": 0}])[0]
        if parsed.source in seen:
            raise ValueError("INPUT_UNVERIFIABLE")
        seen.add(parsed.source)
        result.append(dict(row))
    return tuple(result)


def verify_intent_sources(rows: object) -> None:
    if not isinstance(rows, (tuple, list)):
        raise ValueError("INPUT_UNVERIFIABLE")
    parsed = validate_intent_sources(list(rows))
    total = 0
    for row in parsed:
        source = row["source"]
        assert isinstance(source, str)
        uri, canonical = reference_snapshot(source)
        total += len(uri)
        if (
            total > 96 * 1024 * 1024
            or canonical != row["canonical_path"]
            or story_reference_identity(uri) != {"sha256": row["sha256"], "mime": row["mime"]}
        ):
            raise ValueError("INPUT_UNVERIFIABLE")
