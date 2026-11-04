"""Offline SQL checks for the independently reconstructed origin-mode migration."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from aijian_api.provider_credential_ref_schema import PROVIDER_CREDENTIAL_REF_MIGRATION
from aijian_api.provider_origin_mode_schema import (
    PROVIDER_ORIGIN_MODE_MIGRATION,
    migration_33_statements,
)
from aijian_api.provider_schema import (
    MIGRATION_7,
    migration_20_statements,
    migration_22_statements,
)

CONNECTION_ID = "pcn_" + "a" * 32
CANDIDATE_REF = CONNECTION_ID + ":crd_" + "b" * 32
OPERATION_ID = "pcop_" + "c" * 32
TIME = "2026-10-08T00:00:00Z"


def _seed_v32(connection: sqlite3.Connection) -> None:
    for statements in (
        MIGRATION_7,
        migration_20_statements(),
        migration_22_statements(),
        PROVIDER_CREDENTIAL_REF_MIGRATION,
    ):
        for statement in statements:
            connection.execute(statement)
    rows = (
        (CONNECTION_ID, "SUB2API", "https://gateway.example"),
        ("pcn_" + "1" * 32, "OPENAI", "https://api.openai.com/v1"),
        ("pcn_" + "2" * 32, "XAI", "https://api.x.ai/v1"),
        ("pcn_" + "3" * 32, "OPENAI_COMPATIBLE", "https://gateway.example/v1"),
        ("pcn_" + "4" * 32, "OLLAMA", "http://127.0.0.1:11434/v1"),
        ("pcn_" + "5" * 32, "CPA_LOOPBACK", "http://127.0.0.1:8317"),
    )
    for identifier, kind, url in rows:
        connection.execute(
            "INSERT INTO provider_connections VALUES (?, ?, ?, ?, 1, '[]', 1, ?, ?, ?)",
            (identifier, kind, kind, url, TIME, TIME, identifier),
        )
    connection.execute(
        "INSERT INTO provider_credential_rotation_operations VALUES "
        "(?, ?, 1, ?, 'PREPARED', ?, ?, NULL)",
        (OPERATION_ID, CONNECTION_ID, CANDIDATE_REF, TIME, TIME),
    )
    connection.execute(
        "UPDATE provider_connections SET credential_ref = ?, revision = 2 WHERE connection_id = ?",
        (CANDIDATE_REF, CONNECTION_ID),
    )
    connection.execute(
        "UPDATE provider_credential_rotation_operations "
        "SET status = 'APPLIED', applied_revision = 2"
    )
    connection.execute(
        "CREATE TABLE retained_reference (connection_id TEXT NOT NULL "
        "REFERENCES provider_connections(connection_id))"
    )
    connection.execute("INSERT INTO retained_reference VALUES (?)", (CONNECTION_ID,))
    connection.execute("PRAGMA user_version = 32")
    connection.commit()


def _upgrade(connection: sqlite3.Connection, *, fail_step: int | None = None) -> None:
    connection.execute("PRAGMA foreign_keys = OFF")
    try:
        connection.execute("BEGIN IMMEDIATE")
        for step, statement in enumerate(PROVIDER_ORIGIN_MODE_MIGRATION):
            connection.execute(statement)
            if step == fail_step:
                raise RuntimeError("injected migration failure")
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        connection.execute("PRAGMA user_version = 33")
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys = ON")


@contextmanager
def _database(path: Path) -> Iterator[sqlite3.Connection]:
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        _seed_v32(connection)
        _upgrade(connection)
        yield connection


def _insert(
    connection: sqlite3.Connection, url: str, mode: str | None, *, kind: str = "SUB2API"
) -> None:
    identifier = "pcn_" + "d" * 32
    connection.execute(
        "INSERT INTO provider_connections VALUES "
        "(?, ?, 'new connection', ?, 1, '[]', 1, ?, ?, ?, ?)",
        (identifier, kind, url, TIME, TIME, identifier, mode),
    )


def _snapshot(connection: sqlite3.Connection) -> list[str]:
    return list(connection.iterdump())


def test_backfill_preserves_all_metadata_credentials_history_and_foreign_keys(
    tmp_path: Path,
) -> None:
    database = tmp_path / "upgrade.db"
    with sqlite3.connect(database) as connection:
        _seed_v32(connection)
        before = connection.execute(
            "SELECT * FROM provider_connections ORDER BY connection_id"
        ).fetchall()
        history = connection.execute(
            "SELECT * FROM provider_credential_rotation_operations"
        ).fetchall()
        old_triggers = dict(
            connection.execute("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'")
        )
        _upgrade(connection)
        after = connection.execute(
            "SELECT * FROM provider_connections ORDER BY connection_id"
        ).fetchall()
        assert [row[:-1] for row in after] == before
        assert [row[-1] for row in after] == [None] * 5 + ["PUBLIC_HTTPS"]
        assert (
            connection.execute("SELECT * FROM provider_credential_rotation_operations").fetchall()
            == history
        )
        current_triggers = dict(
            connection.execute("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'")
        )
        assert old_triggers.items() <= current_triggers.items()
        assert connection.execute("PRAGMA foreign_keys").fetchone() == (1,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert migration_33_statements() == PROVIDER_ORIGIN_MODE_MIGRATION
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone() == (33,)
        assert connection.execute(
            "SELECT origin_mode FROM provider_connections WHERE connection_id = ?", (CONNECTION_ID,)
        ).fetchone() == ("PUBLIC_HTTPS",)


@pytest.mark.parametrize("fail_step", range(len(PROVIDER_ORIGIN_MODE_MIGRATION)))
def test_every_migration_statement_rolls_back_completely(tmp_path: Path, fail_step: int) -> None:
    database = tmp_path / "rollback.db"
    with sqlite3.connect(database) as connection:
        _seed_v32(connection)
        before = _snapshot(connection)
        with pytest.raises(RuntimeError, match="injected migration failure"):
            _upgrade(connection, fail_step=fail_step)
        assert _snapshot(connection) == before
        assert connection.execute("PRAGMA user_version").fetchone() == (32,)
        assert connection.execute("PRAGMA foreign_keys").fetchone() == (1,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    with sqlite3.connect(database) as reopened:
        assert _snapshot(reopened) == before
        _upgrade(reopened)
        assert reopened.execute("PRAGMA user_version").fetchone() == (33,)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:1",
        "http://127.0.0.1:65535",
        "http://127.0.0.1:8080",
        "http://[::1]:1",
        "http://[::1]:65535",
    ],
)
def test_direct_sql_accepts_canonical_local_origins(tmp_path: Path, url: str) -> None:
    with _database(tmp_path / "valid.db") as connection:
        _insert(connection, url, "LOCAL_LOOPBACK_HTTP")
        assert connection.execute(
            "SELECT base_url, origin_mode FROM provider_connections "
            "WHERE display_name = 'new connection'"
        ).fetchone() == (url, "LOCAL_LOOPBACK_HTTP")


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8080",
        "http://localhost",
        "http://127.0.0.1",
        "http://[::1]",
        "http://127.0.0.1:0",
        "http://127.0.0.1:65536",
        "http://127.0.0.1:08080",
        "http://127.0.0.1:+8080",
        "http://127.0.0.1:8e3",
        "http://127.0.0.1:8080/",
        "http://127.0.0.1:8080/v1",
        "http://127.0.0.1:8080?",
        "http://127.0.0.1:8080#",
        "http://user@127.0.0.1:8080",
        "http://127.0.0.2:8080",
        "http://127.1:8080",
        "http://2130706433:8080",
        "http://0x7f000001:8080",
        "http://10.0.0.1:8080",
        "http://192.168.1.1:8080",
        "http://[0:0:0:0:0:0:0:1]:8080",
        "http://[::ffff:127.0.0.1]:8080",
        "http://[fe80::1%25lo]:8080",
        "http://gateway.example:8080",
        "https://127.0.0.1:8080",
        "HTTP://127.0.0.1:8080",
        " http://127.0.0.1:8080",
        "http://127.0.0.1:8080\n",
        "http://127.0.0.1:8080\x00evil",
        "http://127.0.0.1:8080\\evil",
        "http://127.0.0.1:8080.evil.example",
    ],
)
def test_direct_sql_rejects_local_bypasses_on_insert_and_update(tmp_path: Path, url: str) -> None:
    with _database(tmp_path / "invalid.db") as connection:
        before = _snapshot(connection)
        with pytest.raises(sqlite3.IntegrityError):
            _insert(connection, url, "LOCAL_LOOPBACK_HTTP")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE provider_connections SET base_url = ?, "
                "origin_mode = 'LOCAL_LOOPBACK_HTTP', revision = revision + 1 "
                "WHERE connection_id = ?",
                (url, CONNECTION_ID),
            )
        assert _snapshot(connection) == before


@pytest.mark.parametrize(
    "url",
    [
        "https://gateway.example",
        "https://gateway.example:8443",
        "https://8.8.8.8",
        "https://中文.example",
        "https://[::ffff:8.8.8.8]",
        "https://[::ffff:808:808]",
        "https://[2001:4860:4860::8888]",
        "https://[2606:4700:4700::1111]:443",
    ],
)
def test_direct_sql_accepts_public_https_origins(tmp_path: Path, url: str) -> None:
    with _database(tmp_path / "public.db") as connection:
        _insert(connection, url, "PUBLIC_HTTPS")


@pytest.mark.parametrize(
    "url",
    [
        "http://gateway.example",
        "HTTPS://gateway.example",
        "https://gateway.example/",
        "https://gateway.example/v1",
        "https://user@gateway.example",
        "https://gateway.example?",
        "https://gateway.example#",
        "https://gateway.example\\evil",
        "https://gateway.example:0",
        "https://gateway.example:65536",
        "https://gateway.example:",
        "https://gateway.example:443:80",
        "https://localhost",
        "https://test.localhost",
        "https://127.0.0.1",
        "https://127.0.0.2",
        "https://10.0.0.1",
        "https://172.16.0.1",
        "https://192.168.0.1",
        "https://169.254.169.254",
        "https://100.64.0.1",
        "https://192.0.2.1",
        "https://198.51.100.1",
        "https://203.0.113.1",
        "https://224.0.0.1",
        "https://240.0.0.1",
        "https://[::1]",
        "https://[::ffff:127.0.0.1]",
        "https://[::ffff:7f00:1]",
        "https://[64:ff9b:1::1]",
        "https://[100::1]",
        "https://[0:0:0:0:0:0:0:1]",
        "https://[::]",
        "https://[fc00::1]",
        "https://[fe80::1]",
        "https://[ff02::1]",
        "https://[2001:db8::1]",
        "https://[2002::1]",
        "https://[3fff::1]",
        "https://[1:2]",
        "https://[2001:::1]",
        "https://[2001::2::3]",
        "https://[2001:4860:4860::8888]junk",
        "https://[2001:4860:4860::8888]:",
        "https://gateway.example\x00evil",
        "https://gateway.example\n",
        "https://gate way.example",
        "https://gateway%2eexample",
        "https://gateway.example\u2003",
    ],
)
def test_direct_sql_rejects_nonpublic_or_malformed_public_origins(tmp_path: Path, url: str) -> None:
    with _database(tmp_path / "public-invalid.db") as connection:
        before = _snapshot(connection)
        with pytest.raises(sqlite3.IntegrityError):
            _insert(connection, url, "PUBLIC_HTTPS")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE provider_connections SET base_url = ?, revision = revision + 1 "
                "WHERE connection_id = ?",
                (url, CONNECTION_ID),
            )
        assert _snapshot(connection) == before


@pytest.mark.parametrize("mode", [None, "LOCAL", "PUBLIC", "", "local_loopback_http"])
def test_sub2api_requires_known_nonnull_mode(tmp_path: Path, mode: str | None) -> None:
    with _database(tmp_path / "mode.db") as connection:
        with pytest.raises(sqlite3.IntegrityError):
            _insert(connection, "https://gateway.example", mode)


@pytest.mark.parametrize("mode", ["PUBLIC_HTTPS", "LOCAL_LOOPBACK_HTTP"])
def test_other_providers_cannot_claim_sub2api_mode(tmp_path: Path, mode: str) -> None:
    with _database(tmp_path / "other-mode.db") as connection:
        with pytest.raises(sqlite3.IntegrityError):
            _insert(connection, "https://api.openai.com/v1", mode, kind="OPENAI")


@pytest.mark.parametrize(
    "assignments",
    [
        "base_url = 'http://127.0.0.1:8080', origin_mode = 'LOCAL_LOOPBACK_HTTP'",
        "revision = revision + 2",
        "revision = revision - 1",
        "revision = 2.5",
        "connection_id = 'changed', revision = revision + 1",
        "provider_kind = 'OPENAI', origin_mode = NULL, revision = revision + 1",
        "created_at = 'changed', revision = revision + 1",
        "credential_ref = 'foreign-credential', revision = revision + 1",
    ],
)
def test_direct_sql_cannot_bypass_revision_identity_or_credential_guards(
    tmp_path: Path, assignments: str
) -> None:
    with _database(tmp_path / "cas.db") as connection:
        before = _snapshot(connection)
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                f"UPDATE provider_connections SET {assignments} WHERE connection_id = ?",
                (CONNECTION_ID,),
            )
        assert _snapshot(connection) == before


def test_direct_sql_atomic_mode_switch_preserves_credential_and_rolls_back(tmp_path: Path) -> None:
    with _database(tmp_path / "switch.db") as connection:
        before = _snapshot(connection)
        connection.execute("SAVEPOINT edit")
        connection.execute(
            "UPDATE provider_connections SET base_url = 'http://127.0.0.1:8080', "
            "origin_mode = 'LOCAL_LOOPBACK_HTTP', revision = revision + 1 "
            "WHERE connection_id = ? AND revision = 2",
            (CONNECTION_ID,),
        )
        assert connection.execute(
            "SELECT origin_mode, revision, credential_ref FROM provider_connections "
            "WHERE connection_id = ?",
            (CONNECTION_ID,),
        ).fetchone() == ("LOCAL_LOOPBACK_HTTP", 3, CANDIDATE_REF)
        connection.execute("ROLLBACK TO edit")
        connection.execute("RELEASE edit")
        assert _snapshot(connection) == before


def test_cpa_fixed_origin_and_rotation_history_guards_survive(tmp_path: Path) -> None:
    with _database(tmp_path / "guards.db") as connection:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE provider_connections SET base_url = 'http://127.0.0.1:9999', "
                "revision = revision + 1 WHERE provider_kind = 'CPA_LOOPBACK'"
            )
        with pytest.raises(sqlite3.IntegrityError, match="history cannot be deleted"):
            connection.execute("DELETE FROM provider_credential_rotation_operations")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "DELETE FROM provider_connections WHERE connection_id = ?", (CONNECTION_ID,)
            )
