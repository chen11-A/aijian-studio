import hashlib
import sqlite3
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from aijian_api.task_ledger import LocalTaskLedger, QueuedTask

NOW = datetime(2026, 8, 10, 9, 30, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


def drop_v10_tables(connection: sqlite3.Connection) -> None:
    connection.execute("DROP TABLE skill_runs")
    connection.execute("DROP TABLE agent_context_manifests")
    connection.execute("DROP TABLE agent_runs")

V1_SCHEMA = """
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    target_duration_seconds INTEGER NOT NULL,
    source_language TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE source_documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    encoding TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    raw_sha256 TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    chapter_count INTEGER NOT NULL CHECK (chapter_count >= 1),
    UNIQUE (project_id, raw_sha256)
);
CREATE TABLE source_blocks (
    id TEXT PRIMARY KEY,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('chapter_heading', 'paragraph')),
    chapter_index INTEGER NOT NULL CHECK (chapter_index >= 1),
    text TEXT NOT NULL,
    normalized_start_byte INTEGER NOT NULL CHECK (normalized_start_byte >= 0),
    normalized_end_byte INTEGER NOT NULL CHECK (normalized_end_byte >= normalized_start_byte),
    content_sha256 TEXT NOT NULL,
    UNIQUE (source_document_id, ordinal)
);
CREATE INDEX source_documents_project ON source_documents(project_id, imported_at DESC);
CREATE INDEX source_blocks_document ON source_blocks(source_document_id, ordinal);
PRAGMA user_version = 1;
"""


def create_v1_database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.executescript(V1_SCHEMA)
        connection.execute(
            """
            INSERT INTO projects VALUES (
                'prj_existing', '旧项目', '9:16', 90, 'zh-CN', 'active', 2,
                '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z'
            )
            """
        )
        connection.execute(
            """
            INSERT INTO source_documents VALUES (
                'src_existing', 'prj_existing', 'story.txt', 'text/plain', 'utf-8', 6,
                ?, '第一段', '2026-08-03T00:00:00Z', 1
            )
            """,
            ("a" * 64,),
        )
        connection.execute(
            """
            INSERT INTO source_blocks VALUES (
                'srcb_existing', 'src_existing', 'prj_existing', 0, 'paragraph', 1,
                '第一段', 0, 9, ?
            )
            """,
            ("b" * 64,),
        )


def database_version(path: Path) -> int:
    with sqlite3.connect(path) as connection:
        return int(connection.execute("PRAGMA user_version").fetchone()[0])


def create_current_v2_database(path: Path) -> None:
    def stop_before_v3(version: int, step: int) -> None:
        if version == 3 and step == 0:
            raise RuntimeError("stop before v3")

    with pytest.raises(RuntimeError, match="stop before v3"):
        StudioRepository(path, migration_hook=stop_before_v3)
    assert database_version(path) == 2


def create_current_v3_database(path: Path) -> None:
    def stop_before_v4(version: int, step: int) -> None:
        if version == 4 and step == 0:
            raise RuntimeError("stop before v4")

    with pytest.raises(RuntimeError, match="stop before v4"):
        StudioRepository(path, migration_hook=stop_before_v4)
    assert database_version(path) == 3


def create_current_v4_database(path: Path) -> None:
    def stop_before_v5(version: int, step: int) -> None:
        if version == 5 and step == 0:
            raise RuntimeError("stop before v5")

    with pytest.raises(RuntimeError, match="stop before v5"):
        StudioRepository(path, migration_hook=stop_before_v5)
    assert database_version(path) == 4


def create_current_v5_database(path: Path) -> None:
    def stop_before_v6(version: int, step: int) -> None:
        if version == 6 and step == 0:
            raise RuntimeError("stop before v6")

    with pytest.raises(RuntimeError, match="stop before v6"):
        StudioRepository(path, migration_hook=stop_before_v6)
    assert database_version(path) == 5


def create_current_v6_database(path: Path) -> None:
    def stop_before_v7(version: int, step: int) -> None:
        if version == 7 and step == 0:
            raise RuntimeError("stop before v7")

    with pytest.raises(RuntimeError, match="stop before v7"):
        StudioRepository(path, migration_hook=stop_before_v7)
    assert database_version(path) == 6


def create_current_v7_database(path: Path) -> None:
    def stop_before_v8(version: int, step: int) -> None:
        if version == 8 and step == 0:
            raise RuntimeError("stop before v8")

    with pytest.raises(RuntimeError, match="stop before v8"):
        StudioRepository(path, migration_hook=stop_before_v8)
    assert database_version(path) == 7


def test_fresh_database_runs_all_ordered_migrations(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"

    StudioRepository(database)

    with sqlite3.connect(database) as connection:
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        artifact_version_columns = {
            str(row[1]) for row in connection.execute("PRAGMA table_info(artifact_versions)")
        }
        indexes = {
            str(row[1]) for row in connection.execute("PRAGMA index_list(artifact_versions)")
        }
        assert SCHEMA_VERSION == 10
    assert database_version(database) == SCHEMA_VERSION
    assert "producer_attempt_id" in artifact_version_columns
    assert "artifact_version_one_output_per_attempt" in indexes
    assert {
        "projects",
        "source_documents",
        "source_blocks",
        "artifacts",
        "artifact_versions",
        "artifact_heads",
        "artifact_source_spans",
        "artifact_dependencies",
        "review_submissions",
        "review_findings",
        "review_finding_events",
        "gate_readiness_reports",
        "role_signoffs",
        "gate_decisions",
        "gate_waivers",
        "gate_waiver_events",
        "confirmation_challenges",
        "workflow_definitions",
        "workflow_runs",
        "workflow_node_runs",
        "workflow_attempts",
        "task_ledger",
        "workflow_transition_events",
        "remote_reconciliations",
        "workflow_enqueue_keys",
        "provider_connections",
        "workflow_attempt_snapshots",
        "agent_artifact_proposals",
        "agent_runs",
        "skill_runs",
        "agent_context_manifests",
    } <= tables


def test_v1_migration_preserves_projects_sources_and_blocks(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    create_v1_database(database)

    repository = StudioRepository(database)

    assert repository.get_project("prj_existing").name == "旧项目"
    source = repository.get_source("prj_existing", "src_existing")
    assert source.normalized_text == "第一段"
    assert [block.text for block in source.blocks] == ["第一段"]
    assert database_version(database) == SCHEMA_VERSION


def test_every_v2_ddl_failure_rolls_back_and_can_retry(tmp_path: Path) -> None:
    observed_steps: list[int] = []
    probe = tmp_path / "probe.db"
    create_v1_database(probe)
    StudioRepository(
        probe,
        migration_hook=lambda version, step: observed_steps.append(step) if version == 2 else None,
    )
    assert observed_steps

    for failed_step in observed_steps:
        database = tmp_path / f"failure-{failed_step}.db"
        create_v1_database(database)

        def fail_at_step(version: int, step: int, *, target: int = failed_step) -> None:
            if version == 2 and step == target:
                raise RuntimeError(f"injected migration failure at {target}")

        with pytest.raises(RuntimeError, match="injected migration failure"):
            StudioRepository(database, migration_hook=fail_at_step)

        assert database_version(database) == 1
        with sqlite3.connect(database) as connection:
            artifact_table = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'"
            ).fetchone()
        assert artifact_table is None

        StudioRepository(database)
        assert database_version(database) == SCHEMA_VERSION


def test_every_v3_ddl_failure_rolls_back_to_v2_and_can_retry(tmp_path: Path) -> None:
    probe = tmp_path / "probe-v3.db"
    create_current_v2_database(probe)
    observed_steps: list[int] = []
    StudioRepository(
        probe,
        migration_hook=lambda version, step: observed_steps.append(step) if version == 3 else None,
    )
    assert observed_steps

    for failed_step in observed_steps:
        database = tmp_path / f"v3-failure-{failed_step}.db"
        create_current_v2_database(database)

        def fail_at_step(version: int, step: int, *, target: int = failed_step) -> None:
            if version == 3 and step == target:
                raise RuntimeError(f"injected v3 failure at {target}")

        with pytest.raises(RuntimeError, match="injected v3 failure"):
            StudioRepository(database, migration_hook=fail_at_step)
        assert database_version(database) == 2

        StudioRepository(database)
        assert database_version(database) == SCHEMA_VERSION


def test_every_v4_ddl_failure_rolls_back_to_v3_and_can_retry(tmp_path: Path) -> None:
    probe = tmp_path / "probe-v4.db"
    create_current_v3_database(probe)
    observed_steps: list[int] = []
    StudioRepository(
        probe,
        migration_hook=lambda version, step: observed_steps.append(step) if version == 4 else None,
    )
    assert observed_steps

    for failed_step in observed_steps:
        database = tmp_path / f"v4-failure-{failed_step}.db"
        create_current_v3_database(database)

        def fail_at_step(version: int, step: int, *, target: int = failed_step) -> None:
            if version == 4 and step == target:
                raise RuntimeError(f"injected v4 failure at {target}")

        with pytest.raises(RuntimeError, match="injected v4 failure"):
            StudioRepository(database, migration_hook=fail_at_step)
        assert database_version(database) == 3

        StudioRepository(database)
        assert database_version(database) == SCHEMA_VERSION


def test_every_v5_ddl_failure_rolls_back_to_v4_and_can_retry(tmp_path: Path) -> None:
    probe = tmp_path / "probe-v5.db"
    create_current_v4_database(probe)
    observed_steps: list[int] = []
    StudioRepository(
        probe,
        migration_hook=lambda version, step: observed_steps.append(step) if version == 5 else None,
    )
    assert observed_steps

    for failed_step in observed_steps:
        database = tmp_path / f"v5-failure-{failed_step}.db"
        create_current_v4_database(database)

        def fail_at_step(version: int, step: int, *, target: int = failed_step) -> None:
            if version == 5 and step == target:
                raise RuntimeError(f"injected v5 failure at {target}")

        with pytest.raises(RuntimeError, match="injected v5 failure"):
            StudioRepository(database, migration_hook=fail_at_step)
        assert database_version(database) == 4

        StudioRepository(database)
        assert database_version(database) == SCHEMA_VERSION


def test_every_v6_ddl_failure_rolls_back_to_v5_and_can_retry(tmp_path: Path) -> None:
    probe = tmp_path / "probe-v6.db"
    create_current_v5_database(probe)
    observed_steps: list[int] = []
    StudioRepository(
        probe,
        migration_hook=lambda version, step: observed_steps.append(step) if version == 6 else None,
    )
    assert observed_steps

    for failed_step in observed_steps:
        database = tmp_path / f"v6-failure-{failed_step}.db"
        create_current_v5_database(database)

        def fail_at_step(version: int, step: int, *, target: int = failed_step) -> None:
            if version == 6 and step == target:
                raise RuntimeError(f"injected v6 failure at {target}")

        with pytest.raises(RuntimeError, match="injected v6 failure"):
            StudioRepository(database, migration_hook=fail_at_step)
        assert database_version(database) == 5
        with sqlite3.connect(database) as connection:
            columns = {
                str(row[1]) for row in connection.execute("PRAGMA table_info(artifact_versions)")
            }
        assert "producer_attempt_id" not in columns

        StudioRepository(database)
        assert database_version(database) == SCHEMA_VERSION


def test_every_v7_ddl_failure_rolls_back_to_v6_and_can_retry(tmp_path: Path) -> None:
    probe = tmp_path / "probe-v7.db"
    create_current_v6_database(probe)
    observed_steps: list[int] = []
    StudioRepository(
        probe,
        migration_hook=lambda version, step: observed_steps.append(step) if version == 7 else None,
    )
    assert observed_steps

    for failed_step in observed_steps:
        database = tmp_path / f"v7-failure-{failed_step}.db"
        create_current_v6_database(database)

        def fail_at_step(version: int, step: int, *, target: int = failed_step) -> None:
            if version == 7 and step == target:
                raise RuntimeError(f"injected v7 failure at {target}")

        with pytest.raises(RuntimeError, match="injected v7 failure"):
            StudioRepository(database, migration_hook=fail_at_step)
        assert database_version(database) == 6
        with sqlite3.connect(database) as connection:
            table = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'provider_connections'"
            ).fetchone()
        assert table is None

        StudioRepository(database)
        assert database_version(database) == SCHEMA_VERSION


def test_every_v8_ddl_failure_rolls_back_to_v7_and_can_retry(tmp_path: Path) -> None:
    probe = tmp_path / "probe-v8.db"
    create_current_v7_database(probe)
    observed_steps: list[int] = []
    StudioRepository(
        probe,
        migration_hook=lambda version, step: observed_steps.append(step) if version == 8 else None,
    )
    assert observed_steps

    for failed_step in observed_steps:
        database = tmp_path / f"v8-failure-{failed_step}.db"
        create_current_v7_database(database)

        def fail_at_step(version: int, step: int, *, target: int = failed_step) -> None:
            if version == 8 and step == target:
                raise RuntimeError(f"injected v8 failure at {target}")

        with pytest.raises(RuntimeError, match="injected v8 failure"):
            StudioRepository(database, migration_hook=fail_at_step)
        assert database_version(database) == 7
        with sqlite3.connect(database) as connection:
            table = connection.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type = 'table' AND name = 'workflow_attempt_snapshots'"
            ).fetchone()
        assert table is None

        StudioRepository(database)
        assert database_version(database) == SCHEMA_VERSION


