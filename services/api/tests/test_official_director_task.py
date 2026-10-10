"""Synthetic SQLite evidence only; official login and inference are never used."""

import json
import sqlite3
from pathlib import Path

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.official_director_schema import OFFICIAL_DIRECTOR_MIGRATION
from aijian_api.official_director_task import (
    begin_completion,
    reserve_task,
    settle_task,
    task_truth,
)
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from aijian_api.task_ledger_models import new_id
from aijian_api.task_queue_read import TaskQueueReader

NOW = "2026-10-08T12:00:00Z"
PROFILE = "synthetic-profile"
MODEL = "synthetic-official-model"
PROMPT_HASH = "sha256:" + "a" * 64


@pytest.fixture
def workspace(tmp_path: Path):
    repository = StudioRepository(tmp_path / "director.sqlite3")
    project = repository.create_project(
        name="Synthetic director",
        aspect_ratio="16:9",
        target_duration_seconds=60,
        source_language="zh-CN",
    ).id
    episode = repository.list_episodes(project)[0].id
    connection = sqlite3.connect(repository.database_path, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    if (
        connection.execute(
            "SELECT 1 FROM sqlite_master WHERE name = 'official_director_operations'"
        ).fetchone()
        is None
    ):
        connection.execute("BEGIN IMMEDIATE")
        for statement in OFFICIAL_DIRECTOR_MIGRATION:
            connection.execute(statement)
        connection.commit()
    yield repository, project, episode, connection
    connection.close()


def reserve(workspace, operation="synthetic-operation"):
    _, project, episode, connection = workspace
    connection.execute("BEGIN IMMEDIATE")
    ids = reserve_task(connection, project, operation, PROFILE, MODEL, PROMPT_HASH, NOW)
    request = {"operation_id": operation, "profile_id": PROFILE}
    connection.execute(
        """INSERT INTO official_director_operations (
        operation_id, project_id, episode_id, request_json, request_hash, status,
        created_at, task_id, attempt_id
        ) VALUES (?, ?, ?, ?, ?, 'REMOTE_UNKNOWN', ?, ?, ?)""",
        (
            operation,
            project,
            episode,
            json.dumps(request),
            canonical_content_hash(request),
            NOW,
            ids.task_id,
            ids.attempt_id,
        ),
    )
    connection.commit()
    return ids


def truth(workspace, ids, **changes):
    _, project, _, connection = workspace
    arguments = {
        "project_id": project,
        "task_id": ids.task_id,
        "attempt_id": ids.attempt_id,
        "profile_id": PROFILE,
        "model": MODEL,
        "request_hash": PROMPT_HASH,
        **changes,
    }
    return task_truth(connection, **arguments)


def artifact(workspace, *, artifact_type, attempt_id=None, project_id=None, episode_id=None):
    _, project, episode, connection = workspace
    artifact_id, version_id = new_id("art"), new_id("ver")
    content = {"synthetic": True}
    content_hash = canonical_content_hash(content)
    connection.execute(
        "INSERT INTO artifacts (artifact_id, project_id, episode_id, artifact_type, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (artifact_id, project_id or project, episode_id or episode, artifact_type, NOW),
    )
    connection.execute(
        """INSERT INTO artifact_versions (
        version_id, artifact_id, version_number, schema_version, content_json, content_hash,
        author_actor_type, author_actor_id, change_summary, created_at, producer_attempt_id
        ) VALUES (?, ?, 1, '1.0.0', ?, ?, 'agent', ?, 'Synthetic output', ?, ?)""",
        (
            version_id,
            artifact_id,
            json.dumps(content),
            content_hash,
            "chatgpt-official:" + PROFILE,
            NOW,
            attempt_id,
        ),
    )
    return version_id, content_hash


def complete(workspace, ids):
    _, _, _, connection = workspace
    connection.execute("BEGIN IMMEDIATE")
    begin_completion(connection, ids.task_id, ids.attempt_id, "synthetic-response", NOW)
    version, content_hash = artifact(
        workspace, artifact_type="official_director_proposal", attempt_id=ids.attempt_id
    )
    settle_task(
        connection,
        ids.task_id,
        ids.attempt_id,
        version,
        "synthetic-response",
        None,
        "SUCCEEDED",
        NOW,
    )
    completion = {"synthetic": "raw completion"}
    connection.execute(
        """UPDATE official_director_operations SET status = 'COMPLETED',
        completion_json = ?, completion_hash = ?, proposal_version_id = ?
        WHERE task_id = ?""",
        (json.dumps(completion), canonical_content_hash(completion), version, ids.task_id),
    )
    connection.commit()
    return version, content_hash


def test_reservation_is_real_visible_nonclaimable_and_replay_creates_no_attempt(workspace):
    repository, project, _, connection = workspace
    ids = reserve(workspace)
    assert truth(workspace, ids) == "REMOTE_UNKNOWN"
    records = TaskQueueReader(repository.database_path).list_project_tasks(project)
    assert len(records) == 1
    assert records[0].task_id == ids.task_id
    assert records[0].is_attention and not records[0].is_active
    assert records[0].task_status == "COMPLETED"
    assert records[0].max_attempts == records[0].attempt_count == 1
    connection.execute("BEGIN IMMEDIATE")
    assert (
        reserve_task(connection, project, "synthetic-operation", PROFILE, MODEL, PROMPT_HASH, NOW)
        == ids
    )
    connection.commit()
    assert connection.execute("SELECT count(*) FROM workflow_attempts").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM workflow_transition_events").fetchone()[0] == 3


def test_reservation_and_events_rollback_together_before_any_network_send(workspace):
    _, project, _, connection = workspace
    connection.execute("BEGIN IMMEDIATE")
    reserve_task(connection, project, "crash-before-send", PROFILE, MODEL, PROMPT_HASH, NOW)
    connection.rollback()
    for table in (
        "workflow_runs",
        "workflow_node_runs",
        "workflow_attempts",
        "task_ledger",
        "workflow_transition_events",
        "workflow_enqueue_keys",
        "workflow_definitions",
    ):
        assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0


def test_task_writes_require_caller_transaction(workspace):
    _, project, _, connection = workspace
    with pytest.raises(ValueError, match="transaction"):
        reserve_task(connection, project, "operation", PROFILE, MODEL, PROMPT_HASH, NOW)
    with pytest.raises(ValueError, match="transaction"):
        settle_task(connection, "task", "attempt", None, None, "error", "FAILED", NOW)
    with pytest.raises(ValueError, match="transaction"):
        begin_completion(connection, "task", "attempt", "response", NOW)


@pytest.mark.parametrize(
    "changes",
    [
        {"project_id": "other"},
        {"task_id": "other"},
        {"attempt_id": "other"},
        {"profile_id": "other"},
        {"model": "other"},
        {"request_hash": "sha256:" + "b" * 64},
    ],
)
def test_readback_rejects_modified_identity_pins(workspace, changes):
    ids = reserve(workspace)
    with pytest.raises(ValueError, match="chain"):
        truth(workspace, ids, **changes)


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE task_ledger SET status = 'READY'",
        "UPDATE workflow_attempts SET provider_account_id = 'other'",
        "UPDATE workflow_attempts SET execution_mode = 'local'",
        "UPDATE workflow_node_runs SET max_attempts = 2",
        "UPDATE workflow_node_runs SET active_attempt_id = NULL",
        "UPDATE workflow_node_runs SET input_bindings_json = "
        "json_set(input_bindings_json, '$.operation_id', 'changed')",
        "UPDATE workflow_runs SET input_hash = 'sha256:' || printf('%064d', 0)",
    ],
)
def test_readback_rejects_broken_real_ledger_chain(workspace, statement):
    ids = reserve(workspace)
    workspace[3].execute(statement)
    with pytest.raises(ValueError, match="chain"):
        truth(workspace, ids)


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE workflow_node_runs SET status = 'PENDING'",
        "UPDATE workflow_runs SET status = 'FAILED'",
        "UPDATE workflow_attempts SET output_version_id = ?",
    ],
)
def test_readback_rejects_inconsistent_actual_state(workspace, statement):
    ids = reserve(workspace)
    connection = workspace[3]
    if "?" in statement:
        version, _ = artifact(workspace, artifact_type="synthetic-output")
        connection.execute(statement, (version,))
    else:
        connection.execute(statement)
    with pytest.raises(ValueError, match="state"):
        truth(workspace, ids)


