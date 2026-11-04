"""Durable manual notes over exact local draft receipts; never a formal signoff."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import cast

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime
from aijian_api.draft_review_contracts import (
    CreateDraftReviewNoteRequest,
    DraftReviewData,
    DraftReviewIdentity,
    DraftReviewNote,
    DraftReviewResolution,
    DraftReviewTarget,
    ResolveDraftReviewNoteRequest,
)
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.repository import StudioRepository


class DraftReviewError(RuntimeError):
    def __init__(self, code: str, status: int = 409) -> None:
        super().__init__(code)
        self.code, self.status = code, status


def _json(value: dict[str, object]) -> str:
    return canonical_content_bytes(value).decode("utf-8")


def _identity(target: DraftReviewIdentity) -> dict[str, object]:
    return target.model_dump(include=set(DraftReviewIdentity.model_fields))


def _request_hash(target: DraftReviewTarget, payload: dict[str, object]) -> str:
    return canonical_content_hash({"target": target.model_dump(), "request": payload})


class DraftReviewStore:
    def __init__(self, repository: StudioRepository, runtime: DraftExportRuntime) -> None:
        self.repository, self.runtime = repository, runtime

    @staticmethod
    def _job(
        connection: sqlite3.Connection, project: str, episode: str, operation: str
    ) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM draft_export_jobs "
            "WHERE project_id=? AND episode_id=? AND operation_id=?",
            (project, episode, operation),
        ).fetchone()
        if row is None:
            raise DraftReviewError("DRAFT_REVIEW_NOT_FOUND", 404)
        return cast(sqlite3.Row, row)

    def _target(self, project: str, episode: str, operation: str) -> tuple[DraftReviewTarget, bool]:
        try:
            receipt = self.runtime.get(project, episode, operation)
        except DraftExportError as error:
            raise DraftReviewError("DRAFT_REVIEW_NOT_FOUND", 404) from error
        with self.repository._connection() as connection:
            row = self._job(connection, project, episode, operation)
            version_row = connection.execute(
                "SELECT version_number FROM artifact_versions WHERE version_id=?",
                (row["assembly_version_id"],),
            ).fetchone()
        if version_row is None:
            raise DraftReviewError("DRAFT_REVIEW_TARGET_CORRUPT")
        if not row["verification_json"] or not row["output_sha256"] or not row["output_bytes"]:
            raise DraftReviewError("DRAFT_REVIEW_NO_VERIFIED_OUTPUT")
        assembly = EpisodeMediaAssemblyStore(self.repository).read_version(
            project, episode, version_id=row["assembly_version_id"]
        )
        if (
            assembly.content_hash != row["assembly_content_hash"]
            or assembly.content.total_frames != row["total_frames"]
        ):
            raise DraftReviewError("DRAFT_REVIEW_TARGET_CORRUPT")
        rate = assembly.content.sequence_timebase.frame_rate
        target = DraftReviewTarget(
            project_id=project,
            episode_id=episode,
            operation_id=operation,
            assembly_version_id=assembly.version_id,
            assembly_content_hash=assembly.content_hash,
            assembly_version_number=version_row["version_number"],
            output_sha256=row["output_sha256"],
            output_bytes=row["output_bytes"],
            total_frames=assembly.content.total_frames,
            frame_rate_num=rate.num,
            frame_rate_den=rate.den,
        )
        return target, receipt.status == "SUCCEEDED"

    @staticmethod
    def _match(input_identity: DraftReviewIdentity, target: DraftReviewTarget) -> None:
        if _identity(input_identity) != _identity(target):
            raise DraftReviewError("DRAFT_REVIEW_TARGET_MISMATCH")

    @staticmethod
    def _notes(connection: sqlite3.Connection, target: DraftReviewTarget) -> list[DraftReviewNote]:
        rows = connection.execute(
            "SELECT n.*, r.resolution_id, r.request_hash AS resolution_request_hash, "
            "r.resolution_json, r.resolution_hash FROM draft_review_notes AS n "
            "LEFT JOIN draft_review_resolutions AS r ON r.note_id=n.note_id "
            "WHERE n.project_id=? AND n.episode_id=? AND n.operation_id=? "
            "ORDER BY json_extract(n.note_json, '$.created_at'), n.note_id LIMIT 501",
            (target.project_id, target.episode_id, target.operation_id),
        ).fetchall()
        if len(rows) > 500:
            raise DraftReviewError("DRAFT_REVIEW_HISTORY_CORRUPT")
        notes: list[DraftReviewNote] = []
        try:
            for row in rows:
                original = json.loads(row["note_json"])
                pinned = json.loads(row["target_json"])
                note = DraftReviewNote.model_validate(original)
                expected_request = {
                    **_identity(target),
                    "note_id": note.note_id,
                    "frame_index": note.frame_index,
                    "text": note.text,
                }
                if (
                    pinned != target.model_dump()
                    or canonical_content_hash(pinned) != row["target_hash"]
                    or canonical_content_hash(original) != row["note_hash"]
                    or row["request_hash"] != _request_hash(target, expected_request)
                    or row["assembly_version_id"] != target.assembly_version_id
                    or row["note_id"] != note.note_id
                    or note.revision != 1
                    or note.resolution is not None
                    or note.frame_index >= target.total_frames
                ):
                    raise ValueError("Invalid immutable note")
                if row["resolution_id"] is not None:
                    raw_resolution = json.loads(row["resolution_json"])
                    resolution = DraftReviewResolution.model_validate(raw_resolution)
                    expected_resolution = {
                        **_identity(target),
                        "note_id": note.note_id,
                        "resolution_id": resolution.resolution_id,
                        "expected_revision": 1,
                        "reason": resolution.reason,
                    }
                    if (
                        canonical_content_hash(raw_resolution) != row["resolution_hash"]
                        or resolution.resolution_id != row["resolution_id"]
                        or row["resolution_request_hash"]
                        != _request_hash(target, expected_resolution)
                    ):
                        raise ValueError("Invalid immutable resolution")
                    note = note.model_copy(update={"revision": 2, "resolution": resolution})
                notes.append(note)
        except (ValueError, TypeError, KeyError) as error:
            raise DraftReviewError("DRAFT_REVIEW_HISTORY_CORRUPT") from error
        return notes

    def list(self, project: str, episode: str, operation: str) -> DraftReviewData:
        target, verified = self._target(project, episode, operation)
        with self.repository._connection() as connection:
            notes = self._notes(connection, target)
        current_id, current_hash = None, None
        status: str = "UNKNOWN"
        try:
            current = EpisodeMediaAssemblyStore(self.repository).read_version(project, episode)
            current_id, current_hash = current.version_id, current.content_hash
            status = (
                "CURRENT"
                if (current_id, current_hash)
                == (target.assembly_version_id, target.assembly_content_hash)
                else "OLDER_VERSION"
            )
        except (LookupError, ValueError, RuntimeError, sqlite3.DatabaseError):
            pass
        return DraftReviewData.model_validate(
            {
                "target": target,
                "output_verified": verified,
                "current_assembly_version_id": current_id,
                "current_assembly_content_hash": current_hash,
                "version_status": status,
                "notes": notes,
                "manual_review_only": True,
            }
        )

    def create(
        self,
        project: str,
        episode: str,
        operation: str,
        request: CreateDraftReviewNoteRequest,
        actor_id: str,
    ) -> DraftReviewData:
        target, verified = self._target(project, episode, operation)
        self._match(request, target)
        if request.frame_index >= target.total_frames:
            raise DraftReviewError("DRAFT_REVIEW_FRAME_OUT_OF_RANGE")
        fingerprint = _request_hash(target, request.model_dump())
        with self.repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT * FROM draft_review_notes WHERE note_id=?", (request.note_id,)
            ).fetchone()
            if existing is not None:
                if existing["request_hash"] != fingerprint:
                    raise DraftReviewError("DRAFT_REVIEW_ID_REUSED")
                self._notes(connection, target)
            else:
                row = self._job(connection, project, episode, operation)
                if not verified or row["status"] != "SUCCEEDED":
                    raise DraftReviewError("DRAFT_REVIEW_OUTPUT_UNAVAILABLE")
                if (row["output_sha256"], row["output_bytes"]) != (
                    target.output_sha256,
                    target.output_bytes,
                ):
                    raise DraftReviewError("DRAFT_REVIEW_TARGET_MISMATCH")
                if len(self._notes(connection, target)) >= 500:
                    raise DraftReviewError("DRAFT_REVIEW_NOTE_LIMIT")
                note = DraftReviewNote(
                    note_id=request.note_id,
                    frame_index=request.frame_index,
                    text=request.text,
                    actor_id=actor_id,
                    created_at=datetime.now(UTC).isoformat(),
                    revision=1,
                    resolution=None,
                ).model_dump()
                pinned = target.model_dump()
                connection.execute(
                    "INSERT INTO draft_review_notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        request.note_id,
                        project,
                        episode,
                        operation,
                        target.assembly_version_id,
                        _json(pinned),
                        canonical_content_hash(pinned),
                        fingerprint,
                        _json(note),
                        canonical_content_hash(note),
                    ),
                )
            connection.commit()
        return self.list(project, episode, operation)

    def resolve(
        self,
        project: str,
        episode: str,
        operation: str,
        note_id: str,
        request: ResolveDraftReviewNoteRequest,
        actor_id: str,
    ) -> DraftReviewData:
        target, _verified = self._target(project, episode, operation)
        self._match(request, target)
        fingerprint = _request_hash(target, {**request.model_dump(), "note_id": note_id})
        with self.repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            notes = self._notes(connection, target)
            note = next((item for item in notes if item.note_id == note_id), None)
            if note is None:
                raise DraftReviewError("DRAFT_REVIEW_NOTE_NOT_FOUND", 404)
            existing = connection.execute(
                "SELECT * FROM draft_review_resolutions WHERE resolution_id=?",
                (request.resolution_id,),
            ).fetchone()
            if existing is not None:
                if existing["request_hash"] != fingerprint:
                    raise DraftReviewError("DRAFT_REVIEW_ID_REUSED")
            elif note.revision != request.expected_revision:
                raise DraftReviewError("DRAFT_REVIEW_REVISION_CONFLICT")
            else:
                resolution = DraftReviewResolution(
                    resolution_id=request.resolution_id,
                    reason=request.reason,
                    actor_id=actor_id,
                    created_at=datetime.now(UTC).isoformat(),
                ).model_dump()
                connection.execute(
                    "INSERT INTO draft_review_resolutions VALUES (?, ?, ?, ?, ?)",
                    (
                        request.resolution_id,
                        note_id,
                        fingerprint,
                        _json(resolution),
                        canonical_content_hash(resolution),
                    ),
                )
            connection.commit()
        return self.list(project, episode, operation)