def test_every_v9_ddl_failure_rolls_back_to_v8_and_can_retry(tmp_path: Path) -> None:
    def create_current_v8_database(database: Path) -> None:
        StudioRepository(database).create_project(
            name="V8 proposal migration",
            aspect_ratio="9:16",
            target_duration_seconds=15,
            source_language="zh-CN",
        )
        with sqlite3.connect(database) as connection:
            drop_v10_tables(connection)
            for trigger in (
                "agent_artifact_proposals_immutable_update",
                "agent_artifact_proposals_immutable_delete",
            ):
                connection.execute(f"DROP TRIGGER {trigger}")
            connection.execute("DROP TABLE agent_artifact_proposals")
            connection.execute("PRAGMA user_version = 8")

    probe = tmp_path / "probe-v9.db"
    create_current_v8_database(probe)
    observed_steps: list[int] = []
    StudioRepository(
        probe,
        migration_hook=lambda version, step: observed_steps.append(step) if version == 9 else None,
    )
    assert observed_steps

    for failed_step in observed_steps:
        database = tmp_path / f"v9-failure-{failed_step}.db"
        create_current_v8_database(database)

        def fail_at_step(version: int, step: int, *, target: int = failed_step) -> None:
            if version == 9 and step == target:
                raise RuntimeError(f"injected v9 failure at {target}")

        with pytest.raises(RuntimeError, match="injected v9 failure"):
            StudioRepository(database, migration_hook=fail_at_step)
        assert database_version(database) == 8
        with sqlite3.connect(database) as connection:
            table = connection.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type = 'table' AND name = 'agent_artifact_proposals'"
            ).fetchone()
        assert table is None

        StudioRepository(database)
        assert database_version(database) == SCHEMA_VERSION


