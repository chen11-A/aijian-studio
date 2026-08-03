import sqlite3
from pathlib import Path

import pytest
from aijian_api.repository import SCHEMA_VERSION, StudioRepository

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
    assert SCHEMA_VERSION == 2
    assert database_version(database) == SCHEMA_VERSION
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
    } <= tables


def test_v1_migration_preserves_projects_sources_and_blocks(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    create_v1_database(database)

    repository = StudioRepository(database)

    assert repository.get_project("prj_existing").name == "旧项目"
    source = repository.get_source("prj_existing", "src_existing")
    assert source.normalized_text == "第一段"
    assert [block.text for block in source.blocks] == ["第一段"]
    assert database_version(database) == 2


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
        assert database_version(database) == 2


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
        INSERT INTO artifact_versions VALUES (
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

        connection.execute(
            "UPDATE artifact_heads SET accepted_version_id = 'ver_source' "
            "WHERE artifact_id = 'art_story'"
        )
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            connection.commit()
        connection.rollback()