def test_extra_task_in_chain_and_retry_are_rejected(workspace):
    ids = reserve(workspace)
    connection = workspace[3]
    with pytest.raises(sqlite3.IntegrityError, match="remote unknown"):
        connection.execute(
            """INSERT INTO workflow_attempts (
            attempt_id, node_run_id, attempt_number, execution_mode, status, input_hash,
            request_fingerprint, revision, created_at, updated_at
            ) VALUES (?, ?, 2, 'remote', 'READY', ?, ?, 1, ?, ?)""",
            (new_id("att"), ids.node_run_id, PROMPT_HASH, PROMPT_HASH, NOW, NOW),
        )
    connection.execute(
        """INSERT INTO task_ledger (task_id, attempt_id, task_kind, status, priority, available_at,
        lease_generation, revision, created_at, updated_at)
        VALUES (?, ?, 'official.director.plan', 'COMPLETED', 50, ?, 0, 1, ?, ?)""",
        (new_id("task"), ids.attempt_id, NOW, NOW, NOW),
    )
    with pytest.raises(ValueError, match="chain"):
        truth(workspace, ids)
    connection.execute("BEGIN IMMEDIATE")
    with pytest.raises(ValueError, match="chain"):
        reserve_task(
            connection, workspace[1], "synthetic-operation", PROFILE, MODEL, PROMPT_HASH, NOW
        )
    connection.rollback()