def test_every_v10_ddl_failure_rolls_back_to_v9_and_can_retry(tmp_path: Path) -> None:
    def create_current_v9_database(database: Path) -> None:
        StudioRepository(database).create_project(
            name="V9 Agent run migration",
            aspect_ratio="9:16",
            target_duration_seconds=15,
            source_language="zh-CN",
        )
        with sqlite3.connect(database) as connection:
            drop_v10_tables(connection)
            connection.execute("PRAGMA user_version = 9")

    probe = tmp_path / "probe-v10.db"
    create_current_v9_database(probe)
    observed_steps: list[int] = []
    StudioRepository(
        probe,
        migration_hook=lambda version, step: observed_steps.append(step) if version == 10 else None,
    )
    assert observed_steps

    for failed_step in observed_steps:
        database = tmp_path / f"v10-failure-{failed_step}.db"
        create_current_v9_database(database)

        def fail_at_step(version: int, step: int, *, target: int = failed_step) -> None:
            if version == 10 and step == target:
                raise RuntimeError(f"injected v10 failure at {target}")

        with pytest.raises(RuntimeError, match="injected v10 failure"):
            StudioRepository(database, migration_hook=fail_at_step)
        assert database_version(database) == 9
        with sqlite3.connect(database) as connection:
            tables = {
                str(row[0])
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
        assert {"agent_runs", "skill_runs", "agent_context_manifests"}.isdisjoint(tables)

        StudioRepository(database)
        assert database_version(database) == SCHEMA_VERSION


def test_attempt_snapshot_is_idempotent_immutable_and_recovered_without_drift(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    project_id = StudioRepository(database).create_project(
        name="Agent 快照",
        aspect_ratio="9:16",
        target_duration_seconds=15,
        source_language="zh-CN",
    ).id
    clock = [NOW]
    ledger = LocalTaskLedger(database, clock=lambda: clock[0])
    fingerprint_payload = {
        "project_id": project_id,
        "agent_run_id": "agr_" + "a" * 32,
        "skill_run_id": "skr_" + "a" * 32,
        "output_artifact_type": "Screenplay",
        "agent_definition_id": "screenwriter",
        "agent_version": "1.0.0",
        "skill_definition_id": "screenplay.generate",
        "skill_version": "1.0.0",
        "prompt_version": "prompt.screenplay@1.0.0",
        "policy_version": "policy.local-safe@1.0.0",
        "provider_connection_id": "provider:local-fake",
        "model_id": "deterministic-fake-v1",
        "capability_snapshot_hash": HASH_A,
        "input_hash": HASH_A,
        "output_schema_version": "1.0.0",
        "idempotency_key": "idem:screenplay:golden-v1",
    }
    attempt_fingerprint = canonical_sha256(fingerprint_payload)
    snapshot = {
        "schema_version": "1.0.0",
        **fingerprint_payload,
        "attempt_fingerprint": attempt_fingerprint,
    }

    def enqueue(attempt_snapshot: Mapping[str, object] = snapshot) -> QueuedTask:
        return ledger.enqueue_local_node(
            project_id=project_id,
            definition_id="agent-skill-fake-runtime",
            definition_version=1,
            definition_hash=HASH_A,
            graph={"nodes": ["screenplay.generate"]},
            workflow_input_hash=HASH_A,
            node_key="screenplay.generate",
            node_type="agent.skill.fake",
            contract_version=1,
            input_bindings={"context_manifest_id": "ctx_" + "a" * 32},
            node_input_hash=HASH_A,
            request_fingerprint=attempt_fingerprint,
            idempotency_key="idem:screenplay:golden-v1",
            max_attempts=2,
            task_kind="local.agent-skill.fake",
            priority=80,
            available_at=NOW,
            attempt_snapshot_kind="agent_skill_v1",
            attempt_snapshot=attempt_snapshot,
        )

    queued = enqueue()
    assert enqueue(dict(reversed(tuple(snapshot.items())))) == queued
    changed_snapshot = {**snapshot, "model_id": "different-fake-v2"}
    with pytest.raises(ValueError, match="closed Agent/Skill contract"):
        enqueue(changed_snapshot)
    claim = ledger.claim_ready_task(
        worker_id="snapshot-crash-worker",
        lease_duration=timedelta(seconds=1),
    )
    assert claim is not None
    clock[0] = NOW + timedelta(seconds=2)
    assert ledger.recover_expired_local_tasks().requeued == 1

    with sqlite3.connect(database) as connection:
        latest_attempt = connection.execute(
            "SELECT attempt_id FROM workflow_attempts "
            "WHERE node_run_id = ? ORDER BY attempt_number DESC LIMIT 1",
            (queued.node_run_id,),
        ).fetchone()
        assert latest_attempt is not None
        expected_task = connection.execute(
            "SELECT task_id FROM task_ledger "
            "WHERE attempt_id = ? AND task_kind = 'local.agent-skill.fake'",
            (latest_attempt[0],),
        ).fetchone()
        assert expected_task is not None
        connection.execute(
            """
            INSERT INTO task_ledger (
                task_id, attempt_id, task_kind, status, priority, available_at,
                lease_generation, revision, created_at, updated_at
            ) VALUES (?, ?, 'decoy.completed', 'COMPLETED', 100, ?, 0, 1, ?, ?)
            """,
            (
                "task_" + "f" * 32,
                latest_attempt[0],
                (NOW + timedelta(minutes=1)).isoformat(),
                (NOW + timedelta(minutes=1)).isoformat(),
                (NOW + timedelta(minutes=1)).isoformat(),
            ),
        )
    assert enqueue().task_id == expected_task[0]

    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT attempt.attempt_number, snapshot.* "
            "FROM workflow_attempt_snapshots AS snapshot "
            "JOIN workflow_attempts AS attempt ON attempt.attempt_id = snapshot.attempt_id "
            "ORDER BY attempt.attempt_number"
        ).fetchall()
        assert len(rows) == 2
        assert rows[0]["snapshot_kind"] == "agent_skill_v1"
        assert rows[0]["snapshot_json"] == rows[1]["snapshot_json"]
        assert rows[0]["snapshot_hash"] == rows[1]["snapshot_hash"]
        expected_hash = "sha256:" + hashlib.sha256(
            str(rows[0]["snapshot_json"]).encode("utf-8")
        ).hexdigest()
        assert rows[0]["snapshot_hash"] == expected_hash
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE workflow_attempt_snapshots SET snapshot_kind = 'changed' "
                "WHERE attempt_id = ?",
                (queued.attempt_id,),
            )
        connection.rollback()
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        remaining = connection.execute(
            "SELECT COUNT(*) FROM workflow_attempt_snapshots"
        ).fetchone()
        assert remaining is not None and remaining[0] == 0


