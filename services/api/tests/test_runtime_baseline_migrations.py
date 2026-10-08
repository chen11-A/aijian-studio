"""Forward-only, synthetic fixtures for the independently rebuilt runtime baseline.

Historical fixtures are stopped at an actual migration boundary, never fabricated
by lowering user_version on a current database. No network or credential vault is
used by these tests.
"""

import base64
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from aijian_api.repository import SCHEMA_VERSION, StudioRepository

NOW = "2026-10-08T00:00:00Z"
HASH = "sha256:" + "a" * 64
PROJECT_ID = "prj_" + "1" * 32
PROVIDER_ID = "pcn_" + "2" * 32
SUB2API_ID = "pcn_" + "b" * 32
ATTEMPT_ID = "att_" + "3" * 32
TASK_ID = "tsk_" + "4" * 32
ARTIFACT_ID = "art_" + "5" * 32
VERSION_ID = "arv_" + "6" * 32


def _version(path: Path) -> int:
    with sqlite3.connect(path) as connection:
        return int(connection.execute("PRAGMA user_version").fetchone()[0])


def _migrate_through(path: Path, version: int) -> None:
    """Produce the exact historical schema by interrupting the next transaction."""
    assert 0 < version <= SCHEMA_VERSION
    if version == SCHEMA_VERSION:
        StudioRepository(path)
    else:

        def stop(next_version: int, _step: int) -> None:
            if next_version == version + 1:
                raise RuntimeError("historical fixture boundary")

        with pytest.raises(RuntimeError, match="historical fixture boundary"):
            StudioRepository(path, migration_hook=stop)
    assert _version(path) == version


