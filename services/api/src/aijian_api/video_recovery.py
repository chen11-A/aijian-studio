"""Explicit GET-only recovery of a previously submitted video, never a retry."""

from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path
from typing import Any
from uuid import uuid4

from aijian_api.generation_failure_store import GenerationFailureError, GenerationFailureStore
from aijian_api.repository import StudioRepository
from aijian_api.story_film import StoryFilmService
from aijian_api.video_recovery_lock import VideoRecoveryBusy, VideoRecoveryLock
from aijian_api.video_recovery_store import RecoverableVideo, VideoRecoveryStore
from aijian_api.xai_media import XaiMediaClient, XaiMediaError

MAX_RECOVERY_BYTES = 80 * 1024 * 1024


class VideoRecoveryService:
    def __init__(self, repository: StudioRepository, verifier: StoryFilmService) -> None:
        self._repository = repository
        self._store = VideoRecoveryStore(repository)
        self._verifier = verifier

    def _directory(self) -> Path:
        root = Path(self._repository.database_path).parent.resolve()
        directory = root / "story-films" / "recovered-videos"
        directory.mkdir(parents=True, exist_ok=True)
        if directory.resolve() != directory:
            raise GenerationFailureError("RECOVERY_OUTPUT_UNVERIFIABLE")
        return directory

    def _path(self, attempt_id: str) -> Path:
        return self._directory() / f"recovered-{attempt_id}.mp4"

    @staticmethod
    def _read_path(path: Path, sha256: str, size: int) -> bytes | None:
        if not 0 < size <= MAX_RECOVERY_BYTES:
            return None
        try:
            descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "rb") as stream:
                before = os.fstat(stream.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_size != size:
                    return None
                data = stream.read(MAX_RECOVERY_BYTES + 1)
                after = os.fstat(stream.fileno())
                named = path.lstat()
            fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
            if not stat.S_ISREG(named.st_mode) or any(
                getattr(before, key) != getattr(after, key)
                or getattr(after, key) != getattr(named, key)
                for key in fields
            ):
                return None
        except OSError:
            return None
        if len(data) != size or hashlib.sha256(data).hexdigest() != sha256:
            return None
        return data

    def _file(self, attempt_id: str, row: RecoverableVideo) -> dict[str, Any] | None:
        if row.output_sha256 is None or row.output_bytes is None:
            return None
        path = self._path(attempt_id)
        if self._read_path(path, row.output_sha256, row.output_bytes) is None:
            return None
        return {"fileName": path.name, "sha256": row.output_sha256, "bytes": row.output_bytes}

    def list(self, project: str, account: str) -> dict[str, Any]:
        identifiers, more = self._store.list_ids(project, account)
        items: list[dict[str, Any]] = []
        for identifier in identifiers:
            row = self._store.read(project, account, identifier)
            file = self._file(identifier, row)
            items.append(
                {
                    "attemptId": identifier,
                    "state": "RECOVERED" if file else "UNKNOWN",
                    **({"file": file} if file else {}),
                }
            )
        return {"kind": "ATTEMPTS", "items": items, "hasMore": more}

    def describe(self, project: str, account: str, attempt: str) -> dict[str, Any]:
        row = self._store.read(project, account, attempt)
        file = self._file(attempt, row)
        if file:
            return {"kind": "RECOVERED", "attemptId": attempt, "file": file}
        return self._unknown(attempt, "NO_VALID_VIDEO")

    def recover(
        self, project: str, account: str, attempt: str, client: XaiMediaClient
    ) -> dict[str, Any]:
        # Validate membership before deriving any lock or file name.
        row = self._store.read(project, account, attempt)
        try:
            lock = VideoRecoveryLock(Path(self._repository.database_path), attempt)
        except VideoRecoveryBusy:
            return {"kind": "FAILED", "code": "BUSY"}
        try:
            row = self._store.read(project, account, attempt)
            file = self._file(attempt, row)
            if file:
                return {"kind": "RECOVERED", "attemptId": attempt, "file": file}
            if row.status in {"FAILED", "SUCCEEDED"}:
                return self._unknown(attempt, "NO_VALID_VIDEO")
            try:
                polled = client.poll_video(row.provider_request_id)
                if polled.status in {"failed", "expired"}:
                    GenerationFailureStore(self._repository).settle(
                        project, row.reservation, "FAILED"
                    )
                    return self._unknown(attempt, "PROVIDER_FAILED")
                if polled.status != "done" or not polled.video_url:
                    return self._unknown(attempt, "WAITING")
                data = client.download(polled.video_url)
            except XaiMediaError:
                return self._unknown(attempt, "UNREACHABLE")
            if (
                not data
                or len(data) > MAX_RECOVERY_BYTES
                or not self._verifier._verified_video_bytes(data)
            ):
                return self._unknown(attempt, "NO_VALID_VIDEO")
            digest = hashlib.sha256(data).hexdigest()
            path = self._path(attempt)
            temporary = path.with_name(f".{uuid4().hex}.pending")
            try:
                with temporary.open("xb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    if self._read_path(path, digest, len(data)) is None:
                        return self._unknown(attempt, "NO_VALID_VIDEO")
                # Re-read exactly the preserved public-to-main bytes before settlement.
                if self._read_path(path, digest, len(data)) is None:
                    return self._unknown(attempt, "NO_VALID_VIDEO")
                self._store.complete(project, account, attempt, digest, len(data))
            finally:
                temporary.unlink(missing_ok=True)
            return {
                "kind": "RECOVERED",
                "attemptId": attempt,
                "file": {"fileName": path.name, "sha256": digest, "bytes": len(data)},
            }
        finally:
            lock.close()

    def bytes(self, project: str, account: str, attempt: str) -> bytes:
        row = self._store.read(project, account, attempt)
        data = (
            self._read_path(self._path(attempt), row.output_sha256, row.output_bytes)
            if row.output_sha256 is not None and row.output_bytes is not None
            else None
        )
        if data is None:
            raise GenerationFailureError("RECOVERY_OUTPUT_UNVERIFIABLE")
        return data

    @staticmethod
    def _unknown(attempt: str, reason: str) -> dict[str, Any]:
        return {"kind": "UNKNOWN", "attemptId": attempt, "reason": reason}