@pytest.mark.parametrize(
    "sensitive_key",
    (
        "apiKey",
        "accessToken",
        "refreshToken",
        "private_key",
        "privateKey",
        "signing-key",
        "credentials.password",
        "auth",
        "bearer",
    ),
)
def test_attempt_snapshot_rejects_secret_shaped_fields(
    tmp_path: Path,
    sensitive_key: str,
) -> None:
    database = tmp_path / "workspace.db"
    project_id = StudioRepository(database).create_project(
        name="拒绝密钥",
        aspect_ratio="9:16",
        target_duration_seconds=15,
        source_language="zh-CN",
    ).id
    ledger = LocalTaskLedger(database, clock=lambda: NOW)

    with pytest.raises(ValueError, match="sensitive"):
        ledger.enqueue_local_node(
            project_id=project_id,
            definition_id="agent-skill-fake-runtime",
            definition_version=1,
            definition_hash=HASH_A,
            graph={"nodes": ["screenplay.generate"]},
            workflow_input_hash=HASH_A,
            node_key="screenplay.generate",
            node_type="agent.skill.fake",
            contract_version=1,
            input_bindings={},
            node_input_hash=HASH_A,
            request_fingerprint=HASH_B,
            idempotency_key="idem:secret-rejected",
            max_attempts=2,
            task_kind="local.agent-skill.fake",
            priority=80,
            available_at=NOW,
            attempt_snapshot_kind="agent_skill_v1",
            attempt_snapshot={
                "credential_ref": "cred_local_fake",
                "provider": [{sensitive_key: "must-not-persist"}],
            },
        )


