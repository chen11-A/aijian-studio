"""Private complete-input/raw-byte cache, never a budget settlement or portable grant."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from pathlib import Path
from typing import Literal
from uuid import uuid4

from aijian_api.media_probe import _open_local_source
from aijian_api.video_recovery_lock import VideoRecoveryBusy, VideoRecoveryLock

Role = Literal["image", "video", "voice"]
_LIMITS: dict[str, int] = {
    "image": 12_000_000,
    "video": 80 * 1024 * 1024,
    "voice": 80 * 1024 * 1024,
}
_FIELDS = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")


class StoryCreationCacheError(ValueError):
    pass


def _json(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    ).encode()


def _read(path: Path, maximum: int) -> bytes:
    try:
        with _open_local_source(path) as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum:
                raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
            data = stream.read(maximum + 1)
            after = os.fstat(stream.fileno())
        if len(data) != before.st_size or any(
            getattr(before, field) != getattr(after, field) for field in _FIELDS
        ):
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        return data
    except OSError as error:
        raise StoryCreationCacheError("CACHE_UNVERIFIABLE") from error


_RUNTIME_FIELDS = {
    "image_prompt",
    "image_model",
    "prepared_image",
    "image_references",
    "video_prompt",
    "video_model",
    "video_references",
    "requested_seconds",
    "cap",
    "resolution",
    "aspect_ratio",
    "speech",
    "speech_window",
    "actual_video",
}


def validate_cache_runtime(value: object) -> None:
    if not isinstance(value, dict) or set(value) != _RUNTIME_FIELDS:
        raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
    actual = value["actual_video"]
    if (
        not isinstance(actual, dict)
        or set(actual) != {"image", "seconds"}
        or type(actual["seconds"]) is not int
        or not 1 <= actual["seconds"] <= 15
        or not isinstance(actual["image"], dict)
        or set(actual["image"]) != {"sha256", "mime"}
        or not isinstance(actual["image"]["sha256"], str)
        or re.fullmatch(r"[a-f0-9]{64}", actual["image"]["sha256"]) is None
        or not isinstance(actual["image"]["mime"], str)
        or actual["image"]["mime"] not in {"image/png", "image/jpeg", "image/webp"}
    ):
        raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
    try:
        if len(_json(value)) > 1024 * 1024:
            raise ValueError("size")
    except (TypeError, ValueError) as error:
        raise StoryCreationCacheError("CACHE_UNVERIFIABLE") from error


def validate_cache_snapshot(value: object, input_sha256: str) -> dict[str, object]:
    if (
        not isinstance(value, dict)
        or set(value) != {"schema", "input_sha256", "runtime_recipe", "parts"}
        or type(value["schema"]) is not int
        or value["schema"] != 1
        or value["input_sha256"] != input_sha256
        or not isinstance(value["parts"], dict)
        or set(value["parts"]) != set(_LIMITS)
    ):
        raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
    validate_cache_runtime(value["runtime_recipe"])
    for role, part in value["parts"].items():
        if (
            not isinstance(part, dict)
            or set(part) != {"sha256", "bytes"}
            or not isinstance(part["sha256"], str)
            or re.fullmatch(r"[a-f0-9]{64}", part["sha256"]) is None
            or type(part["bytes"]) is not int
            or not 0 < part["bytes"] <= _LIMITS[role]
        ):
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
    return value


class StoryCreationCache:
    def __init__(
        self,
        root: Path,
        project: str,
        recipe: dict[str, object],
        database: Path,
    ) -> None:
        if not re.fullmatch(r"prj_[a-f0-9]{32}", project):
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        self.project = project
        encoded = _json(recipe)
        if len(encoded) > 1024 * 1024:
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        self.input_sha256 = hashlib.sha256(encoded).hexdigest()
        expected_root = database.parent.resolve() / "story-films"
        if root.resolve() != expected_root:
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        self.root = expected_root
        self.database = database
        self.directory = self.root / "cache-v2" / project / self.input_sha256

    def _directory(self, *, create: bool = False) -> bool:
        try:
            if create:
                # All names are native-derived constants/digests. The first cache
                # directory is private, and no renderer path is accepted here.
                for directory in (
                    self.root,
                    self.directory.parent.parent,
                    self.directory.parent,
                    self.directory,
                ):
                    directory.mkdir(mode=0o700, exist_ok=True)
                    if directory.resolve() != directory or not directory.is_dir():
                        raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
            if not self.directory.exists() and not self.directory.is_symlink():
                return False
            if self.directory.resolve() != self.directory or not self.directory.is_dir():
                raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
            return True
        except OSError as error:
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE") from error

    def _manifest(self, name: str = "record.json") -> dict[str, object] | None:
        if not self._directory():
            return None
        path = self.directory / name
        if not path.exists() and not path.is_symlink():
            return None
        try:
            value = json.loads(_read(path, 2 * 1024 * 1024))
            if (
                not isinstance(value, dict)
                or type(value.get("schema")) is not int
                or value["schema"] not in {2, 3}
                or set(value)
                != (
                    {"schema", "project", "input_sha256", "parts"}
                    | ({"runtime_recipe"} if value["schema"] == 3 else set())
                )
                or value["project"] != self.project
                or value["input_sha256"] != self.input_sha256
                or not isinstance(value["parts"], dict)
                or not set(value["parts"]) <= set(_LIMITS)
            ):
                raise ValueError("shape")
            if value["schema"] == 3:
                validate_cache_runtime(value["runtime_recipe"])
            for role, row in value["parts"].items():
                if (
                    not isinstance(row, dict)
                    or set(row) != {"sha256", "bytes", "file"}
                    or not isinstance(row["sha256"], str)
                    or re.fullmatch(r"[a-f0-9]{64}", row["sha256"]) is None
                    or type(row["bytes"]) is not int
                    or not 0 < row["bytes"] <= _LIMITS[role]
                    or row["file"] != f"{role}-{row['sha256']}.bin"
                ):
                    raise ValueError("part")
            return value
        except (ValueError, TypeError, KeyError) as error:
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE") from error

    def part(self, role: Role) -> bytes | None:
        value = self._manifest()
        if value is None:
            return None
        parts = value["parts"]
        assert isinstance(parts, dict)
        row = parts.get(role)
        if row is None:
            return None
        data = _read(self.directory / row["file"], _LIMITS[role])
        if len(data) != row["bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        return data

    def bundle(self) -> tuple[bytes, bytes, bytes] | None:
        # All three files come from one immutable descriptor snapshot, never three
        # independently reread manifests during an in-progress regeneration.
        value = self._manifest("bundle.json") or self._manifest()
        if value is None:
            return None
        parts = value["parts"]
        assert isinstance(parts, dict)
        if not all(role in parts for role in ("image", "video", "voice")):
            return None
        result = []
        for role in ("image", "video", "voice"):
            row = parts[role]
            data = _read(self.directory / row["file"], _LIMITS[role])
            if len(data) != row["bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
                raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
            result.append(data)
        return result[0], result[1], result[2]

    def preparation_snapshot(self) -> dict[str, object] | None:
        """Observe one complete source snapshot, not a future permission to POST."""
        value = self._manifest("bundle.json") or self._manifest()
        if value is None:
            return None
        parts = value["parts"]
        assert isinstance(parts, dict)
        if set(parts) != set(_LIMITS):
            return None
        if value["schema"] != 3:
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        snapshot = validate_cache_snapshot(
            {
                "schema": 1,
                "input_sha256": self.input_sha256,
                "runtime_recipe": value["runtime_recipe"],
                "parts": {
                    role: {"sha256": part["sha256"], "bytes": part["bytes"]}
                    for role, part in parts.items()
                },
            },
            self.input_sha256,
        )
        self.read_snapshot(snapshot)
        return snapshot

    def read_snapshot(self, snapshot: object) -> tuple[bytes, bytes, bytes]:
        value = validate_cache_snapshot(snapshot, self.input_sha256)
        if not self._directory():
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        parts = value["parts"]
        assert isinstance(parts, dict)
        result = []
        for role in ("image", "video", "voice"):
            part = parts[role]
            data = _read(self.directory / f"{role}-{part['sha256']}.bin", _LIMITS[role])
            if len(data) != part["bytes"] or hashlib.sha256(data).hexdigest() != part["sha256"]:
                raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
            result.append(data)
        return result[0], result[1], result[2]

    def put_bundle(
        self,
        image: bytes,
        video: bytes,
        voice: bytes,
        *,
        runtime_recipe: dict[str, object] | None = None,
    ) -> None:
        identifier = hashlib.sha256(f"cache-v2:{self.input_sha256}".encode()).hexdigest()[:32]
        try:
            lock = VideoRecoveryLock(self.database, identifier)
        except VideoRecoveryBusy as error:
            raise StoryCreationCacheError("CACHE_BUSY") from error
        try:
            self._put("image", image)
            self._put("voice", voice)
            self._put("video", video, publish_bundle=runtime_recipe is None)
            if runtime_recipe is not None:
                validate_cache_runtime(runtime_recipe)
                value = self._manifest()
                if value is None:
                    raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
                value = {**value, "schema": 3, "runtime_recipe": runtime_recipe}
                pending = self.directory / f".{uuid4().hex}.bundle"
                try:
                    with pending.open("xb") as stream:
                        stream.write(_json(value))
                        stream.flush()
                        os.fsync(stream.fileno())
                    self._directory()
                    os.replace(pending, self.directory / "bundle.json")
                finally:
                    pending.unlink(missing_ok=True)
        finally:
            lock.close()

    def put(self, role: Role, data: bytes) -> None:
        # Reuse the shipped process-lifetime OS lock, in a stable opaque cache
        # namespace. No synthetic database is created and no timeout releases it.
        identifier = hashlib.sha256(f"cache-v2:{self.input_sha256}".encode()).hexdigest()[:32]
        try:
            lock = VideoRecoveryLock(self.database, identifier)
        except VideoRecoveryBusy as error:
            raise StoryCreationCacheError("CACHE_BUSY") from error
        try:
            self._put(role, data)
        finally:
            lock.close()

    def _put(self, role: Role, data: bytes, *, publish_bundle: bool = True) -> None:
        if not 0 < len(data) <= _LIMITS[role]:
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE")
        self._directory(create=True)
        value = self._manifest() or {
            "schema": 2,
            "project": self.project,
            "input_sha256": self.input_sha256,
            "parts": {},
        }
        digest = hashlib.sha256(data).hexdigest()
        name = f"{role}-{digest}.bin"
        temporary = self.directory / f".{uuid4().hex}.pending"
        record = self.directory / f".{uuid4().hex}.record"
        try:
            with os.fdopen(
                os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"
            ) as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, self.directory / name)
            except FileExistsError as error:
                if _read(self.directory / name, _LIMITS[role]) != data:
                    raise StoryCreationCacheError("CACHE_UNVERIFIABLE") from error
            parts = value["parts"]
            assert isinstance(parts, dict)
            previous = parts.get(role)
            parts[role] = {"sha256": digest, "bytes": len(data), "file": name}
            # A new voice cannot silently reuse an older associated video. Old
            # content-addressed media remains untouched and may still be referenced.
            if role in {"image", "voice"} and (previous is None or previous["sha256"] != digest):
                parts.pop("video", None)
            with os.fdopen(
                os.open(record, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"
            ) as stream:
                stream.write(_json(value))
                stream.flush()
                os.fsync(stream.fileno())
            self._directory()
            os.replace(record, self.directory / "record.json")
            if (
                publish_bundle
                and role == "video"
                and all(name in parts for name in ("image", "voice", "video"))
            ):
                with os.fdopen(
                    os.open(record, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"
                ) as stream:
                    stream.write(_json(value))
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(record, self.directory / "bundle.json")
        except OSError as error:
            raise StoryCreationCacheError("CACHE_UNVERIFIABLE") from error
        finally:
            temporary.unlink(missing_ok=True)
            record.unlink(missing_ok=True)