@contextmanager
def _connection(path: Path) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _seed_v21(path: Path) -> None:
    """Seed real FK chains crossing both artifacts and provider table rebuilds."""
    _migrate_through(path, 21)
    with _connection(path) as connection:
        connection.execute(
            "INSERT INTO projects VALUES (?, 'Synthetic legacy project', '9:16', 90, "
            "'zh-CN', 'active', 7, ?, ?)",
            (PROJECT_ID, NOW, NOW),
        )
        connection.execute(
            "INSERT INTO episodes VALUES (?, ?, 1, '第 1 集', 1, 90, 3, ?, ?)",
            ("ep_" + PROJECT_ID, PROJECT_ID, NOW, NOW),
        )
        connection.execute(
            "INSERT INTO source_documents VALUES "
            "('src_legacy', ?, 'synthetic.txt', 'text/plain', 'utf-8', 3, ?, 'abc', ?, 1)",
            (PROJECT_ID, "b" * 64, NOW),
        )
        connection.execute(
            "INSERT INTO source_blocks VALUES "
            "('srcb_legacy', 'src_legacy', ?, 0, 'paragraph', 1, 'abc', 0, 3, ?)",
            (PROJECT_ID, "c" * 64),
        )
        connection.execute(
            "INSERT INTO artifacts VALUES (?, ?, 'SyntheticMigrationArtifact', ?)",
            (ARTIFACT_ID, PROJECT_ID, NOW),
        )
        connection.execute(
            "INSERT INTO artifact_versions (version_id, artifact_id, version_number, "
            "schema_version, content_json, content_hash, author_actor_type, author_actor_id, "
            "parent_version_id, change_summary, created_at) VALUES "
            "(?, ?, 1, '1.0.0', '{}', ?, 'human', 'synthetic-user', NULL, 'fixture', ?)",
            (VERSION_ID, ARTIFACT_ID, HASH, NOW),
        )
        connection.execute(
            "INSERT INTO artifact_heads VALUES (?, ?, NULL, NULL, NULL, 1, 0, ?)",
            (ARTIFACT_ID, VERSION_ID, NOW),
        )
        connection.execute(
            "INSERT INTO artifact_source_spans VALUES "
            "('span_legacy', ?, ?, 'fact_legacy', ?, 'src_legacy', 'srcb_legacy', "
            "'supports', 0, 3, 'synthetic fact', ?, ?)",
            (ARTIFACT_ID, VERSION_ID, PROJECT_ID, HASH, NOW),
        )
        connection.execute(
            "INSERT INTO provider_connections VALUES "
            "(?, 'CPA_LOOPBACK', 'Synthetic provider', 'http://127.0.0.1:8317', "
            "1, '[]', 9, ?, ?)",
            (PROVIDER_ID, NOW, NOW),
        )
        connection.execute(
            "INSERT INTO workflow_definitions VALUES ('synthetic.migration', 1, ?, '{}', ?)",
            (HASH, NOW),
        )
        connection.execute(
            "INSERT INTO workflow_runs VALUES "
            "('wfr_legacy', ?, 'synthetic.migration', 1, ?, 'ACTIVE', 1, NULL, ?, ?)",
            (PROJECT_ID, HASH, NOW, NOW),
        )
        connection.execute(
            "INSERT INTO workflow_node_runs (node_run_id, workflow_run_id, node_key, "
            "node_type, contract_version, input_bindings_json, input_hash, idempotency_key, "
            "status, attempt_count, max_attempts, revision, created_at, updated_at) "
            "VALUES ('node_legacy', 'wfr_legacy', 'extract', 'remote.extract', 1, '{}', ?, "
            "'synthetic:migration', 'PENDING', 0, 1, 1, ?, ?)",
            (HASH, NOW, NOW),
        )
        connection.execute(
            "INSERT INTO workflow_attempts (attempt_id, node_run_id, attempt_number, "
            "execution_mode, status, input_hash, request_fingerprint, revision, "
            "created_at, updated_at) "
            "VALUES (?, 'node_legacy', 1, 'remote', 'READY', ?, ?, 1, ?, ?)",
            (ATTEMPT_ID, HASH, HASH, NOW, NOW),
        )
        connection.execute(
            "INSERT INTO task_ledger (task_id, attempt_id, task_kind, status, priority, "
            "available_at, lease_generation, revision, created_at, updated_at) "
            "VALUES (?, ?, 'remote.extract', 'READY', 50, ?, 0, 1, ?, ?)",
            (TASK_ID, ATTEMPT_ID, NOW, NOW, NOW),
        )
        connection.execute(
            "INSERT INTO remote_dispatch_snapshots VALUES "
            "(?, ?, 'remote.source.extract', ?, ?, ?, 'SYNTHETIC_CAPABILITY_PROBE', "
            "'{}', ?, 9, 'synthetic-model', 'CPA_LOOPBACK_V1', ?, 0, 'USD', "
            "'synthetic-migration', ?, ?)",
            (ATTEMPT_ID, PROJECT_ID, HASH, "ctx_" + "7" * 32, HASH, PROVIDER_ID, HASH, HASH, NOW),
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def _seed_later_children(path: Path) -> None:
    """Exercise additional incoming FKs introduced before credential/origin rebuilds."""
    version = _version(path)
    with _connection(path) as connection:
        if version >= 22:
            columns = (
                "connection_id, provider_kind, display_name, base_url, enabled, "
                "models_json, revision, created_at, updated_at"
            )
            values = [
                SUB2API_ID,
                "SUB2API",
                "Synthetic gateway",
                "https://gateway.example",
                1,
                "[]",
                4,
                NOW,
                NOW,
            ]
            if version >= 31:
                columns += ", credential_ref"
                values.append(SUB2API_ID + ":crd_" + "c" * 32)
            placeholders = ", ".join("?" for _ in values)
            connection.execute(
                f"INSERT INTO provider_connections ({columns}) VALUES ({placeholders})", values
            )
        if version >= 23:
            connection.execute(
                "INSERT INTO sub2api_source_extract_scopes VALUES "
                "(?, ?, ?, '{}', ?, ?, 4, 'synthetic-model', ?, ?, ?, ?, ?)",
                (TASK_ID, ATTEMPT_ID, PROJECT_ID, HASH, SUB2API_ID, HASH, HASH, HASH, HASH, NOW),
            )
        if version >= 31:
            connection.execute(
                "INSERT INTO provider_credential_rotation_operations VALUES "
                "(?, ?, 9, ?, 'PREPARED', ?, ?, NULL)",
                ("pcop_" + "8" * 32, PROVIDER_ID, PROVIDER_ID + ":crd_" + "9" * 32, NOW, NOW),
            )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def _snapshot(path: Path) -> tuple[list[tuple], dict[str, tuple[tuple[str, ...], list[tuple]]]]:
    with _connection(path) as connection:
        schema = connection.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master "
            "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
        ).fetchall()
        tables = [str(row[1]) for row in schema if row[0] == "table"]
        rows = {
            table: (
                tuple(str(row[1]) for row in connection.execute(f'PRAGMA table_info("{table}")')),
                sorted(connection.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr),
            )
            for table in tables
        }
        return schema, rows