def test_recovery_trigger_does_not_copy_a_nonmatching_or_skipped_snapshot(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    project_id = StudioRepository(database).create_project(
        name="拒绝漂移",
        aspect_ratio="9:16",
        target_duration_seconds=15,
        source_language="zh-CN",
    ).id
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    snapshot = {
        "schema_version": "1.0.0",
        "project_id": project_id,
        "agent_run_id": "agr_" + "b" * 32,
        "skill_run_id": "skr_" + "b" * 32,
        "output_artifact_type": "Screenplay",
        "agent_definition_id": "screenwriter",
        "agent_version": "1.0.0",
        "skill_definition_id": "screenplay.generate",
        "skill_version": "1.0.0",
        "prompt_version": "prompt.screenplay@1.0.0",
        "policy_version": "policy.local-safe@1.0.0",
        "provider_connection_id": "provider:local-fake",
        "model_id": "deterministic-fake-v1",
        "capability_snapshot_hash": HASH_A,
        "input_hash": HASH_A,
        "output_schema_version": "1.0.0",
        "idempotency_key": "idem:no-drift",
    }
    snapshot["attempt_fingerprint"] = canonical_sha256(
        {key: value for key, value in snapshot.items() if key != "schema_version"}
    )
    queued = ledger.enqueue_local_node(
        project_id=project_id,
        definition_id="agent-skill-fake-runtime",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["screenplay.generate"]},
        workflow_input_hash=HASH_A,
        node_key="screenplay.generate",
        node_type="agent.skill.fake",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH_A,
        request_fingerprint=str(snapshot["attempt_fingerprint"]),
        idempotency_key="idem:no-drift",
        max_attempts=3,
        task_kind="local.agent-skill.fake",
        priority=80,
        available_at=NOW,
        attempt_snapshot_kind="agent_skill_v1",
        attempt_snapshot=snapshot,
    )

    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE workflow_attempts SET status = 'FAILED' WHERE attempt_id = ?",
            (queued.attempt_id,),
        )
        connection.execute(
            """
            INSERT INTO workflow_attempts (
                attempt_id, node_run_id, attempt_number, execution_mode, status,
                input_hash, request_fingerprint, revision, created_at, updated_at
            ) VALUES (?, ?, 2, 'local', 'FAILED', ?, ?, 1, ?, ?)
            """,
            (
                "att_" + "c" * 32,
                queued.node_run_id,
                HASH_B,
                HASH_B,
                NOW.isoformat(),
                NOW.isoformat(),
            ),
        )
        connection.execute(
            """
            INSERT INTO workflow_attempts (
                attempt_id, node_run_id, attempt_number, execution_mode, status,
                input_hash, request_fingerprint, revision, created_at, updated_at
            ) VALUES (?, ?, 3, 'local', 'READY', ?, ?, 1, ?, ?)
            """,
            (
                "att_" + "d" * 32,
                queued.node_run_id,
                HASH_A,
                str(snapshot["attempt_fingerprint"]),
                NOW.isoformat(),
                NOW.isoformat(),
            ),
        )
        copied = connection.execute(
            "SELECT attempt_id FROM workflow_attempt_snapshots ORDER BY attempt_id"
        ).fetchall()

    assert copied == [(queued.attempt_id,)]


