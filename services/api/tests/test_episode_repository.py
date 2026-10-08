import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from threading import Barrier

import pytest
from aijian_api.repository import ProjectNotFoundError, StudioRepository

NOW = datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
SQLITE_MAX = 2**63 - 1


def project(repository: StudioRepository):
    return repository.create_project(
        name="整部作品", aspect_ratio="9:16", target_duration_seconds=90, source_language="zh-CN"
    )


def test_default_and_additional_episodes_persist_without_changing_project(tmp_path: Path) -> None:
    db = tmp_path / "workspace.db"
    repository = StudioRepository(db, clock=lambda: NOW)
    work = project(repository)
    default = repository.list_episodes(work.id)[0]
    assert default.id == f"ep_{work.id}"
    assert default.title == "第 1 集"
    assert default.position == 1
    assert default.is_default is True
    assert default.target_duration_seconds == 90
    assert default.revision == 1
    assert default.created_at == default.updated_at == work.created_at
    second = repository.create_episode(work.id, title="  重逢  ")
    third = repository.create_episode(work.id, title="终章", target_duration_seconds=3600)
    assert second.title == "重逢"
    assert second.target_duration_seconds is None
    assert second.is_default is False
    assert third.position == 3
    assert third.target_duration_seconds == 3600
    reopened = StudioRepository(db)
    assert reopened.list_episodes(work.id) == [default, second, third]
    assert reopened.list_episodes(work.id, limit=1, offset=1) == [second]
    assert reopened.list_episodes(work.id, offset=3) == []
    assert reopened.get_episode(work.id, third.id) == third
    assert reopened.get_project(work.id) == work
    assert second.created_at == second.updated_at == NOW


def test_default_does_not_consume_additional_factory_id(tmp_path: Path) -> None:
    ids = iter(["prj_fixed", "ep_fixed"])
    repository = StudioRepository(tmp_path / "workspace.db", id_factory=lambda _: next(ids))
    work = project(repository)
    assert repository.create_episode(work.id, title="第二集").id == "ep_fixed"


@pytest.mark.parametrize("duration", [1, 3600, SQLITE_MAX])
def test_episode_duration_uses_storage_bounds_not_product_length(tmp_path: Path, duration: int):
    repository = StudioRepository(tmp_path / "workspace.db")
    work = project(repository)
    saved = repository.create_episode(work.id, title="任意片长", target_duration_seconds=duration)
    assert repository.get_episode(work.id, saved.id).target_duration_seconds == duration


@pytest.mark.parametrize("duration", [0, -1, True, False, 1.5, "90", SQLITE_MAX + 1])
def test_invalid_duration_does_not_write(tmp_path: Path, duration: object) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    work = project(repository)
    with pytest.raises(ValueError, match="duration"):
        repository.create_episode(work.id, title="错误时长", target_duration_seconds=duration)
    assert len(repository.list_episodes(work.id)) == 1


@pytest.mark.parametrize("title", ["", " \t ", "x" * 81, "a\x00b", "a\x7fb", 123, None])
def test_invalid_title_does_not_write(tmp_path: Path, title: object) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    work = project(repository)
    with pytest.raises(ValueError, match="title"):
        repository.create_episode(work.id, title=title)
    assert len(repository.list_episodes(work.id)) == 1


@pytest.mark.parametrize(
    ("limit", "offset"),
    [(0, 0), (101, 0), (True, 0), (1.5, 0), (1, -1), (1, True), (1, 0.5), (1, SQLITE_MAX + 1)],
)
def test_invalid_pagination_has_predictable_error(tmp_path: Path, limit: object, offset: object):
    repository = StudioRepository(tmp_path / "workspace.db")
    work = project(repository)
    with pytest.raises(ValueError):
        repository.list_episodes(work.id, limit=limit, offset=offset)


