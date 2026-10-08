import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from aijian_api.ingestion import ingest_text_file
from aijian_api.repository import (
    ProjectNotFoundError,
    SchemaTooNewError,
    SourceAlreadyImportedError,
    StudioRepository,
)


def create_project(repository: StudioRepository, name: str = "雾城来信"):
    return repository.create_project(
        name=name,
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )


def test_projects_persist_across_repository_instances(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    first = StudioRepository(database)
    project = create_project(first)

    second = StudioRepository(database)

    assert project.id.startswith("prj_")
    assert project.revision == 1
    assert second.get_project(project.id) == project
    assert second.list_projects() == [project]


def test_source_import_is_atomic_persistent_and_deduplicated(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    project = create_project(repository)
    parsed = ingest_text_file(filename="story.txt", content="第一章\n第一段\n第二段".encode())

    imported = repository.import_source(project.id, parsed)

    assert imported.id.startswith("src_")
    assert imported.project_id == project.id
    assert len(imported.blocks) == 3
    assert all(block.id.startswith("srcb_") for block in imported.blocks)
    assert StudioRepository(database).get_source(project.id, imported.id) == imported
    assert StudioRepository(database).list_sources(project.id) == [imported.summary()]

    with pytest.raises(SourceAlreadyImportedError):
        repository.import_source(project.id, parsed)
    assert len(repository.list_sources(project.id)) == 1


def test_missing_project_does_not_create_a_source(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    parsed = ingest_text_file(filename="story.txt", content="第一段".encode())

    with pytest.raises(ProjectNotFoundError):
        repository.import_source("prj_missing", parsed)


def test_failed_block_insert_rolls_back_the_document(tmp_path: Path) -> None:
    identifiers: Iterator[str] = iter(
        [
            "prj_fixed",
            "src_fixed",
            "srcb_duplicate",
            "srcb_duplicate",
        ]
    )
    repository = StudioRepository(
        tmp_path / "workspace.db", id_factory=lambda _prefix: next(identifiers)
    )
    project = create_project(repository)
    parsed = ingest_text_file(filename="story.txt", content="第一段\n第二段".encode())

    with pytest.raises(sqlite3.IntegrityError):
        repository.import_source(project.id, parsed)

    assert repository.list_sources(project.id) == []


def test_newer_database_schema_is_rejected_without_writes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA user_version = 99")

    with pytest.raises(SchemaTooNewError):
        StudioRepository(database)

    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 99