def test_conflicting_definition_is_not_overwritten(workspace):
    connection = workspace[3]
    connection.execute(
        "INSERT INTO workflow_definitions VALUES ('official.director.plan', 1, ?, '{}', ?)",
        (PROMPT_HASH, NOW),
    )
    connection.execute("BEGIN IMMEDIATE")
    with pytest.raises(ValueError, match="definition"):
        reserve_task(connection, workspace[1], "operation", PROFILE, MODEL, PROMPT_HASH, NOW)
    connection.rollback()


@pytest.mark.parametrize("status", ["FAILED", "NOT_SUBMITTED"])
def test_invalid_and_not_sent_are_terminal_without_retry(workspace, status):
    ids = reserve(workspace)
    connection = workspace[3]
    connection.execute("BEGIN IMMEDIATE")
    settle_task(
        connection,
        ids.task_id,
        ids.attempt_id,
        None,
        "synthetic-response" if status == "FAILED" else None,
        "SYNTHETIC_INVALID" if status == "FAILED" else "CANCELLED",
        status,
        NOW,
    )
    connection.commit()
    assert truth(workspace, ids) == status
    row = connection.execute("SELECT * FROM workflow_attempts").fetchone()
    assert row["retry_disposition"] == "NON_RETRYABLE" and row["finished_at"] == NOW
    assert row["accepted_at"] == (NOW if status == "FAILED" else None)
    assert connection.execute("SELECT count(*) FROM workflow_transition_events").fetchone()[0] == 6
    connection.execute("BEGIN IMMEDIATE")
    with pytest.raises(ValueError, match="cannot be settled"):
        settle_task(connection, ids.task_id, ids.attempt_id, None, None, "error", "FAILED", NOW)
    connection.rollback()


@pytest.mark.parametrize(
    "status,version,error",
    [
        ("SUCCEEDED", None, None),
        ("FAILED", "version", "error"),
        ("FAILED", None, None),
        ("SUCCEEDED", "version", "error"),
        ("READY", None, "error"),
    ],
)
def test_completion_rejects_inconsistent_status_shape(workspace, status, version, error):
    ids = reserve(workspace)
    connection = workspace[3]
    connection.execute("BEGIN IMMEDIATE")
    with pytest.raises(ValueError, match="completion"):
        settle_task(connection, ids.task_id, ids.attempt_id, version, None, error, status, NOW)
    connection.rollback()
    assert truth(workspace, ids) == "REMOTE_UNKNOWN"


def test_completion_rejects_missing_task_and_unowned_output(workspace):
    ids = reserve(workspace)
    connection = workspace[3]
    connection.execute("BEGIN IMMEDIATE")
    with pytest.raises(ValueError, match="cannot be settled"):
        settle_task(connection, "missing", ids.attempt_id, None, None, "error", "FAILED", NOW)
    begin_completion(connection, ids.task_id, ids.attempt_id, "response", NOW)
    with pytest.raises(ValueError, match="output"):
        settle_task(
            connection, ids.task_id, ids.attempt_id, "missing", "response", None, "SUCCEEDED", NOW
        )
    connection.rollback()


def test_provider_acceptance_requires_exact_identity_and_rolls_back_with_failure(workspace):
    ids = reserve(workspace)
    connection = workspace[3]
    connection.execute("BEGIN IMMEDIATE")
    with pytest.raises(ValueError, match="identity"):
        begin_completion(connection, ids.task_id, ids.attempt_id, "  ", NOW)
    with pytest.raises(ValueError, match="begin completion"):
        begin_completion(connection, "missing", ids.attempt_id, "response", NOW)
    with pytest.raises(ValueError, match="cannot be settled"):
        settle_task(
            connection, ids.task_id, ids.attempt_id, "version", "response", None, "SUCCEEDED", NOW
        )
    begin_completion(connection, ids.task_id, ids.attempt_id, "response", NOW)
    assert truth(workspace, ids) == "REMOTE_REVIEW_PENDING"
    with pytest.raises(ValueError, match="begin completion"):
        begin_completion(connection, ids.task_id, ids.attempt_id, "response", NOW)
    with pytest.raises(ValueError, match="identity changed"):
        settle_task(
            connection, ids.task_id, ids.attempt_id, None, "other", "INVALID", "FAILED", NOW
        )
    with pytest.raises(ValueError, match="cannot be settled"):
        settle_task(
            connection,
            ids.task_id,
            ids.attempt_id,
            None,
            "response",
            "NOT_SENT",
            "NOT_SUBMITTED",
            NOW,
        )
    connection.rollback()
    assert truth(workspace, ids) == "REMOTE_UNKNOWN"
    assert connection.execute("SELECT count(*) FROM workflow_transition_events").fetchone()[0] == 3