def test_missing_and_cross_project_episode_is_not_visible(tmp_path: Path) -> None:
    from aijian_api.repository import EpisodeNotFoundError

    repository = StudioRepository(tmp_path / "workspace.db")
    one, two = project(repository), project(repository)
    episode = repository.list_episodes(one.id)[0]
    assert repository.list_episodes(two.id)[0].id != episode.id
    with pytest.raises(EpisodeNotFoundError):
        repository.get_episode(two.id, episode.id)
    with pytest.raises(EpisodeNotFoundError):
        repository.get_episode(one.id, "ep_missing")
    with pytest.raises(ProjectNotFoundError):
        repository.get_episode("prj_missing", episode.id)
    with pytest.raises(ProjectNotFoundError):
        repository.list_episodes("prj_missing")
    with pytest.raises(ProjectNotFoundError):
        repository.create_episode("prj_missing", title="不存在")
    assert len(repository.list_episodes(one.id)) == len(repository.list_episodes(two.id)) == 1


@pytest.mark.parametrize("step", ["project_inserted", "default_episode_inserted"])
def test_project_creation_failure_rolls_back_both_records(tmp_path: Path, step: str) -> None:
    def fail(operation: str, actual_step: str) -> None:
        if operation == "create_project" and actual_step == step:
            raise RuntimeError("injected failure")

    database = tmp_path / "workspace.db"
    repository = StudioRepository(database, transaction_hook=fail)
    with pytest.raises(RuntimeError, match="injected failure"):
        project(repository)
    assert StudioRepository(database).list_projects() == []
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM episodes").fetchone() == (0,)


def test_episode_creation_failure_rolls_back_and_position_can_be_reused(tmp_path: Path) -> None:
    def fail(operation: str, step: str) -> None:
        if operation == "create_episode" and step == "episode_inserted":
            raise RuntimeError("injected failure")

    database = tmp_path / "workspace.db"
    repository = StudioRepository(database, transaction_hook=fail)
    work = project(repository)
    with pytest.raises(RuntimeError, match="injected failure"):
        repository.create_episode(work.id, title="失败")
    reopened = StudioRepository(database)
    assert reopened.create_episode(work.id, title="重试").position == 2


def test_concurrent_repositories_allocate_distinct_positions(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repositories = [StudioRepository(database), StudioRepository(database)]
    work = project(repositories[0])
    barrier = Barrier(2)

    def create(index: int):
        barrier.wait(timeout=5)
        return repositories[index].create_episode(work.id, title=f"并发 {index}")

    with ThreadPoolExecutor(max_workers=2) as executor:
        saved = list(executor.map(create, [0, 1]))
    assert sorted(episode.position for episode in saved) == [2, 3]
    assert len({episode.id for episode in saved}) == 2
    assert len(StudioRepository(database).list_episodes(work.id)) == 3


def test_position_overflow_fails_without_inserting(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    work = project(repository)
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE episodes SET position = ?", (SQLITE_MAX,))
    with pytest.raises(ValueError, match="position"):
        repository.create_episode(work.id, title="溢出")
    assert len(repository.list_episodes(work.id)) == 1


def test_database_enforces_episode_identity_and_parent_constraints(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    work = project(repository)
    repository.create_episode(work.id, title="第二集")
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        for sql in (
            "UPDATE episodes SET project_id = 'prj_missing'",
            "UPDATE episodes SET position = 1 WHERE position = 2",
            "UPDATE episodes SET is_default = 1 WHERE position = 2",
            "UPDATE episodes SET position = 0",
            "UPDATE episodes SET revision = 0",
            "UPDATE episodes SET is_default = 2",
            "UPDATE episodes SET target_duration_seconds = -1",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(sql)
            connection.rollback()


def test_project_deletion_retains_existing_cascade_semantics(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    work = project(repository)
    repository.create_episode(work.id, title="第二集")
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DELETE FROM projects WHERE id = ?", (work.id,))
        assert connection.execute("SELECT COUNT(*) FROM episodes").fetchone() == (0,)


def test_more_episodes_than_page_limit_are_all_persisted(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    work = project(repository)
    for index in range(100):
        repository.create_episode(work.id, title=f"Episode {index + 2}")
    first_page = repository.list_episodes(work.id, limit=100)
    second_page = repository.list_episodes(work.id, limit=100, offset=100)
    assert [episode.position for episode in first_page] == list(range(1, 101))
    assert [episode.position for episode in second_page] == [101]
    assert repository.list_episodes(work.id, offset=SQLITE_MAX) == []