def test_v7_workflow_data_migrates_without_inventing_attempt_snapshots(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    project_id = StudioRepository(database).create_project(
        name="V7 工作流",
        aspect_ratio="9:16",
        target_duration_seconds=15,
        source_language="zh-CN",
    ).id
    clock = [NOW]

    def enqueue(ledger: LocalTaskLedger) -> QueuedTask:
        return ledger.enqueue_local_node(
            project_id=project_id,
            definition_id="legacy-local-workflow",
            definition_version=1,
            definition_hash=HASH_A,
            graph={"nodes": ["legacy.local"]},
            workflow_input_hash=HASH_A,
            node_key="legacy.local",
            node_type="legacy.local",
            contract_version=1,
            input_bindings={"legacy": True},
            node_input_hash=HASH_A,
            request_fingerprint=HASH_B,
            idempotency_key="legacy:v7:no-snapshot",
            max_attempts=2,
            task_kind="legacy.local",
            priority=50,
            available_at=NOW,
        )

    original = enqueue(LocalTaskLedger(database, clock=lambda: clock[0]))
    with sqlite3.connect(database) as connection:
        drop_v10_tables(connection)
        for trigger in (
            "agent_artifact_proposals_immutable_update",
            "agent_artifact_proposals_immutable_delete",
        ):
            connection.execute(f"DROP TRIGGER {trigger}")
        connection.execute("DROP TABLE agent_artifact_proposals")
        for trigger in (
            "workflow_attempt_snapshot_recovery_copy",
            "workflow_attempt_snapshots_immutable_update",
            "workflow_attempt_snapshots_immutable_delete",
        ):
            connection.execute(f"DROP TRIGGER {trigger}")
        connection.execute("DROP TABLE workflow_attempt_snapshots")
        connection.execute("PRAGMA user_version = 7")

    StudioRepository(database)
    migrated = LocalTaskLedger(database, clock=lambda: clock[0])
    assert enqueue(migrated) == original
    claim = migrated.claim_ready_task(
        worker_id="legacy-v7-worker",
        lease_duration=timedelta(seconds=1),
    )
    assert claim is not None
    clock[0] = NOW + timedelta(seconds=2)
    assert migrated.recover_expired_local_tasks().requeued == 1
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM workflow_attempt_snapshots"
        ).fetchone() == (0,)


