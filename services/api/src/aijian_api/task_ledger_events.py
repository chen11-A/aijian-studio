"""Append-only transition event writes for workflow entities."""

import sqlite3
from collections.abc import Callable
from typing import Literal

type EventEntityKind = Literal["node", "attempt", "task"]


def append_event(
    connection: sqlite3.Connection,
    id_factory: Callable[[str], str],
    entity_kind: EventEntityKind,
    entity_id: str,
    from_status: str | None,
    to_status: str,
    reason_code: str,
    created_at: str,
    *,
    actor_id: str = "local-scheduler",
    lease_generation: int | None = None,
) -> None:
    sequence = int(
        connection.execute(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM workflow_transition_events "
            "WHERE entity_kind = ? AND entity_id = ?",
            (entity_kind, entity_id),
        ).fetchone()[0]
    )
    actor_kind = "worker" if lease_generation is not None else "system"
    connection.execute(
        """
        INSERT INTO workflow_transition_events VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        """,
        (
            id_factory("evt"),
            entity_kind,
            entity_id,
            sequence,
            from_status,
            to_status,
            actor_kind,
            actor_id,
            reason_code,
            lease_generation,
            created_at,
        ),
    )