def test_accepted_invalid_completion_remains_terminal(workspace):
    ids = reserve(workspace)
    connection = workspace[3]
    connection.execute("BEGIN IMMEDIATE")
    begin_completion(connection, ids.task_id, ids.attempt_id, "response", NOW)
    settle_task(connection, ids.task_id, ids.attempt_id, None, "response", "INVALID", "FAILED", NOW)
    connection.commit()
    assert truth(workspace, ids) == "FAILED"


def test_exact_input_version_pins_survive_replay_and_modified_pins_are_rejected(workspace):
    _, project, _, connection = workspace
    pins = ("ver_" + "a" * 32, "ver_" + "b" * 32)
    connection.execute("BEGIN IMMEDIATE")
    ids = reserve_task(connection, project, "pins", PROFILE, MODEL, PROMPT_HASH, NOW, pins)
    assert reserve_task(connection, project, "pins", PROFILE, MODEL, PROMPT_HASH, NOW, pins) == ids
    assert truth(workspace, ids, expected_input_version_ids=pins) == "REMOTE_UNKNOWN"
    with pytest.raises(ValueError, match="input version pins"):
        truth(workspace, ids, expected_input_version_ids=tuple(reversed(pins)))
    with pytest.raises(ValueError, match="input version pins"):
        reserve_task(connection, project, "pins", PROFILE, MODEL, PROMPT_HASH, NOW, ())
    connection.commit()
    assert (
        TaskQueueReader(workspace[0].database_path).list_project_tasks(project)[0].input_version_ids
        == pins
    )


def test_readback_rejects_non_director_attempt_state_and_equal_unexpected_outputs(workspace):
    ids = reserve(workspace)
    connection = workspace[3]
    connection.execute("UPDATE workflow_attempts SET status = 'READY'")
    with pytest.raises(ValueError, match="attempt state"):
        truth(workspace, ids)
    connection.execute("UPDATE workflow_attempts SET status = 'REMOTE_UNKNOWN'")
    version, _ = artifact(workspace, artifact_type="synthetic-output")
    connection.execute("UPDATE workflow_attempts SET output_version_id = ?", (version,))
    connection.execute("UPDATE workflow_node_runs SET output_version_id = ?", (version,))
    with pytest.raises(ValueError, match="task state"):
        truth(workspace, ids)


def test_success_can_create_real_producer_bound_artifact_after_acceptance(workspace):
    ids = reserve(workspace)
    repository, project, episode, connection = workspace
    connection.execute("BEGIN IMMEDIATE")
    begin_completion(connection, ids.task_id, ids.attempt_id, "response", NOW)
    record = repository.create_artifact_version(
        project_id=project,
        episode_id=episode,
        artifact_type="official_director_proposal",
        schema_version="1.0.0",
        content={"synthetic": True},
        author_actor_type="agent",
        author_actor_id="chatgpt-official:" + PROFILE,
        change_summary="Synthetic proposal",
        producer_attempt_id=ids.attempt_id,
        _transaction_connection=connection,
        _manage_transaction=False,
    )
    settle_task(
        connection,
        ids.task_id,
        ids.attempt_id,
        record.version.id,
        "response",
        None,
        "SUCCEEDED",
        NOW,
    )
    connection.commit()
    assert truth(workspace, ids) == "SUCCEEDED"


@pytest.mark.parametrize("step", range(len(OFFICIAL_DIRECTOR_MIGRATION)))
def test_migration_41_interruption_is_atomic_and_can_resume(tmp_path, step):
    database = tmp_path / "interrupted.sqlite3"

    def fail_after_operation_table(version, current_step):
        if version == 41 and current_step == step:
            raise RuntimeError("Synthetic migration interruption")

    with pytest.raises(RuntimeError, match="Synthetic"):
        StudioRepository(database, migration_hook=fail_after_operation_table)
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 40
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name LIKE 'official_director_%'"
            ).fetchall()
            == []
        )
    StudioRepository(database)
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION


def test_success_binds_immutable_output_and_survives_restart(workspace):
    ids = reserve(workspace)
    version, _ = complete(workspace, ids)
    assert truth(workspace, ids) == "SUCCEEDED"
    repository = StudioRepository(workspace[0].database_path)
    record = TaskQueueReader(repository.database_path).list_project_tasks(workspace[1])[0]
    assert record.is_completed
    assert record.node_output_version_id == record.attempt_output_version_id == version
    assert record.provider_job_id is None
    assert (
        workspace[3].execute("SELECT provider_response_id FROM workflow_attempts").fetchone()[0]
        == "synthetic-response"
    )


@pytest.mark.parametrize(
    "column,value",
    [
        ("request_json", "{}"),
        ("request_hash", "sha256:" + "b" * 64),
        ("created_at", "changed"),
        ("task_id", "other"),
        ("attempt_id", "other"),
        ("episode_id", "other"),
        ("project_id", "other"),
        ("operation_id", "other"),
    ],
)
def test_request_and_task_identity_pins_are_immutable(workspace, column, value):
    reserve(workspace)
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        workspace[3].execute(f"UPDATE official_director_operations SET {column} = ?", (value,))


def test_raw_invalid_completion_is_kept_and_settled_completion_cannot_be_rewritten(workspace):
    ids = reserve(workspace)
    connection = workspace[3]
    raw = {"output_text": "synthetic malformed model output"}
    connection.execute("BEGIN IMMEDIATE")
    settle_task(
        connection, ids.task_id, ids.attempt_id, None, "response", "INVALID_JSON", "FAILED", NOW
    )
    connection.execute(
        """UPDATE official_director_operations SET status = 'INVALID', error_code = 'INVALID_JSON',
        completion_json = ?, completion_hash = ?, validation_issues_json = '["Invalid JSON"]'""",
        (json.dumps(raw), canonical_content_hash(raw)),
    )
    connection.commit()
    assert (
        json.loads(
            connection.execute(
                "SELECT completion_json FROM official_director_operations"
            ).fetchone()[0]
        )
        == raw
    )
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        connection.execute("UPDATE official_director_operations SET completion_json = '{}'")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        connection.execute("DELETE FROM official_director_operations")


@pytest.mark.parametrize("first", ["adoption", "rejection"])
def test_review_receipts_are_exclusive_and_immutable(workspace, first):
    ids = reserve(workspace)
    proposal, proposal_hash = complete(workspace, ids)
    connection = workspace[3]
    storyboard, storyboard_hash = artifact(workspace, artifact_type="episode_storyboard")
    adoption = (
        "INSERT INTO official_director_adoptions VALUES (?, ?, ?, ?, ?, 'human', ?)",
        ("synthetic-operation", proposal, proposal_hash, storyboard, storyboard_hash, NOW),
    )
    rejection = (
        "INSERT INTO official_director_rejections VALUES (?, ?, ?, 'human', 'Do not use', ?)",
        ("synthetic-operation", proposal, proposal_hash, NOW),
    )
    accepted, denied = (adoption, rejection) if first == "adoption" else (rejection, adoption)
    connection.execute(*accepted)
    with pytest.raises(sqlite3.IntegrityError, match="chain"):
        connection.execute(*denied)
    table = "official_director_adoptions" if first == "adoption" else "official_director_rejections"
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        connection.execute(f"UPDATE {table} SET actor_id = 'other'")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        connection.execute(f"DELETE FROM {table}")


def test_review_receipts_reject_modified_hash_and_cross_episode_storyboard(workspace):
    ids = reserve(workspace)
    proposal, proposal_hash = complete(workspace, ids)
    repository, project, _, connection = workspace
    other_episode = repository.create_episode(project, title="Other").id
    storyboard, storyboard_hash = artifact(
        workspace, artifact_type="episode_storyboard", episode_id=other_episode
    )
    with pytest.raises(sqlite3.IntegrityError, match="chain"):
        connection.execute(
            "INSERT INTO official_director_adoptions VALUES (?, ?, ?, ?, ?, 'human', ?)",
            ("synthetic-operation", proposal, proposal_hash, storyboard, storyboard_hash, NOW),
        )
    with pytest.raises(sqlite3.IntegrityError, match="chain"):
        connection.execute(
            "INSERT INTO official_director_rejections VALUES (?, ?, ?, 'human', 'No', ?)",
            ("synthetic-operation", proposal, "sha256:" + "b" * 64, NOW),
        )