def _assert_rows_preserved(
    path: Path, before: dict[str, tuple[tuple[str, ...], list[tuple]]]
) -> None:
    with _connection(path) as connection:
        for table, (columns, expected) in before.items():
            projection = ", ".join(f'"{column}"' for column in columns)
            actual = connection.execute(f'SELECT {projection} FROM "{table}"').fetchall()
            assert sorted(actual, key=repr) == expected, table
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def _assert_existing_guards_preserved(path: Path, before: list[tuple]) -> None:
    """Rebuilding a parent must retain every existing child FK and audit guard."""
    after = {row[1]: row for row in _snapshot(path)[0]}
    for kind, name, table, sql in before:
        if kind == "table" and name in {"projects", "artifacts", "provider_connections"}:
            continue  # These are the deliberately extended/rebuilt parent definitions.
        actual = after[name]
        assert actual[:3] == (kind, name, table)
        assert " ".join(actual[3].split()) == " ".join(sql.split()), name


def _backup(source: Path, destination: Path) -> None:
    with _connection(source) as source_connection, _connection(destination) as target_connection:
        source_connection.backup(target_connection)


def test_legacy_v21_upgrade_preserves_rows_and_reference_chains(tmp_path: Path) -> None:
    database = tmp_path / "legacy-v21.sqlite3"
    _seed_v21(database)
    before_schema, before_rows = _snapshot(database)

    StudioRepository(database)

    assert _version(database) == SCHEMA_VERSION
    assert SCHEMA_VERSION >= 33
    _assert_rows_preserved(database, before_rows)
    _assert_existing_guards_preserved(database, before_schema)
    with _connection(database) as connection:
        assert connection.execute(
            "SELECT credential_ref, origin_mode, revision FROM provider_connections"
        ).fetchone() == (PROVIDER_ID, None, 9)
        assert connection.execute("SELECT episode_id FROM artifacts").fetchone() == (None,)
        assert connection.execute(
            "SELECT description, sequence_timebase_json, revision FROM projects"
        ).fetchone() == ("", None, 7)
        for table in (
            "provider_credential_rotation_operations",
            "engineering_test_export_operations",
            "engineering_test_export_outputs",
            "project_settings_write_receipts",
        ):
            assert connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone() == (0,)

    # Opening the migrated file again must be idempotent, including schema SQL.
    migrated = _snapshot(database)
    reopened = StudioRepository(database)
    assert reopened.get_project(PROJECT_ID).revision == 7
    assert _snapshot(database) == migrated


def test_origin_upgrade_preserves_rotated_credential_and_unconsumed_scope(tmp_path: Path) -> None:
    database = tmp_path / "origin-v32.sqlite3"
    _seed_v21(database)
    _migrate_through(database, 32)
    _seed_later_children(database)
    before = _snapshot(database)[1]

    StudioRepository(database)

    _assert_rows_preserved(database, before)
    with _connection(database) as connection:
        assert connection.execute(
            "SELECT origin_mode, credential_ref, revision FROM provider_connections "
            "WHERE connection_id = ?",
            (SUB2API_ID,),
        ).fetchone() == ("PUBLIC_HTTPS", SUB2API_ID + ":crd_" + "c" * 32, 4)
        assert connection.execute("SELECT COUNT(*) FROM sub2api_call_consumptions").fetchone() == (
            0,
        )


@pytest.mark.parametrize("version", [22, 24, 31, 33])
@pytest.mark.parametrize("legacy_alter", [0, 1])
def test_rebuild_failure_after_every_statement_rolls_back_and_retry_recovers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, version: int, legacy_alter: int
) -> None:
    original = tmp_path / f"before-v{version}.sqlite3"
    _seed_v21(original)
    _migrate_through(original, version - 1)
    _seed_later_children(original)
    before = _snapshot(original)
    probe = tmp_path / f"probe-v{version}.sqlite3"
    _backup(original, probe)
    steps: list[int] = []
    StudioRepository(
        probe,
        migration_hook=lambda next_version, step: (
            steps.append(step) if next_version == version else None
        ),
    )
    assert steps and steps == list(range(len(steps)))
    _assert_rows_preserved(probe, before[1])
    _assert_existing_guards_preserved(probe, before[0])

    restored_settings: list[tuple[int, int]] = []

    class InspectedConnection(sqlite3.Connection):
        def close(self) -> None:
            restored_settings.append(
                (
                    int(self.execute("PRAGMA foreign_keys").fetchone()[0]),
                    int(self.execute("PRAGMA legacy_alter_table").fetchone()[0]),
                )
            )
            super().close()

    original_connect = sqlite3.connect

    def inspected_connect(*args: object, **kwargs: object) -> sqlite3.Connection:
        connection = original_connect(*args, **kwargs, factory=InspectedConnection)
        connection.execute(f"PRAGMA legacy_alter_table = {legacy_alter}")
        return connection

    for failing_step in steps:
        database = tmp_path / f"failure-v{version}-step-{failing_step}.sqlite3"
        _backup(original, database)
        restored_settings.clear()

        def fail(next_version: int, step: int, fail_at: int = failing_step) -> None:
            if next_version == version and step == fail_at:
                raise RuntimeError("injected rebuild failure")

        with monkeypatch.context() as context:
            context.setattr(sqlite3, "connect", inspected_connect)
            with pytest.raises(RuntimeError, match="injected rebuild failure"):
                StudioRepository(database, migration_hook=fail)
        assert restored_settings == [(1, legacy_alter)]
        assert _version(database) == version - 1
        assert _snapshot(database) == before
        _assert_rows_preserved(database, before[1])

        restored_settings.clear()
        with monkeypatch.context() as context:
            context.setattr(sqlite3, "connect", inspected_connect)
            StudioRepository(database)
        assert restored_settings == [(1, legacy_alter)]
        assert _version(database) == SCHEMA_VERSION
        _assert_rows_preserved(database, before[1])
        _assert_existing_guards_preserved(database, before[0])


