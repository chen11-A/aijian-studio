"""Private persistent prerequisites of the original per-target StoryFilm recipe.

Only the native-attested service constructs these rows. Execution IDs, counts, stage
grouping and future take IDs never participate in the existing failure identity.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from dataclasses import dataclass
from uuid import uuid4

from aijian_api.generation_dispatch_identity import story_creation_input_identity
from aijian_api.generation_failure_store import (
    FailureReservation,
    GenerationFailureError,
    GenerationFailureStore,
)
from aijian_api.repository import StudioRepository

_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_KEY = re.compile(r"[a-zA-Z0-9_:@.-]{1,160}\Z")


@dataclass(frozen=True, slots=True)
class PreparedTarget:
    key: str
    recipe: dict[str, object]
    versions: int
    first_regenerate: bool = False
    body: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class PreparedStage:
    key: str
    native_specification: dict[str, object]
    target_keys: tuple[str, ...]


def _json(value: object) -> str:
    try:
        result = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise GenerationFailureError("INVALID_DISPATCH_IDENTITY") from error
    if len(result.encode()) > 1024 * 1024:
        raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
    return result


class PreparedGenerationStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._ledger = GenerationFailureStore(repository, scope="story_creation")

    def register(
        self,
        project_id: str,
        *,
        account: str,
        execution_key: str,
        targets: tuple[PreparedTarget, ...],
        stages: tuple[PreparedStage, ...],
    ) -> str:
        if (
            not _DIGEST.fullmatch(account)
            or not _KEY.fullmatch(execution_key)
            or not 1 <= len(targets) <= 256
            or len(stages) > 1024
        ):
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        keys = {target.key for target in targets}
        if len(keys) != len(targets) or any(not _KEY.fullmatch(key) for key in keys):
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        target_rows = []
        for target in targets:
            if (
                type(target.versions) is not int
                or not 1 <= target.versions <= 3
                or type(target.first_regenerate) is not bool
            ):
                raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
            target_rows.append(
                (
                    target.key,
                    story_creation_input_identity(account, [target.recipe]),
                    _json(target.recipe),
                    target.versions,
                    int(target.first_regenerate),
                    _json(target.body or {}),
                )
            )
        if len({stage.key for stage in stages}) != len(stages):
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        for stage in stages:
            if (
                not _KEY.fullmatch(stage.key)
                or not stage.target_keys
                or len(set(stage.target_keys)) != len(stage.target_keys)
                or not set(stage.target_keys) <= keys
            ):
                raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
            _json(stage.native_specification)
        identifier = uuid4().hex
        with self._ledger._transaction() as connection:
            self._ledger._project(connection, project_id)
            connection.execute(
                "INSERT INTO prepared_generation_execution "
                "(id,project_id,account_sha256,execution_key_sha256) VALUES(?,?,?,?)",
                (
                    identifier,
                    project_id,
                    account,
                    hashlib.sha256(execution_key.encode()).hexdigest(),
                ),
            )
            connection.executemany(
                "INSERT INTO prepared_generation_target VALUES(?,?,?,?,?,?,?)",
                [(identifier, *row) for row in target_rows],
            )
            for stage in stages:
                connection.execute(
                    "INSERT INTO prepared_generation_stage VALUES(?,?,?,NULL,NULL,'UNSENT')",
                    (identifier, stage.key, _json(stage.native_specification)),
                )
                connection.executemany(
                    "INSERT INTO prepared_generation_dependency VALUES(?,?,?)",
                    [(identifier, stage.key, key) for key in stage.target_keys],
                )
        return identifier

    @staticmethod
    def _execution(
        connection: sqlite3.Connection,
        project_id: str,
        execution_id: str,
        account: str,
        *,
        allow_retired: bool = False,
    ) -> None:
        row = connection.execute(
            "SELECT account_sha256,retired FROM prepared_generation_execution "
            "WHERE id=? AND project_id=?",
            (execution_id, project_id),
        ).fetchone()
        if row is None or row[0] != account or (row[1] and not allow_retired):
            raise GenerationFailureError("EXECUTION_UNAVAILABLE")

    def _prepared_hold(
        self,
        connection: sqlite3.Connection,
        project_id: str,
        execution_id: str,
        identity: str,
        attempt_key: str,
    ) -> FailureReservation:
        """Only already confirmed stages of this execution may share a first hold.

        Cross-execution PENDING/UNKNOWN is an unresolved provider operation, not a
        spare failure allowance. Raising N or changing a local locator cannot free it.
        """
        pending = connection.execute(
            "SELECT id,input_sha256,status FROM story_creation_failure_attempt "
            "WHERE project_id=? AND input_sha256=? AND status IN ('PENDING','UNKNOWN')",
            (project_id, identity),
        ).fetchall()
        available = None
        for identifier, digest, status in pending:
            owned = connection.execute(
                "SELECT 1 FROM prepared_generation_slot "
                "WHERE execution_id=? AND attempt_id=? LIMIT 1",
                (execution_id, identifier),
            ).fetchone()
            bound = connection.execute(
                "SELECT 1 FROM prepared_generation_slot "
                "WHERE attempt_id=? AND take_key IS NOT NULL LIMIT 1",
                (identifier,),
            ).fetchone()
            if status == "UNKNOWN" or owned is None or bound is not None or available is not None:
                raise GenerationFailureError("ATTEMPT_ALREADY_RESERVED")
            available = FailureReservation(identifier, digest)
        return available or self._ledger.reserve_in_transaction(
            connection,
            project_id,
            input_sha256=identity,
            attempt_key_sha256=hashlib.sha256(attempt_key.encode()).hexdigest(),
        )

    def before_image(
        self, project_id: str, execution_id: str, *, account: str, stage_key: str, body_sha256: str
    ) -> tuple[FailureReservation, ...]:
        """Atomically protect the native-derived dependents of one real POST.

        Calling this method commits PENDING before transport. Any later uncertainty
        stays occupied. A request's mere successful return is not a successful video.
        """
        if not _DIGEST.fullmatch(body_sha256):
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        with self._ledger._transaction() as connection:
            self._execution(connection, project_id, execution_id, account)
            parent = connection.execute(
                "SELECT failure_limit FROM story_creation_failure_policy WHERE project_id=?",
                (project_id,),
            ).fetchone()
            if parent is None:
                raise GenerationFailureError("UNCONFIGURED")
            if parent[0] == 0:
                raise GenerationFailureError("INPUT_FAILURE_LIMIT")
            video = connection.execute(
                "SELECT failure_limit FROM generation_failure_policy WHERE project_id=?",
                (project_id,),
            ).fetchone()
            if video is None:
                raise GenerationFailureError("VIDEO_UNCONFIGURED")
            if video[0] == 0:
                raise GenerationFailureError("VIDEO_INPUT_FAILURE_LIMIT")
            stage = connection.execute(
                "SELECT status FROM prepared_generation_stage WHERE execution_id=? AND stage_key=?",
                (execution_id, stage_key),
            ).fetchone()
            if stage is None or stage[0] != "UNSENT":
                raise GenerationFailureError("ATTEMPT_ALREADY_RESERVED")
            dependencies = connection.execute(
                "SELECT t.target_key,t.input_sha256 FROM prepared_generation_dependency d "
                "JOIN prepared_generation_target t ON t.execution_id=d.execution_id "
                "AND t.target_key=d.target_key WHERE d.execution_id=? AND d.stage_key=? "
                "ORDER BY t.target_key",
                (execution_id, stage_key),
            ).fetchall()
            if not dependencies:
                raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
            # Identical creative targets share this prerequisite's first hold. This
            # does not admit a second video: video entry separately binds one slot.
            reservations: dict[str, FailureReservation] = {}
            for key, identity in dependencies:
                available = self._first_active_slot(connection, execution_id, key)
                if available is None:
                    continue
                old = connection.execute(
                    "SELECT a.status,s.take_key FROM prepared_generation_slot s "
                    "JOIN story_creation_failure_attempt a ON a.id=s.attempt_id "
                    "WHERE s.execution_id=? AND s.target_key=? AND s.slot_index=?",
                    (execution_id, key, available),
                ).fetchone()
                if old is not None and (
                    old[0] not in {"PENDING", "SUCCEEDED"} or old[1] is not None
                ):
                    raise GenerationFailureError("ATTEMPT_ALREADY_RESERVED")
                reservation = reservations.get(identity)
                if reservation is None:
                    reservation = self._prepared_hold(
                        connection,
                        project_id,
                        execution_id,
                        identity,
                        f"prepared-v1:{execution_id}:{key}:{available}",
                    )
                    reservations[identity] = reservation
                connection.execute(
                    "INSERT INTO prepared_generation_slot "
                    "(execution_id,target_key,slot_index,attempt_id) VALUES(?,?,?,?) "
                    "ON CONFLICT(execution_id,target_key,slot_index) DO UPDATE "
                    "SET attempt_id=excluded.attempt_id,child_state='UNSENT'",
                    (execution_id, key, available, reservation.attempt_id),
                )
            if not reservations:
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            connection.execute(
                "UPDATE prepared_generation_stage SET status='PENDING',body_sha256=? "
                "WHERE execution_id=? AND stage_key=?",
                (body_sha256, execution_id, stage_key),
            )
            return tuple(reservations.values())

    @staticmethod
    def _first_active_slot(
        connection: sqlite3.Connection, execution_id: str, target_key: str
    ) -> int | None:
        row = connection.execute(
            "SELECT slot_count FROM prepared_generation_target "
            "WHERE execution_id=? AND target_key=?",
            (execution_id, target_key),
        ).fetchone()
        if row is None:
            return None
        retired = {
            row[0]
            for row in connection.execute(
                "SELECT slot_index FROM prepared_generation_retired_slot "
                "WHERE execution_id=? AND target_key=?",
                (execution_id, target_key),
            )
        }
        consumed = {
            item[0]
            for item in connection.execute(
                "SELECT slot_index FROM prepared_generation_slot "
                "WHERE execution_id=? AND target_key=? AND take_key IS NOT NULL",
                (execution_id, target_key),
            )
        }
        return next((index for index in range(row[0]) if index not in retired | consumed), None)

    def arm_video(
        self,
        project_id: str,
        execution_id: str,
        *,
        account: str,
        target_key: str,
        slot_index: int,
        take_key: str,
        body_sha256: str,
        runtime_recipe: dict[str, object],
        expected_sources: list[dict[str, object]],
    ) -> str:
        """Pin exactly one native-verified wire body; this does not admit a POST."""
        if (
            type(slot_index) is not int
            or not 0 <= slot_index <= 2
            or not _KEY.fullmatch(take_key)
            or not _DIGEST.fullmatch(body_sha256)
        ):
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        identifier = uuid4().hex
        with self._ledger._transaction() as connection:
            self._execution(connection, project_id, execution_id, account)
            self._video_slot(connection, execution_id, target_key, slot_index)
            try:
                connection.execute(
                    "INSERT INTO prepared_generation_video_arm VALUES(?,?,?,?,?,?,?,?,?,NULL)",
                    (
                        identifier,
                        execution_id,
                        target_key,
                        slot_index,
                        take_key,
                        body_sha256,
                        _json(runtime_recipe),
                        _json(expected_sources),
                        int(time.time()),
                    ),
                )
            except sqlite3.IntegrityError as error:
                raise GenerationFailureError("ATTEMPT_ALREADY_RESERVED") from error
        return identifier

    @staticmethod
    def _video_slot(
        connection: sqlite3.Connection,
        execution: str,
        target: str,
        slot: int,
    ) -> None:
        row = connection.execute(
            "SELECT slot_count FROM prepared_generation_target "
            "WHERE execution_id=? AND target_key=?",
            (execution, target),
        ).fetchone()
        retired = connection.execute(
            "SELECT 1 FROM prepared_generation_retired_slot "
            "WHERE execution_id=? AND target_key=? AND slot_index=?",
            (execution, target, slot),
        ).fetchone()
        if row is None or not 0 <= slot < row[0] or retired:
            raise GenerationFailureError("EXECUTION_UNAVAILABLE")

    def video_context(
        self,
        project_id: str,
        *,
        account: str,
        arm_id: str,
        body_sha256: str,
        require_ready: bool = True,
    ) -> str:
        """Read-only inspection before any new generation; never a media grant."""
        with self._ledger._transaction() as connection:
            row = connection.execute(
                "SELECT execution_id,target_key,slot_index,body_sha256,created_at,"
                "claimed_key_sha256 "
                "FROM prepared_generation_video_arm WHERE id=?",
                (arm_id,),
            ).fetchone()
            if row is None or row[3] != body_sha256:
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            age = time.time() - row[4]
            if age < 0 or (age > 120 and row[5] is None):
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            self._execution(connection, project_id, row[0], account)
            self._video_slot(connection, row[0], row[1], row[2])
            incomplete = connection.execute(
                "SELECT 1 FROM prepared_generation_dependency d "
                "JOIN prepared_generation_stage s ON s.execution_id=d.execution_id "
                "AND s.stage_key=d.stage_key WHERE d.execution_id=? AND d.target_key=? "
                "AND s.status<>'READABLE' LIMIT 1",
                (row[0], row[1]),
            ).fetchone()
            if require_ready and incomplete:
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            return str(
                connection.execute(
                    "SELECT input_sha256 FROM prepared_generation_target "
                    "WHERE execution_id=? AND target_key=?",
                    (row[0], row[1]),
                ).fetchone()[0]
            )

    def original_video_recipe(
        self,
        project_id: str,
        *,
        account: str,
        arm_id: str,
        body_sha256: str,
    ) -> dict[str, object]:
        self.video_context(
            project_id,
            account=account,
            arm_id=arm_id,
            body_sha256=body_sha256,
            require_ready=False,
        )
        with self._ledger._transaction() as connection:
            row = connection.execute(
                "SELECT t.original_recipe_json FROM prepared_generation_video_arm a "
                "JOIN prepared_generation_target t ON t.execution_id=a.execution_id "
                "AND t.target_key=a.target_key WHERE a.id=?",
                (arm_id,),
            ).fetchone()
            if row is None:
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            result = json.loads(row[0])
            if not isinstance(result, dict):
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            return result

    def runtime_video_recipe(
        self,
        project_id: str,
        *,
        account: str,
        arm_id: str,
        body_sha256: str,
    ) -> dict[str, object]:
        self.video_context(
            project_id,
            account=account,
            arm_id=arm_id,
            body_sha256=body_sha256,
            require_ready=False,
        )
        with self._ledger._transaction() as connection:
            row = connection.execute(
                "SELECT runtime_recipe_json FROM prepared_generation_video_arm WHERE id=?",
                (arm_id,),
            ).fetchone()
            if row is None:
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            result = json.loads(row[0])
            if not isinstance(result, dict):
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            return result

    def runtime_video_sources(
        self,
        project_id: str,
        *,
        account: str,
        arm_id: str,
        body_sha256: str,
    ) -> object:
        self.video_context(
            project_id,
            account=account,
            arm_id=arm_id,
            body_sha256=body_sha256,
            require_ready=False,
        )
        with self._ledger._transaction() as connection:
            row = connection.execute(
                "SELECT runtime_sources_json FROM prepared_generation_video_arm WHERE id=?",
                (arm_id,),
            ).fetchone()
            if row is None:
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            return json.loads(row[0])

    def claim_video(
        self,
        project_id: str,
        *,
        account: str,
        arm_id: str,
        body_sha256: str,
        idempotency_key: str,
    ) -> FailureReservation:
        """Atomic first transport admission, never a new-key or shared-hold replay.

        A prerequisite hold may reference multiple equivalent targets. Only its
        first actual video can adopt it. Proven success permits another distinct
        attempt in the same input bucket; unresolved or failed holds cannot do so.
        """
        if not _DIGEST.fullmatch(body_sha256) or not idempotency_key:
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        request_key = hashlib.sha256(idempotency_key.encode()).hexdigest()
        with self._ledger._transaction() as connection:
            row = connection.execute(
                "SELECT execution_id,target_key,slot_index,take_key,body_sha256,"
                "created_at,claimed_key_sha256 FROM prepared_generation_video_arm WHERE id=?",
                (arm_id,),
            ).fetchone()
            if row is None or row[4] != body_sha256 or not 0 <= time.time() - row[5] <= 120:
                raise GenerationFailureError("EXECUTION_UNAVAILABLE")
            execution, target, slot, take, _, _, old_key = row
            self._execution(connection, project_id, execution, account)
            self._video_slot(connection, execution, target, slot)
            if old_key is not None:
                # Even the same request cannot dispatch again. Its existing
                # idempotency/task GET path must return the stored observation.
                raise GenerationFailureError("ATTEMPT_ALREADY_RESERVED")
            identity = connection.execute(
                "SELECT input_sha256 FROM prepared_generation_target "
                "WHERE execution_id=? AND target_key=?",
                (execution, target),
            ).fetchone()[0]
            previous = connection.execute(
                "SELECT a.id,a.input_sha256,a.status,s.take_key FROM prepared_generation_slot s "
                "JOIN story_creation_failure_attempt a ON a.id=s.attempt_id "
                "WHERE s.execution_id=? AND s.target_key=? AND s.slot_index=?",
                (execution, target, slot),
            ).fetchone()
            if previous is not None and (
                previous[3] is not None or previous[2] not in {"PENDING", "SUCCEEDED"}
            ):
                raise GenerationFailureError("ATTEMPT_ALREADY_RESERVED")
            reservation = self._prepared_hold(
                connection,
                project_id,
                execution,
                identity,
                f"prepared-video-v1:{execution}:{target}:{slot}",
            )
            connection.execute(
                "INSERT INTO prepared_generation_slot "
                "(execution_id,target_key,slot_index,attempt_id,take_key,child_state) "
                "VALUES(?,?,?,?,?,'IN_FLIGHT') ON CONFLICT(execution_id,target_key,slot_index) "
                "DO UPDATE SET attempt_id=excluded.attempt_id,take_key=excluded.take_key,"
                "child_state=excluded.child_state",
                (execution, target, slot, reservation.attempt_id, take),
            )
            connection.execute(
                "UPDATE prepared_generation_video_arm SET claimed_key_sha256=? WHERE id=?",
                (request_key, arm_id),
            )
            return reservation

    def video_not_sent(self, project_id: str, *, account: str, arm_id: str) -> None:
        """Actual synchronous transport-entry negative proof, not a retire ACK."""
        with self._ledger._transaction() as connection:
            arm = connection.execute(
                "SELECT execution_id,target_key,slot_index,claimed_key_sha256 "
                "FROM prepared_generation_video_arm WHERE id=?",
                (arm_id,),
            ).fetchone()
            if arm is None or arm[3] is None:
                raise GenerationFailureError("ATTEMPT_NOT_UNSUBMITTED")
            self._execution(connection, project_id, arm[0], account, allow_retired=True)
            row = connection.execute(
                "SELECT s.attempt_id,a.input_sha256,a.status FROM prepared_generation_slot s "
                "JOIN story_creation_failure_attempt a ON a.id=s.attempt_id "
                "WHERE s.execution_id=? AND s.target_key=? AND s.slot_index=?",
                (arm[0], arm[1], arm[2]),
            ).fetchone()
            if row is None or row[2] != "PENDING":
                raise GenerationFailureError("ATTEMPT_NOT_UNSUBMITTED")
            connection.execute(
                "UPDATE prepared_generation_slot SET child_state='UNSENT' "
                "WHERE execution_id=? AND target_key=? AND slot_index=?",
                (arm[0], arm[1], arm[2]),
            )
            sent_stage = connection.execute(
                "SELECT 1 FROM prepared_generation_slot s "
                "JOIN prepared_generation_dependency d ON d.execution_id=s.execution_id "
                "AND d.target_key=s.target_key JOIN prepared_generation_stage g "
                "ON g.execution_id=d.execution_id AND g.stage_key=d.stage_key "
                "WHERE s.attempt_id=? AND g.status NOT IN ('UNSENT','CLOSED_UNSENT') LIMIT 1",
                (row[0],),
            ).fetchone()
            if sent_stage is None:
                connection.execute(
                    "DELETE FROM prepared_generation_slot WHERE attempt_id=?",
                    (row[0],),
                )
                self._ledger.discard_in_transaction(
                    connection,
                    project_id,
                    FailureReservation(row[0], row[1]),
                )
            else:
                self._settle_retired(connection, project_id, arm[0])

    def observed_image(
        self,
        project_id: str,
        execution_id: str,
        *,
        account: str,
        stage_key: str,
        body_sha256: str,
        output_sha256: str | None,
    ) -> None:
        """A signed native observation records lineage, never releases parent holds."""
        if (
            not _DIGEST.fullmatch(body_sha256)
            or output_sha256 is not None
            and not _DIGEST.fullmatch(output_sha256)
        ):
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        with self._ledger._transaction() as connection:
            self._execution(connection, project_id, execution_id, account, allow_retired=True)
            changed = connection.execute(
                "UPDATE prepared_generation_stage SET status=?,output_sha256=? "
                "WHERE execution_id=? AND stage_key=? AND body_sha256=? "
                "AND status IN ('PENDING','UNKNOWN')",
                (
                    "READABLE" if output_sha256 is not None else "UNKNOWN",
                    output_sha256,
                    execution_id,
                    stage_key,
                    body_sha256,
                ),
            )
            if changed.rowcount != 1:
                raise GenerationFailureError("ATTEMPT_NOT_PENDING")
            if output_sha256 is None:
                attempts = connection.execute(
                    "SELECT DISTINCT a.id,a.input_sha256 FROM prepared_generation_dependency d "
                    "JOIN prepared_generation_slot s ON s.execution_id=d.execution_id "
                    "AND s.target_key=d.target_key "
                    "JOIN story_creation_failure_attempt a ON a.id=s.attempt_id "
                    "WHERE d.execution_id=? AND d.stage_key=? AND a.status='PENDING'",
                    (execution_id, stage_key),
                ).fetchall()
                for identifier, identity in attempts:
                    self._ledger.settle_in_transaction(
                        connection,
                        project_id,
                        FailureReservation(identifier, identity),
                        "UNKNOWN",
                    )
            self._settle_retired(connection, project_id, execution_id)

    def image_was_not_sent(
        self,
        project_id: str,
        execution_id: str,
        *,
        account: str,
        stage_key: str,
        body_sha256: str,
    ) -> None:
        """Only a main transport-entry observation can establish this negative fact.

        A retirement ACK, timeout or lack of an image is never this observation.
        It cannot erase an UNKNOWN transport or a readable/sent child's protection.
        """
        if not _DIGEST.fullmatch(body_sha256):
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        with self._ledger._transaction() as connection:
            self._execution(connection, project_id, execution_id, account, allow_retired=True)
            row = connection.execute(
                "SELECT body_sha256,status FROM prepared_generation_stage "
                "WHERE execution_id=? AND stage_key=?",
                (execution_id, stage_key),
            ).fetchone()
            if row is None or row[1] not in {"UNSENT", "PENDING", "CLOSED_UNSENT"}:
                raise GenerationFailureError("ATTEMPT_NOT_UNSUBMITTED")
            if row[0] is not None and row[0] != body_sha256:
                raise GenerationFailureError("ATTEMPT_NOT_UNSUBMITTED")
            connection.execute(
                "UPDATE prepared_generation_stage SET status='CLOSED_UNSENT',body_sha256=? "
                "WHERE execution_id=? AND stage_key=?",
                (body_sha256, execution_id, stage_key),
            )
            self._settle_retired(connection, project_id, execution_id)

    def retire(
        self,
        project_id: str,
        execution_id: str,
        *,
        account: str,
        target_key: str | None = None,
        slot_index: int | None = None,
    ) -> None:
        with self._ledger._transaction() as connection:
            self._execution(connection, project_id, execution_id, account, allow_retired=True)
            if target_key is None and slot_index is None:
                connection.execute(
                    "UPDATE prepared_generation_execution SET retired=1 WHERE id=?",
                    (execution_id,),
                )
            else:
                if not isinstance(target_key, str):
                    raise GenerationFailureError("EXECUTION_UNAVAILABLE")
                row = connection.execute(
                    "SELECT slot_count FROM prepared_generation_target "
                    "WHERE execution_id=? AND target_key=?",
                    (execution_id, target_key),
                ).fetchone()
                if row is None or type(slot_index) is not int or not 0 <= slot_index < row[0]:
                    raise GenerationFailureError("EXECUTION_UNAVAILABLE")
                connection.execute(
                    "INSERT OR IGNORE INTO prepared_generation_retired_slot VALUES(?,?,?)",
                    (execution_id, target_key, slot_index),
                )
                replacement = self._first_active_slot(connection, execution_id, target_key)
                if replacement is not None:
                    # A common image has not consumed a particular video's take. If
                    # its first planned take is cancelled before video handoff, keep
                    # that same prerequisite hold with a still-confirmed sibling slot.
                    # Once a take/internal POST is bound it cannot be transferred.
                    connection.execute(
                        "UPDATE prepared_generation_slot SET slot_index=? "
                        "WHERE execution_id=? AND target_key=? AND slot_index=? "
                        "AND take_key IS NULL AND child_state='UNSENT' "
                        "AND NOT EXISTS(SELECT 1 FROM prepared_generation_slot "
                        "WHERE execution_id=? AND target_key=? AND slot_index=?)",
                        (
                            replacement,
                            execution_id,
                            target_key,
                            slot_index,
                            execution_id,
                            target_key,
                            replacement,
                        ),
                    )
            self._settle_retired(connection, project_id, execution_id)

    def _settle_retired(
        self, connection: sqlite3.Connection, project_id: str, execution_id: str
    ) -> None:
        attempts = connection.execute(
            "SELECT DISTINCT a.id,a.input_sha256,a.status FROM prepared_generation_slot s "
            "JOIN story_creation_failure_attempt a ON a.id=s.attempt_id "
            "WHERE s.execution_id=? AND a.status IN ('PENDING','UNKNOWN')",
            (execution_id,),
        ).fetchall()
        for identifier, identity, status in attempts:
            active = connection.execute(
                "SELECT 1 FROM prepared_generation_slot s "
                "JOIN prepared_generation_execution e ON e.id=s.execution_id "
                "LEFT JOIN prepared_generation_retired_slot r ON r.execution_id=s.execution_id "
                "AND r.target_key=s.target_key AND r.slot_index=s.slot_index "
                "WHERE s.attempt_id=? AND e.retired=0 AND r.execution_id IS NULL",
                (identifier,),
            ).fetchone()
            if active is not None:
                continue
            states = {
                row[0]
                for row in connection.execute(
                    "SELECT child_state FROM prepared_generation_slot WHERE attempt_id=?",
                    (identifier,),
                )
            }
            stages = {
                row[0]
                for row in connection.execute(
                    "SELECT g.status FROM prepared_generation_slot s "
                    "JOIN prepared_generation_dependency d ON d.execution_id=s.execution_id "
                    "AND d.target_key=s.target_key "
                    "JOIN prepared_generation_stage g ON g.execution_id=d.execution_id "
                    "AND g.stage_key=d.stage_key WHERE s.attempt_id=?",
                    (identifier,),
                )
            }
            reservation = FailureReservation(identifier, identity)
            if "IN_FLIGHT" in states or "PENDING" in stages:
                continue  # A retirement ACK is not confirmation of a completed transport.
            if "UNKNOWN" in states or "UNKNOWN" in stages:
                self._ledger.settle_in_transaction(connection, project_id, reservation, "UNKNOWN")
            elif "KNOWN_COMPLETE" in states or "READABLE" in stages:
                self._ledger.settle_in_transaction(connection, project_id, reservation, "FAILED")
            elif states <= {"UNSENT"} and stages <= {"UNSENT", "CLOSED_UNSENT"}:
                if status != "PENDING":
                    continue  # Historical UNKNOWN is never silently reclassified as unsent.
                connection.execute(
                    "DELETE FROM prepared_generation_slot WHERE attempt_id=?", (identifier,)
                )
                self._ledger.discard_in_transaction(connection, project_id, reservation)

    def lineages(
        self, project_id: str, *, account: str, output_sha256s: tuple[str, ...]
    ) -> list[dict[str, object]]:
        """Main-only original lineage facts; a digest is not a media capability.

        Native still resolves the current canonical source and verifies its bytes,
        effective original recipe, field-specific effect and owner on every use.
        """
        if (
            not _DIGEST.fullmatch(account)
            or not 1 <= len(output_sha256s) <= 256
            or len(set(output_sha256s)) != len(output_sha256s)
            or any(not _DIGEST.fullmatch(value) for value in output_sha256s)
        ):
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        result: list[dict[str, object]] = []
        size = 0
        with self._ledger._transaction() as connection:
            self._ledger._project(connection, project_id)
            for output in output_sha256s:
                found = connection.execute(
                    "SELECT DISTINCT g.native_stage_json,t.original_recipe_json,t.input_sha256 "
                    "FROM prepared_generation_stage g "
                    "JOIN prepared_generation_execution e ON e.id=g.execution_id "
                    "JOIN prepared_generation_dependency d ON d.execution_id=g.execution_id "
                    "AND d.stage_key=g.stage_key "
                    "JOIN prepared_generation_target t ON t.execution_id=d.execution_id "
                    "AND t.target_key=d.target_key "
                    "WHERE e.project_id=? AND e.account_sha256=? AND g.status='READABLE' "
                    "AND g.output_sha256=? LIMIT 2049",
                    (project_id, account, output),
                ).fetchall()
                for stage, recipe, identity in found:
                    size += len(stage.encode()) + len(recipe.encode())
                    if len(result) >= 2048 or size > 8 * 1024 * 1024:
                        raise GenerationFailureError("INPUT_UNVERIFIABLE")
                    result.append(
                        {
                            "output_sha256": output,
                            "stage": json.loads(stage),
                            "original_recipe": json.loads(recipe),
                            "input_sha256": identity,
                        }
                    )
        return result
