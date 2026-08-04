import sqlite3
from pathlib import Path

import pytest
from aijian_api.repository import StudioRepository

NOW = "2026-08-04T09:30:00Z"
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


def create_workflow_database(path: Path) -> None:
    repository = StudioRepository(path)
    project = repository.create_project(
        name="黄金短篇",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "INSERT INTO workflow_definitions VALUES ('golden', 1, ?, '{}', ?)",
            (HASH_A, NOW),
        )
        connection.execute(
            """
            INSERT INTO workflow_runs VALUES (
                'wfr_golden', ?, 'golden', 1, ?, 'ACTIVE', 1, NULL, ?, ?
            )
            """,
            (project.id, HASH_A, NOW, NOW),
        )
        insert_node(connection, "node_render", "render.preview")
        connection.commit()


def insert_node(connection: sqlite3.Connection, node_id: str, node_key: str) -> None:
    connection.execute(
        """
        INSERT INTO workflow_node_runs (
            node_run_id, workflow_run_id, node_key, node_type, contract_version,
            input_bindings_json, input_hash, idempotency_key, status, attempt_count,
            max_attempts, revision, created_at, updated_at
        ) VALUES (?, 'wfr_golden', ?, ?, 1, '{}', ?, ?, 'PENDING', 0, 2, 1, ?, ?)
        """,
        (node_id, node_key, node_key, HASH_A, f"idem-{node_id}", NOW, NOW),
    )


def insert_attempt(
    connection: sqlite3.Connection,
    attempt_id: str,
    node_id: str,
    number: int,
    *,
    status: str = "READY",
    retry_disposition: str | None = None,
    provider_account_id: str | None = None,
    provider_idempotency_key: str | None = None,
) -> None:
    connection.execute(
        """
        INSERT INTO workflow_attempts (
            attempt_id, node_run_id, attempt_number, execution_mode, status,
            input_hash, request_fingerprint, provider_account_id,
            provider_idempotency_key, retry_disposition, revision, created_at, updated_at
        ) VALUES (?, ?, ?, 'remote', ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (
            attempt_id,
            node_id,
            number,
            status,
            HASH_A,
            HASH_B,
            provider_account_id,
            provider_idempotency_key,
            retry_disposition,
            NOW,
            NOW,
        ),
    )


def test_database_allows_only_one_blocking_attempt_per_node(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    create_workflow_database(database)

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        insert_attempt(connection, "att_1", "node_render", 1)
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint"):
            insert_attempt(connection, "att_2", "node_render", 2)


def test_remote_unknown_attempt_blocks_every_new_attempt(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    create_workflow_database(database)

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        insert_attempt(
            connection,
            "att_unknown",
            "node_render",
            1,
            status="REMOTE_UNKNOWN",
            retry_disposition="REMOTE_UNKNOWN",
        )
        with pytest.raises(sqlite3.IntegrityError, match="remote unknown"):
            insert_attempt(
                connection,
                "att_later",
                "node_render",
                2,
                status="FAILED",
                retry_disposition="NON_RETRYABLE",
            )


def test_provider_idempotency_key_is_unique_within_account(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    create_workflow_database(database)

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        insert_node(connection, "node_story", "story.extract")
        insert_attempt(
            connection,
            "att_render",
            "node_render",
            1,
            status="FAILED",
            provider_account_id="account-main",
            provider_idempotency_key="provider-key-1",
        )
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint"):
            insert_attempt(
                connection,
                "att_story",
                "node_story",
                1,
                status="FAILED",
                provider_account_id="account-main",
                provider_idempotency_key="provider-key-1",
            )


def test_leased_task_requires_complete_fencing_identity(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    create_workflow_database(database)

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        insert_attempt(connection, "att_1", "node_render", 1)
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            connection.execute(
                """
                INSERT INTO task_ledger VALUES (
                    'task_1', 'att_1', 'local.execute', 'LEASED', 50, ?,
                    NULL, NULL, 0, NULL, NULL, 1, ?, ?
                )
                """,
                (NOW, NOW, NOW),
            )


def test_transition_events_and_reconciliations_are_immutable(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    create_workflow_database(database)

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        insert_attempt(connection, "att_1", "node_render", 1)
        connection.execute(
            """
            INSERT INTO workflow_transition_events VALUES (
                'evt_1', 'attempt', 'att_1', 1, NULL, 'READY',
                'system', 'scheduler', 'attempt.created', NULL, ?
            )
            """,
            (NOW,),
        )
        connection.execute(
            """
            INSERT INTO remote_reconciliations VALUES (
                'rec_1', 'att_1', 'STILL_UNKNOWN', '{}', 'producer-user', ?
            )
            """,
            (NOW,),
        )
        connection.commit()
        with pytest.raises(sqlite3.IntegrityError, match="transition events are immutable"):
            connection.execute(
                "UPDATE workflow_transition_events SET reason_code = 'changed' "
                "WHERE event_id = 'evt_1'"
            )
        connection.rollback()
        with pytest.raises(sqlite3.IntegrityError, match="reconciliations are immutable"):
            connection.execute(
                "UPDATE remote_reconciliations SET decision = 'MATCHED_REMOTE_JOB' "
                "WHERE reconciliation_id = 'rec_1'"
            )