def test_v2_confirmation_rows_upgrade_to_safe_v3_shape(tmp_path: Path) -> None:
    database = tmp_path / "v2-with-challenge.db"
    create_current_v2_database(database)
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            INSERT INTO projects VALUES (
                'prj_legacy', '旧工作区', '9:16', 90, 'zh-CN', 'active', 1,
                '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z'
            )
            """
        )
        connection.execute(
            "INSERT INTO artifacts VALUES ('art_legacy', 'prj_legacy', 'story_bible', ?) ",
            ("2026-08-03T00:00:00Z",),
        )
        connection.execute(
            """
            INSERT INTO artifact_versions VALUES (
                'ver_legacy', 'art_legacy', 1, '1.0.0', '{}', ?, 'human',
                'local-user', NULL, 'legacy', '2026-08-03T00:00:00Z'
            )
            """,
            (f"sha256:{'a' * 64}",),
        )
        connection.execute(
            """
            INSERT INTO artifact_heads VALUES (
                'art_legacy', 'ver_legacy', NULL, NULL, NULL, 1, 0,
                '2026-08-03T00:00:00Z'
            )
            """
        )
        connection.execute(
            """
            INSERT INTO gate_readiness_reports VALUES (
                'rpt_legacy', 'art_legacy', 'ver_legacy', 'G2', NULL,
                'g2.story-bible', '1', 1, 0, '{"ready":true}', ?,
                '2026-08-03T12:05:00Z', '2026-08-03T12:00:00Z'
            )
            """,
            (f"sha256:{'b' * 64}",),
        )
        connection.execute(
            """
            INSERT INTO confirmation_challenges VALUES (
                'chg_legacy', 'art_legacy', 'ver_legacy', 'G2', 'submit',
                'rpt_legacy', 'sha256:legacy-token', 1, 0,
                '2026-08-03T12:05:00Z', NULL, '2026-08-03T12:00:00Z'
            )
            """
        )
        connection.execute("PRAGMA user_version = 2")
        connection.commit()

    StudioRepository(database)

    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT * FROM confirmation_challenges WHERE challenge_id = 'chg_legacy'"
        ).fetchone()
        assert row is not None
        assert row["actor_id"] == "legacy-unbound"
        assert row["actor_roles_json"] == "[]"
        assert str(row["policy_snapshot_hash"]).startswith("sha256:")
    assert database_version(database) == SCHEMA_VERSION


def test_v3_migration_rejects_legacy_cross_artifact_review_links(tmp_path: Path) -> None:
    database = tmp_path / "v2-invalid-ownership.db"
    create_current_v2_database(database)
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            INSERT INTO projects VALUES (
                'prj_existing', '旧工作区', '9:16', 90, 'zh-CN', 'active', 1,
                '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z'
            )
            """
        )
        insert_artifact_version(
            connection,
            artifact_id="art_first",
            artifact_type="story_bible",
            version_id="ver_first",
        )
        insert_artifact_version(
            connection,
            artifact_id="art_second",
            artifact_type="source_manifest",
            version_id="ver_second",
        )
        connection.execute(
            """
            INSERT INTO gate_readiness_reports VALUES (
                'rpt_first', 'art_first', 'ver_first', 'G2', NULL,
                'g2.story-bible', '1', 1, 0, '{"ready":true}', ?,
                '2026-08-03T12:05:00Z', '2026-08-03T12:00:00Z'
            )
            """,
            (f"sha256:{'d' * 64}",),
        )
        connection.execute(
            """
            INSERT INTO review_submissions VALUES (
                'sub_first', 'art_first', 'ver_first', 'G2', 'rpt_first', NULL,
                'local-user', '2026-08-03T12:00:00Z'
            )
            """
        )
        connection.execute(
            """
            UPDATE artifact_heads
            SET review_version_id = 'ver_second', review_submission_id = 'sub_first'
            WHERE artifact_id = 'art_second'
            """
        )
        connection.commit()

    with pytest.raises(RuntimeError, match="artifact head review ownership mismatch"):
        StudioRepository(database)
    assert database_version(database) == 2


