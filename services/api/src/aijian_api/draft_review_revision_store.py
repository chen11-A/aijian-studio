"""Append-only manual revision linkage, with no execution or formal-review capability."""

from __future__ import annotations

import builtins
import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Never

from pydantic import BaseModel

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.draft_export_runtime import DraftExportRuntime
from aijian_api.draft_review_contracts import DraftReviewNote, DraftReviewTarget
from aijian_api.draft_review_revision_contracts import (
    ApproveDraftReviewRevisionPlanRequest,
    AttachDraftReviewRevisionCandidateRequest,
    CreateDraftReviewRevisionPlanRequest,
    DraftReviewRevisionApproval,
    DraftReviewRevisionCandidate,
    DraftReviewRevisionData,
    DraftReviewRevisionPlan,
    DraftReviewRevisionPlanEntry,
    DraftReviewRevisionRecheck,
    DraftReviewRevisionScopeData,
    DraftReviewRevisionSegment,
    RecheckDraftReviewRevisionCandidateRequest,
)
from aijian_api.draft_review_revision_output import validate_saved_draft_output
from aijian_api.draft_review_store import DraftReviewError, DraftReviewStore, _identity, _json
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.product_export_output_verify import _guarded_file_hash
from aijian_api.repository import StudioRepository


class DraftReviewRevisionError(DraftReviewError):
    pass


def _fail(code: str) -> Never:
    raise DraftReviewRevisionError("DRAFT_REVISION_" + code)


def _hash_event(value: dict[str, Any], hash_key: str) -> str:
    return canonical_content_hash({key: item for key, item in value.items() if key != hash_key})