@pytest.mark.parametrize("version", [22, 24, 31, 33])
def test_rebuild_rejects_broken_foreign_keys_without_committing(
    tmp_path: Path, version: int
) -> None:
    database = tmp_path / f"invalid-fk-v{version}.sqlite3"
    _seed_v21(database)
    _migrate_through(database, version - 1)
    # A deliberately corrupt synthetic legacy file must never be silently blessed.
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO source_documents VALUES "
            "('src_orphan', 'missing-project', 'synthetic.txt', 'text/plain', 'utf-8', "
            "3, ?, 'abc', ?, 1)",
            ("d" * 64, NOW),
        )
    before = _snapshot(database)

    with pytest.raises(RuntimeError, match="foreign keys"):
        StudioRepository(database)

    assert _version(database) == version - 1
    assert _snapshot(database) == before
    with _connection(database) as connection:
        connection.execute(
            "INSERT INTO projects (id, name, aspect_ratio, target_duration_seconds, "
            "source_language, status, revision, created_at, updated_at) VALUES "
            "('missing-project', 'Synthetic repaired parent', '9:16', 90, "
            "'zh-CN', 'active', 1, ?, ?)",
            (NOW, NOW),
        )
    repaired = _snapshot(database)[1]
    StudioRepository(database)
    assert _version(database) == SCHEMA_VERSION
    _assert_rows_preserved(database, repaired)


def test_lazy_app_startup_creates_project_and_reopens_persisted_truth(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from aijian_api.main import create_app
    from fastapi.testclient import TestClient

    class NoCredentialIO:
        def get(self, _reference: str) -> None:
            raise AssertionError("project startup must not read credentials")

        def set(self, _reference: str, _secret: str) -> None:
            raise AssertionError("project startup must not write credentials")

        def delete(self, _reference: str) -> None:
            raise AssertionError("project startup must not delete credentials")

    monkeypatch.setenv("AIJIAN_DATA_DIR", str(tmp_path))
    database = tmp_path / "workspace.sqlite3"
    with TestClient(create_app(credential_vault=NoCredentialIO())) as client:
        assert client.get("/api/v1/health").status_code == 200
        assert not database.exists(), "health must not create a workspace as a side effect"
        response = client.post(
            "/api/v1/projects",
            json={
                "name": "Synthetic startup smoke",
                "aspect_ratio": "9:16",
                "target_duration_seconds": 90,
                "source_language": "zh-CN",
            },
        )
        assert response.status_code == 201, response.text
        project = response.json()["data"]
        assert project["revision"] == 1
        prefix = f"/api/v1/projects/{project['id']}"
        imported = client.post(
            prefix + "/sources",
            json={
                "filename": "synthetic.txt",
                "media_type": "text/plain",
                "content_base64": base64.b64encode("第一章\n合成迁移测试。".encode()).decode(),
            },
        )
        assert imported.status_code == 201, imported.text
        source = imported.json()["data"]
        manifest = client.get(prefix + "/source-manifest").json()["data"]
        episodes = client.get(prefix + "/episodes").json()["data"]
        assert client.get("/api/v1/provider-connections").json()["data"] == []
        project = client.get(prefix).json()["data"]
        assert project["revision"] == 2

    assert _version(database) == SCHEMA_VERSION
    before = _snapshot(database)
    with TestClient(create_app(credential_vault=NoCredentialIO())) as client:
        assert client.get(prefix).json()["data"] == project
        assert client.get(prefix + f"/sources/{source['id']}").json()["data"] == source
        assert client.get(prefix + "/source-manifest").json()["data"] == manifest
        assert client.get(prefix + "/episodes").json()["data"] == episodes
    assert _snapshot(database) == before
    _assert_rows_preserved(database, before[1])