def test_v3_disables_events_for_legacy_findings_and_waivers(tmp_path: Path) -> None:
    database = tmp_path / "v2-legacy-review-evidence.db"
    create_current_v2_database(database)
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            INSERT INTO projects VALUES (
                'prj_existing', '旧工作区', '9:16', 90, 'zh-CN', 'active', 1,
                '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z'
            )
            """
        )
        insert_artifact_version(
            connection,
            artifact_id="art_story",
            artifact_type="story_bible",
            version_id="ver_story",
        )
        connection.execute(
            """
            INSERT INTO gate_readiness_reports VALUES (
                'rpt_story', 'art_story', 'ver_story', 'G2', NULL,
                'g2.story-bible', '1', 1, 0, '{"ready":true}', ?,
                '2026-08-03T12:05:00Z', '2026-08-03T12:00:00Z'
            )
            """,
            (f"sha256:{'e' * 64}",),
        )
        connection.execute(
            """
            INSERT INTO review_submissions VALUES (
                'sub_story', 'art_story', 'ver_story', 'G2', 'rpt_story', NULL,
                'local-user', '2026-08-03T12:00:00Z'
            )
            """
        )
        connection.execute(
            """
            INSERT INTO review_findings VALUES (
                'finding_story', 'art_story', 'ver_story', 'sub_story',
                'artifact', NULL, 'blocking', '修正连续性冲突', 'writer',
                'producer-user', '2026-08-03T12:00:00Z'
            )
            """
        )
        connection.execute(
            """
            INSERT INTO review_finding_events VALUES (
                'finding_event_open', 'art_story', 'finding_story', NULL, 1,
                'open', NULL, '发现阻断项', 'producer-user',
                '2026-08-03T12:00:00Z'
            )
            """
        )
        connection.execute(
            """
            INSERT INTO gate_waivers VALUES (
                'waiver_story', 'art_story', 'ver_story', 'sub_story',
                'artifact', 'story-bible', '临时制作例外', '[]', 'G2',
                'producer-user', '2026-08-03T12:00:00Z'
            )
            """
        )
        connection.execute(
            """
            INSERT INTO gate_waiver_events VALUES (
                'waiver_event_open', 'art_story', 'waiver_story', NULL, 1,
                'open', '等待复核', 'producer-user', '2026-08-03T12:00:00Z'
            )
            """
        )
        connection.commit()

    StudioRepository(database)

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        with pytest.raises(sqlite3.IntegrityError, match="finding event writes"):
            connection.execute(
                """
                INSERT INTO review_finding_events VALUES (
                    'finding_event_resolved', 'art_story', 'finding_story',
                    'finding_event_open', 2, 'resolved', 'ver_story',
                    '绕过解决', 'local-user', '2026-08-03T12:01:00Z'
                )
                """
            )
        connection.rollback()
        with pytest.raises(sqlite3.IntegrityError, match="waiver event writes"):
            connection.execute(
                """
                INSERT INTO gate_waiver_events VALUES (
                    'waiver_event_reviewed', 'art_story', 'waiver_story',
                    'waiver_event_open', 2, 'reviewed', '绕过复核',
                    'local-user', '2026-08-03T12:01:00Z'
                )
                """
            )
        connection.rollback()


def test_migration_hook_type_accepts_noop_callable(tmp_path: Path) -> None:
    def hook(_version: int, _step: int) -> None:
        pass

    StudioRepository(tmp_path / "workspace.db", migration_hook=hook)


def insert_artifact_version(
    connection: sqlite3.Connection,
    *,
    artifact_id: str,
    artifact_type: str,
    version_id: str,
) -> None:
    connection.execute(
        "INSERT INTO artifacts VALUES (?, 'prj_existing', ?, '2026-08-03T00:00:00Z')",
        (artifact_id, artifact_type),
    )
    connection.execute(
        """
        INSERT INTO artifact_versions (
            version_id, artifact_id, version_number, schema_version, content_json,
            content_hash, author_actor_type, author_actor_id, parent_version_id,
            change_summary, created_at
        ) VALUES (
            ?, ?, 1, '1.0.0', '{}', ?, 'human', 'local-user', NULL,
            'initial', '2026-08-03T00:00:00Z'
        )
        """,
        (version_id, artifact_id, f"sha256:{'c' * 64}"),
    )
    connection.execute(
        """
        INSERT INTO artifact_heads VALUES (
            ?, ?, NULL, NULL, NULL, 1, 0, '2026-08-03T00:00:00Z'
        )
        """,
        (artifact_id, version_id),
    )


def test_database_enforces_version_immutability_head_ownership_and_acyclic_edges(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    create_v1_database(database)
    StudioRepository(database)

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        insert_artifact_version(
            connection,
            artifact_id="art_story",
            artifact_type="story_bible",
            version_id="ver_story",
        )
        insert_artifact_version(
            connection,
            artifact_id="art_source",
            artifact_type="source_manifest",
            version_id="ver_source",
        )
        connection.commit()

        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE artifact_versions SET content_json = '{\"changed\":true}' "
                "WHERE version_id = 'ver_story'"
            )
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute("DELETE FROM artifact_versions WHERE version_id = 'ver_story'")
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE source_documents SET normalized_text = '被改写' WHERE id = 'src_existing'"
            )
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute("DELETE FROM source_blocks WHERE id = 'srcb_existing'")

        connection.execute(
            """
            INSERT INTO artifact_dependencies VALUES (
                'dep_1', 'art_story', 'ver_story', 'art_source', 'ver_source',
                'derived_from', 'blocking', '2026-08-03T00:00:00Z'
            )
            """
        )
        with pytest.raises(sqlite3.IntegrityError, match="cycle"):
            connection.execute(
                """
                INSERT INTO artifact_dependencies VALUES (
                    'dep_2', 'art_source', 'ver_source', 'art_story', 'ver_story',
                    'derived_from', 'blocking', '2026-08-03T00:00:00Z'
                )
                """
            )
        connection.rollback()

        with pytest.raises(sqlite3.IntegrityError, match="accepted head"):
            connection.execute(
                "UPDATE artifact_heads SET accepted_version_id = 'ver_source' "
                "WHERE artifact_id = 'art_story'"
            )
        connection.rollback()