def _time(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timezone required")
    return result


def _segments(content: Any) -> list[DraftReviewRevisionSegment]:
    result = []
    tracks: tuple[tuple[Literal["VISUAL", "AUDIO", "SUBTITLE"], Any], ...] = (
        ("VISUAL", content.visual_segments),
        ("AUDIO", content.audio_segments),
        ("SUBTITLE", content.subtitle_segments),
    )
    for track, segments in tracks:
        for segment in segments:
            result.append(
                DraftReviewRevisionSegment(
                    segment_id=segment.segment_id,
                    track_kind=segment.track_kind if track == "AUDIO" else track,
                    start_frame=segment.start_frame,
                    end_frame=segment.end_frame,
                    segment_hash=canonical_content_hash(segment.model_dump(mode="json")),
                    media=getattr(segment, "media", None),
                    storyboard_ref=getattr(segment, "storyboard_ref", None),
                )
            )
    return result


def _comparison(source: Any, candidate: Any, affected: set[str]) -> dict[str, Any]:
    old = {item.segment_id: item.segment_hash for item in _segments(source)}
    new = {item.segment_id: item.segment_hash for item in _segments(candidate)}
    same = sorted(key for key in old.keys() & new.keys() if old[key] == new[key])
    changed = sorted(key for key in old.keys() & new.keys() if old[key] != new[key])
    removed, added = sorted(old.keys() - new.keys()), sorted(new.keys() - old.keys())
    settings = ("sequence_timebase", "canvas_width", "canvas_height", "total_frames")
    return {
        "unchanged_segment_ids": same,
        "changed_segment_ids": changed,
        "removed_segment_ids": removed,
        "added_segment_ids": added,
        "out_of_scope_segment_ids": sorted((set(changed) | set(removed) | set(added)) - affected),
        "sequence_settings_changed": any(
            getattr(source, key) != getattr(candidate, key) for key in settings
        ),
    }


@dataclass(frozen=True)
class _Source:
    target: DraftReviewTarget
    output_verified: bool
    notes: list[DraftReviewNote]


class DraftReviewRevisionStore:
    def __init__(self, repository: StudioRepository, runtime: DraftExportRuntime) -> None:
        self.repository, self.runtime = repository, runtime
        self.review = DraftReviewStore(repository, runtime)
        self.assemblies = EpisodeMediaAssemblyStore(repository)

    def _target(self, project: str, episode: str, operation: str) -> tuple[DraftReviewTarget, bool]:
        # Unlike runtime.get, checking manual evidence must never mutate export jobs.
        with self.repository._connection() as connection:
            row = self.review._job(connection, project, episode, operation)
            version = connection.execute(
                "SELECT version_number FROM artifact_versions WHERE version_id=?",
                (row["assembly_version_id"],),
            ).fetchone()
        if (
            version is None
            or not row["verification_json"]
            or not row["output_sha256"]
            or not row["output_bytes"]
        ):
            _fail("NO_VERIFIED_OUTPUT")
        assembly = self.assemblies.read_version(
            project, episode, version_id=row["assembly_version_id"]
        )
        if (
            assembly.content_hash != row["assembly_content_hash"]
            or assembly.content.total_frames != row["total_frames"]
        ):
            _fail("TARGET_CORRUPT")
        try:
            validate_saved_draft_output(row, assembly)
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            raise DraftReviewRevisionError("DRAFT_REVISION_TARGET_CORRUPT") from error
        rate = assembly.content.sequence_timebase.frame_rate
        target = DraftReviewTarget(
            project_id=project,
            episode_id=episode,
            operation_id=operation,
            assembly_version_id=assembly.version_id,
            assembly_content_hash=assembly.content_hash,
            assembly_version_number=version[0],
            output_sha256=row["output_sha256"],
            output_bytes=row["output_bytes"],
            total_frames=assembly.content.total_frames,
            frame_rate_num=rate.num,
            frame_rate_den=rate.den,
        )
        verified = False
        if row["status"] == "SUCCEEDED":
            try:
                verified = _guarded_file_hash(Path(row["output_path"])) == (
                    target.output_sha256,
                    target.output_bytes,
                )
            except (OSError, ValueError):
                pass
        return target, verified

    def _source(self, project: str, episode: str, operation: str) -> _Source:
        target, verified = self._target(project, episode, operation)
        with self.repository._connection() as connection:
            notes = self.review._notes(connection, target)
        return _Source(target, verified, notes)

    def _assembly(self, target: Any) -> Any:
        assembly = self.assemblies.read_version(
            target.project_id, target.episode_id, version_id=target.assembly_version_id
        )
        if assembly.content_hash != target.assembly_content_hash:
            _fail("TARGET_CORRUPT")
        return assembly

    def scope(self, project: str, episode: str, operation: str) -> DraftReviewRevisionScopeData:
        source = self._source(project, episode, operation)
        return DraftReviewRevisionScopeData(
            source=source.target,
            output_verified=source.output_verified,
            segments=_segments(self._assembly(source.target).content),
        )

    @staticmethod
    def _decode(
        row: sqlite3.Row, model: Any, request_model: Any, parent: str, hash_key: str | None = None
    ) -> tuple[Any, Any]:
        try:
            raw, request = json.loads(row["event_json"]), json.loads(row["request_json"])
            event = model.model_validate(raw)
            command = request_model.model_validate(request)
            if (
                canonical_content_hash(raw) != row["event_hash"]
                or canonical_content_hash({"parent": parent, "request": request})
                != row["request_hash"]
            ):
                raise ValueError("Invalid evidence hash")
            id_key = {
                DraftReviewRevisionPlan: "plan_id",
                DraftReviewRevisionApproval: "approval_id",
                DraftReviewRevisionCandidate: "candidate_id",
                DraftReviewRevisionRecheck: "recheck_id",
            }[model]
            if raw[id_key] != row["event_id"] or getattr(command, id_key) != row["event_id"]:
                raise ValueError("Invalid event identity")
            if hash_key and raw[hash_key] != _hash_event(raw, hash_key):
                raise ValueError("Invalid immutable object hash")
            _time(event.created_at)
            return event, command
        except (ValueError, TypeError, KeyError) as error:
            raise DraftReviewRevisionError("DRAFT_REVISION_HISTORY_CORRUPT") from error

    def _history(self, connection: sqlite3.Connection, source: Any) -> list[dict[str, Any]]:
        original = self._assembly(source.target).content
        original_segments = {item.segment_id: item for item in _segments(original)}
        original_notes = {item.note_id: item for item in source.notes}
        rows = connection.execute(
            "SELECT * FROM draft_review_revision_plans "
            "WHERE project_id=? AND episode_id=? AND operation_id=? ORDER BY rowid LIMIT 101",
            (source.target.project_id, source.target.episode_id, source.target.operation_id),
        ).fetchall()
        if len(rows) > 100:
            _fail("HISTORY_CORRUPT")
        result = []
        target_cache: dict[str, tuple[DraftReviewTarget, bool]] = {}
        content_cache: dict[str, Any] = {}
        total_candidates = 0
        for row in rows:
            plan, request = self._decode(
                row,
                DraftReviewRevisionPlan,
                CreateDraftReviewRevisionPlanRequest,
                source.target.operation_id,
                "plan_hash",
            )
            selected = [item.note_id for item in plan.notes]
            affected = [item.segment_id for item in plan.affected_segments]
            junction_rows = connection.execute(
                "SELECT * FROM draft_review_revision_plan_notes WHERE plan_id=?", (plan.plan_id,)
            ).fetchall()
            junction = {item["note_id"] for item in junction_rows}
            scope = (source.target.project_id, source.target.episode_id, source.target.operation_id)
            if any(
                (item["project_id"], item["episode_id"], item["operation_id"]) != scope
                for item in junction_rows
            ):
                _fail("HISTORY_CORRUPT")
            if (
                plan.source != source.target
                or _identity(request) != _identity(source.target)
                or selected != request.note_ids
                or affected != request.affected_segment_ids
                or plan.instruction != request.instruction
                or set(selected) != junction
            ):
                _fail("HISTORY_CORRUPT")
            for note in plan.notes:
                current = original_notes.get(note.note_id)
                if current is None or note.model_dump() != current.model_dump(
                    include=set(type(note).model_fields)
                ):
                    _fail("HISTORY_CORRUPT")
            if any(
                original_segments.get(item.segment_id) != item for item in plan.affected_segments
            ) or any(
                not any(
                    segment.start_frame <= note.frame_index < segment.end_frame
                    for segment in plan.affected_segments
                )
                for note in plan.notes
            ):
                _fail("HISTORY_CORRUPT")
            approval_row = connection.execute(
                "SELECT * FROM draft_review_revision_approvals WHERE plan_id=?", (plan.plan_id,)
            ).fetchone()
            approval = None
            if approval_row is not None:
                approval, approval_command = self._decode(
                    approval_row,
                    DraftReviewRevisionApproval,
                    ApproveDraftReviewRevisionPlanRequest,
                    plan.plan_id,
                )
                if (
                    approval.plan_id != plan.plan_id
                    or approval.plan_hash != plan.plan_hash
                    or approval_command.expected_plan_hash != plan.plan_hash
                    or _time(approval.created_at) < _time(plan.created_at)
                ):
                    _fail("HISTORY_CORRUPT")
            candidate_rows = connection.execute(
                "SELECT * FROM draft_review_revision_candidates "
                "WHERE plan_id=? ORDER BY rowid LIMIT 51",
                (plan.plan_id,),
            ).fetchall()
            total_candidates += len(candidate_rows)
            if len(candidate_rows) > 50 or total_candidates > 20:
                _fail("HISTORY_CORRUPT")
            candidates = []
            for candidate_row in candidate_rows:
                candidate, command = self._decode(
                    candidate_row,
                    DraftReviewRevisionCandidate,
                    AttachDraftReviewRevisionCandidateRequest,
                    plan.plan_id,
                    "candidate_hash",
                )
                if approval is None:
                    _fail("HISTORY_CORRUPT")
                candidate_operation = candidate.target.operation_id
                if candidate_operation not in target_cache:
                    target_cache[candidate_operation] = self._target(
                        source.target.project_id, source.target.episode_id, candidate_operation
                    )
                target, verified = target_cache[candidate_operation]
                if target.assembly_version_id not in content_cache:
                    content_cache[target.assembly_version_id] = self._assembly(target).content
                content = content_cache[target.assembly_version_id]
                if (
                    (candidate_row["project_id"], candidate_row["episode_id"]) != scope[:2]
                    or candidate.target != target
                    or candidate_row["operation_id"] != target.operation_id
                    or candidate_row["approval_id"] != approval.approval_id
                    or candidate.plan_id != plan.plan_id
                    or candidate.plan_hash != plan.plan_hash
                    or candidate.approval_id != approval.approval_id
                    or command.expected_plan_hash != plan.plan_hash
                    or command.approval_id != approval.approval_id
                    or command.candidate_operation_id != target.operation_id
                    or _identity(command) != _identity(target)
                    or command.change_summary != candidate.change_summary
                    or candidate.segments != _segments(content)
                    or candidate.comparison.model_dump()
                    != _comparison(original, content, set(affected))
                ):
                    _fail("HISTORY_CORRUPT")
                self._later(connection, source.target, target, approval)
                if _time(candidate.created_at) < _time(approval.created_at):
                    _fail("HISTORY_CORRUPT")
                recheck_row = connection.execute(
                    "SELECT * FROM draft_review_revision_rechecks WHERE candidate_id=?",
                    (candidate.candidate_id,),
                ).fetchone()
                recheck = None
                if recheck_row is not None:
                    recheck, check_command = self._decode(
                        recheck_row,
                        DraftReviewRevisionRecheck,
                        RecheckDraftReviewRevisionCandidateRequest,
                        candidate.candidate_id,
                    )
                    if (
                        recheck.candidate_id != candidate.candidate_id
                        or recheck.candidate_hash != candidate.candidate_hash
                        or check_command.expected_candidate_hash != candidate.candidate_hash
                        or check_command.reason != recheck.reason
                        or check_command.outcome != recheck.outcome
                        or _time(recheck.created_at) < _time(candidate.created_at)
                    ):
                        _fail("HISTORY_CORRUPT")
                candidates.append(
                    {"candidate": candidate, "output_verified": verified, "recheck": recheck}
                )
            result.append({"plan": plan, "approval": approval, "candidates": candidates})
        return result

    @staticmethod
    def _later(connection: sqlite3.Connection, source: Any, target: Any, approval: Any) -> None:
        job = DraftReviewStore._job(
            connection, target.project_id, target.episode_id, target.operation_id
        )
        version = connection.execute(
            "SELECT created_at FROM artifact_versions WHERE version_id=?",
            (target.assembly_version_id,),
        ).fetchone()
        if (
            target.operation_id == source.operation_id
            or target.assembly_version_id == source.assembly_version_id
            or target.assembly_version_number <= approval.assembly_version_number_at_approval
            or version is None
            or _time(version[0]) <= _time(approval.created_at)
            or _time(job["created_at"]) <= _time(approval.created_at)
        ):
            _fail("CANDIDATE_NOT_LATER")

    def list(self, project: str, episode: str, operation: str) -> DraftReviewRevisionData:
        source = self._source(project, episode, operation)
        with self.repository._connection() as connection:
            plans = self._history(connection, source)
        return DraftReviewRevisionData(
            source=source.target,
            output_verified=source.output_verified,
            plans=[DraftReviewRevisionPlanEntry.model_validate(plan) for plan in plans],
        )

    @staticmethod
    def _budget(
        source: _Source, history: builtins.list[dict[str, Any]], kind: str, event: dict[str, Any]
    ) -> None:
        # Leave room under the native transport's existing 16 MiB ceiling.
        data = DraftReviewRevisionData(
            source=source.target,
            output_verified=source.output_verified,
            plans=[DraftReviewRevisionPlanEntry.model_validate(plan) for plan in history],
        ).model_dump(mode="json")
        if kind == "plan":
            data["plans"].append({"plan": event, "approval": None, "candidates": []})
        else:
            plan_id = event.get("plan_id")
            if kind == "recheck":
                for entry in data["plans"]:
                    for candidate in entry["candidates"]:
                        if candidate["candidate"]["candidate_id"] == event["candidate_id"]:
                            candidate["recheck"] = event
            else:
                entry = next(item for item in data["plans"] if item["plan"]["plan_id"] == plan_id)
                if kind == "approval":
                    entry["approval"] = event
                else:
                    entry["candidates"].append(
                        {"candidate": event, "output_verified": True, "recheck": None}
                    )
        if len(canonical_content_bytes(data)) > 12 * 1024 * 1024:
            _fail("HISTORY_LIMIT")

    @staticmethod
    def _existing(
        connection: sqlite3.Connection, table: str, event_id: str, parent: str, request: Any
    ) -> bool:
        row = connection.execute(
            f"SELECT request_hash FROM {table} WHERE event_id=?", (event_id,)
        ).fetchone()
        if row is None:
            return False
        if row[0] != canonical_content_hash({"parent": parent, "request": request.model_dump()}):
            _fail("ID_REUSED")
        return True

    @staticmethod
    def _insert(
        connection: sqlite3.Connection,
        table: str,
        prefix: dict[str, Any],
        parent: str,
        request: Any,
        event: dict[str, Any],
    ) -> None:
        models: dict[str, type[BaseModel]] = {
            "draft_review_revision_plans": DraftReviewRevisionPlan,
            "draft_review_revision_approvals": DraftReviewRevisionApproval,
            "draft_review_revision_candidates": DraftReviewRevisionCandidate,
            "draft_review_revision_rechecks": DraftReviewRevisionRecheck,
        }
        model = models[table]
        event = model.model_validate(event).model_dump(mode="json")
        values = {
            **prefix,
            "request_json": _json(request.model_dump()),
            "request_hash": canonical_content_hash(
                {"parent": parent, "request": request.model_dump()}
            ),
            "event_json": _json(event),
            "event_hash": canonical_content_hash(event),
        }
        keys = ",".join(values)
        placeholders = ",".join("?" for _ in values)
        connection.execute(
            f"INSERT INTO {table} ({keys}) VALUES ({placeholders})", tuple(values.values())
        )

    @staticmethod
    def _verified(connection: sqlite3.Connection, target: Any, verified: bool) -> None:
        row = DraftReviewStore._job(
            connection, target.project_id, target.episode_id, target.operation_id
        )
        if (
            not verified
            or row["status"] != "SUCCEEDED"
            or (
                row["assembly_version_id"],
                row["assembly_content_hash"],
                row["output_sha256"],
                row["output_bytes"],
            )
            != (
                target.assembly_version_id,
                target.assembly_content_hash,
                target.output_sha256,
                target.output_bytes,
            )
        ):
            _fail("OUTPUT_UNAVAILABLE")
        try:
            if _guarded_file_hash(Path(row["output_path"])) != (
                target.output_sha256,
                target.output_bytes,
            ):
                _fail("OUTPUT_UNAVAILABLE")
        except (OSError, ValueError) as error:
            raise DraftReviewRevisionError("DRAFT_REVISION_OUTPUT_UNAVAILABLE") from error

    def create(
        self,
        project: str,
        episode: str,
        operation: str,
        request: CreateDraftReviewRevisionPlanRequest,
        actor_id: str,
    ) -> DraftReviewRevisionData:
        source = self._source(project, episode, operation)
        self.review._match(request, source.target)
        segments = {
            item.segment_id: item for item in _segments(self._assembly(source.target).content)
        }
        notes = {item.note_id: item for item in source.notes}
        if any(key not in notes for key in request.note_ids) or any(
            key not in segments for key in request.affected_segment_ids
        ):
            _fail("SELECTION_NOT_FOUND")
        selected = [
            notes[key].model_dump(
                include={"note_id", "frame_index", "text", "actor_id", "created_at"}
            )
            for key in request.note_ids
        ]
        affected = [segments[key].model_dump() for key in request.affected_segment_ids]
        if any(
            not any(
                item["start_frame"] <= note["frame_index"] < item["end_frame"] for item in affected
            )
            for note in selected
        ):
            _fail("NOTE_OUTSIDE_SEGMENTS")
        with self.repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            history = self._history(connection, source)
            if not self._existing(
                connection, "draft_review_revision_plans", request.plan_id, operation, request
            ):
                self._verified(connection, source.target, source.output_verified)
                if len(history) >= 100:
                    _fail("PLAN_LIMIT")
                event = {
                    "plan_id": request.plan_id,
                    "source": source.target.model_dump(),
                    "notes": selected,
                    "affected_segments": affected,
                    "instruction": request.instruction,
                    "actor_id": actor_id,
                    "created_at": datetime.now(UTC).isoformat(),
                }
                event["plan_hash"] = canonical_content_hash(event)
                self._budget(source, history, "plan", event)
                self._insert(
                    connection,
                    "draft_review_revision_plans",
                    {
                        "event_id": request.plan_id,
                        "project_id": project,
                        "episode_id": episode,
                        "operation_id": operation,
                    },
                    operation,
                    request,
                    event,
                )
                connection.executemany(
                    "INSERT INTO draft_review_revision_plan_notes VALUES (?, ?, ?, ?, ?)",
                    [
                        (request.plan_id, key, project, episode, operation)
                        for key in request.note_ids
                    ],
                )
            connection.commit()
        return self.list(project, episode, operation)

    def approve(
        self,
        project: str,
        episode: str,
        operation: str,
        plan_id: str,
        request: ApproveDraftReviewRevisionPlanRequest,
        actor_id: str,
    ) -> DraftReviewRevisionData:
        source = self._source(project, episode, operation)
        with self.repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            history = self._history(connection, source)
            entry = next((item for item in history if item["plan"].plan_id == plan_id), None)
            if entry is None:
                _fail("PLAN_NOT_FOUND")
            plan = entry["plan"]
            if request.expected_plan_hash != plan.plan_hash:
                _fail("PLAN_HASH_MISMATCH")
            if not self._existing(
                connection, "draft_review_revision_approvals", request.approval_id, plan_id, request
            ):
                if entry["approval"] is not None:
                    _fail("ALREADY_APPROVED")
                self._verified(connection, source.target, source.output_verified)
                maximum = connection.execute(
                    "SELECT MAX(v.version_number) FROM artifact_versions v "
                    "JOIN artifacts a ON a.artifact_id=v.artifact_id "
                    "WHERE a.project_id=? AND a.episode_id=? "
                    "AND a.artifact_type='episode_media_assembly'",
                    (project, episode),
                ).fetchone()[0]
                event = {
                    "approval_id": request.approval_id,
                    "plan_id": plan_id,
                    "plan_hash": plan.plan_hash,
                    "assembly_version_number_at_approval": maximum,
                    "actor_id": actor_id,
                    "created_at": datetime.now(UTC).isoformat(),
                }
                self._budget(source, history, "approval", event)
                self._insert(
                    connection,
                    "draft_review_revision_approvals",
                    {"event_id": request.approval_id, "plan_id": plan_id},
                    plan_id,
                    request,
                    event,
                )
            connection.commit()
        return self.list(project, episode, operation)

    def attach(
        self,
        project: str,
        episode: str,
        operation: str,
        plan_id: str,
        request: AttachDraftReviewRevisionCandidateRequest,
        actor_id: str,
    ) -> DraftReviewRevisionData:
        source = self._source(project, episode, operation)
        target, verified = self._target(project, episode, request.candidate_operation_id)
        self.review._match(request, target)
        content = self._assembly(target).content
        with self.repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            history = self._history(connection, source)
            entry = next((item for item in history if item["plan"].plan_id == plan_id), None)
            if entry is None:
                _fail("PLAN_NOT_FOUND")
            plan, approval = entry["plan"], entry["approval"]
            if approval is None or approval.approval_id != request.approval_id:
                _fail("EXPLICIT_APPROVAL_REQUIRED")
            if request.expected_plan_hash != plan.plan_hash:
                _fail("PLAN_HASH_MISMATCH")
            if not self._existing(
                connection,
                "draft_review_revision_candidates",
                request.candidate_id,
                plan_id,
                request,
            ):
                self._verified(connection, target, verified)
                self._later(connection, source.target, target, approval)
                if (
                    len(entry["candidates"]) >= 50
                    or sum(len(item["candidates"]) for item in history) >= 20
                ):
                    _fail("CANDIDATE_LIMIT")
                if any(
                    item["candidate"].target.operation_id == target.operation_id
                    for item in entry["candidates"]
                ):
                    _fail("CANDIDATE_ALREADY_ATTACHED")
                event = {
                    "candidate_id": request.candidate_id,
                    "plan_id": plan_id,
                    "plan_hash": plan.plan_hash,
                    "approval_id": approval.approval_id,
                    "target": target.model_dump(),
                    "segments": [item.model_dump() for item in _segments(content)],
                    "comparison": _comparison(
                        self._assembly(source.target).content,
                        content,
                        {item.segment_id for item in plan.affected_segments},
                    ),
                    "change_summary": request.change_summary,
                    "actor_id": actor_id,
                    "created_at": datetime.now(UTC).isoformat(),
                }
                event["candidate_hash"] = canonical_content_hash(event)
                self._budget(source, history, "candidate", event)
                self._insert(
                    connection,
                    "draft_review_revision_candidates",
                    {
                        "event_id": request.candidate_id,
                        "plan_id": plan_id,
                        "approval_id": approval.approval_id,
                        "operation_id": target.operation_id,
                        "project_id": project,
                        "episode_id": episode,
                    },
                    plan_id,
                    request,
                    event,
                )
            connection.commit()
        return self.list(project, episode, operation)

    def recheck(
        self,
        project: str,
        episode: str,
        operation: str,
        plan_id: str,
        candidate_id: str,
        request: RecheckDraftReviewRevisionCandidateRequest,
        actor_id: str,
    ) -> DraftReviewRevisionData:
        source = self._source(project, episode, operation)
        with self.repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            history = self._history(connection, source)
            plan = next((item for item in history if item["plan"].plan_id == plan_id), None)
            entry = (
                None
                if plan is None
                else next(
                    (
                        item
                        for item in plan["candidates"]
                        if item["candidate"].candidate_id == candidate_id
                    ),
                    None,
                )
            )
            if entry is None:
                _fail("CANDIDATE_NOT_FOUND")
            candidate = entry["candidate"]
            if request.expected_candidate_hash != candidate.candidate_hash:
                _fail("CANDIDATE_HASH_MISMATCH")
            if not self._existing(
                connection,
                "draft_review_revision_rechecks",
                request.recheck_id,
                candidate_id,
                request,
            ):
                if entry["recheck"] is not None:
                    _fail("ALREADY_RECHECKED")
                self._verified(connection, candidate.target, entry["output_verified"])
                event = {
                    "recheck_id": request.recheck_id,
                    "candidate_id": candidate_id,
                    "candidate_hash": candidate.candidate_hash,
                    "outcome": request.outcome,
                    "reason": request.reason,
                    "actor_id": actor_id,
                    "created_at": datetime.now(UTC).isoformat(),
                }
                self._budget(source, history, "recheck", event)
                self._insert(
                    connection,
                    "draft_review_revision_rechecks",
                    {"event_id": request.recheck_id, "candidate_id": candidate_id},
                    candidate_id,
                    request,
                    event,
                )
            connection.commit()
        return self.list(project, episode, operation)
