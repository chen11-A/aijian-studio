import hashlib
import threading
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import pytest
from aijian_api.domain import ArtifactDependencyDraft, ArtifactSourceSpanDraft
from aijian_api.ingestion import ingest_text_file
from aijian_api.repository import (
    ArtifactConflictError,
    SourceSpanInvalidError,
    StudioRepository,
)
from aijian_api.source_manifest import SourceManifestContentV1


def deterministic_id_factory():
    counters: defaultdict[str, int] = defaultdict(int)

    def create_id(prefix: str) -> str:
        counters[prefix] += 1
        return f"{prefix}_{counters[prefix]:032x}"

    return create_id


def create_repository(database: Path) -> StudioRepository:
    return StudioRepository(
        database,
        id_factory=deterministic_id_factory(),
        clock=lambda: datetime(2026, 8, 3, 12, 0, tzinfo=UTC),
    )


def create_project(repository: StudioRepository, name: str = "雾城来信"):
    return repository.create_project(
        name=name,
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )


def test_artifact_versions_are_immutable_persistent_and_conditionally_advanced(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    repository = create_repository(database)
    project = create_project(repository)

    first = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"title": "雾城", "facts": []},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="建立故事圣经",
    )
    second = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"facts": [], "title": "雾城来信"},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="补充标题",
        parent_version_id=first.version.id,
        expected_revision=first.head.revision,
    )

    restored = StudioRepository(database).get_artifact_version(
        project.id, "test_artifact", first.version.id
    )
    head = StudioRepository(database).get_artifact_head(project.id, "test_artifact")

    assert first.version.version_number == 1
    assert first.head.revision == 1
    assert second.version.version_number == 2
    assert second.head.revision == 2
    assert second.head.latest_version_id == second.version.id
    assert second.head.review_version_id is None
    assert second.head.accepted_version_id is None
    assert restored.version.content == {"title": "雾城", "facts": []}
    assert restored.version.content_hash == first.version.content_hash
    assert head == second.head

    with pytest.raises(ArtifactConflictError):
        repository.create_artifact_version(
            project_id=project.id,
            artifact_type="test_artifact",
            schema_version="1.0.0",
            content={"title": "过期编辑", "facts": []},
            author_actor_type="human",
            author_actor_id="local-user",
            change_summary="过期",
            parent_version_id=second.version.id,
            expected_revision=1,
        )
    assert repository.get_artifact_head(project.id, "test_artifact") == second.head


def test_latest_artifact_is_one_sqlite_snapshot_while_writer_advances_head(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    writer = create_repository(database)
    project = create_project(writer)
    first = writer.create_artifact_version(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"title": "读取中的版本"},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="初版",
    )
    head_selected = threading.Event()
    writer_finished = threading.Event()

    def pause_after_head(operation: str, step: str) -> None:
        if (operation, step) == ("get_latest_artifact", "head_selected"):
            head_selected.set()
            assert writer_finished.wait(5), "writer did not finish while the read snapshot was open"

    reader = StudioRepository(database, transaction_hook=pause_after_head)
    records = []
    read_errors: list[BaseException] = []

    def read_latest() -> None:
        try:
            records.append(reader.get_latest_artifact(project.id, "test_artifact"))
        except BaseException as error:  # pragma: no cover - asserted below for thread handoff
            read_errors.append(error)

    thread = threading.Thread(target=read_latest)
    thread.start()
    assert head_selected.wait(5), "reader did not establish its SQLite snapshot"
    second = writer.create_artifact_version(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"title": "并发写入的新版本"},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="并发更新",
        parent_version_id=first.version.id,
        expected_revision=first.head.revision,
    )
    writer_finished.set()
    thread.join(5)

    assert not thread.is_alive()
    assert read_errors == []
    assert len(records) == 1
    assert records[0].version.id == first.version.id
    assert records[0].head.latest_version_id == first.version.id
    assert writer.get_latest_artifact(project.id, "test_artifact").version.id == second.version.id


def test_artifact_role_index_is_one_sqlite_snapshot_while_writer_advances_head(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    writer = create_repository(database)
    project = create_project(writer)
    first = writer.create_artifact_version(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"title": "读取中的版本"},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="初版",
    )
    head_selected = threading.Event()
    writer_finished = threading.Event()

    def pause_after_head(operation: str, step: str) -> None:
        if (operation, step) == ("get_artifact_role_index", "head_selected"):
            head_selected.set()
            assert writer_finished.wait(5), "writer did not finish while the read snapshot was open"

    reader = StudioRepository(database, transaction_hook=pause_after_head)
    indexes = []
    read_errors: list[BaseException] = []

    def read_index() -> None:
        try:
            indexes.append(reader.get_artifact_role_index(project.id, "test_artifact"))
        except BaseException as error:  # pragma: no cover - asserted below for thread handoff
            read_errors.append(error)

    thread = threading.Thread(target=read_index)
    thread.start()
    assert head_selected.wait(5), "reader did not establish its SQLite snapshot"
    second = writer.create_artifact_version(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"title": "并发写入的新版本"},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="并发更新",
        parent_version_id=first.version.id,
        expected_revision=first.head.revision,
    )
    writer_finished.set()
    thread.join(5)

    assert not thread.is_alive()
    assert read_errors == []
    assert indexes[0].head.latest_version_id == first.version.id
    assert [version.id for version in indexes[0].versions] == [first.version.id]
    current = writer.get_artifact_role_index(project.id, "test_artifact")
    assert current.head.latest_version_id == second.version.id
    assert [version.id for version in current.versions] == [second.version.id]


def test_source_span_uses_document_absolute_utf8_bytes_and_server_hash(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = create_repository(database)
    project = create_project(repository)
    source = repository.import_source(
        project.id,
        ingest_text_file(filename="story.txt", content="第一章\n雾城😀来信".encode()),
    )
    paragraph = source.blocks[-1]
    start = paragraph.normalized_start_byte
    end = start + len("雾城😀".encode())

    created = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"title": "雾城", "facts": [{"fact_id": "fact_1"}]},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="引用原文",
        source_spans=(
            ArtifactSourceSpanDraft(
                fact_id="fact_1",
                source_document_id=source.id,
                source_block_id=paragraph.id,
                role="supports",
                start_byte=start,
                end_byte=end,
                claim="地点与线索",
            ),
        ),
    )

    span = created.source_spans[0]
    expected_quote = "雾城😀".encode()
    assert span.start_byte == start
    assert span.end_byte == end
    assert span.quote_hash == f"sha256:{hashlib.sha256(expected_quote).hexdigest()}"
    assert (
        StudioRepository(database)
        .get_artifact_version(project.id, "test_artifact", created.version.id)
        .source_spans[0]
        == span
    )


def test_source_import_atomically_creates_and_revises_typed_manifest(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    first_source = repository.import_source(
        project.id,
        ingest_text_file(filename="第一章.txt", content="第一章\n雾城来信".encode()),
    )
    first_head = repository.get_artifact_head(project.id, "source_manifest")
    first_record = repository.get_artifact_version(
        project.id, "source_manifest", first_head.latest_version_id
    )
    first_content = SourceManifestContentV1.model_validate(first_record.version.content)

    assert first_record.version.version_number == 1
    assert first_record.version.author_actor_type == "system"
    assert first_record.version.author_actor_id == "source-import"
    assert first_content.documents[0].source_document_id == first_source.id
    assert (
        first_content.documents[0].normalized_sha256
        == hashlib.sha256(first_source.normalized_text.encode("utf-8")).hexdigest()
    )
    assert [block.source_block_id for block in first_content.documents[0].blocks] == [
        block.id for block in first_source.blocks
    ]

    second_source = repository.import_source(
        project.id,
        ingest_text_file(filename="第二章.txt", content="第二章\n旧站重逢".encode()),
    )
    second_head = repository.get_artifact_head(project.id, "source_manifest")
    second_record = repository.get_artifact_version(
        project.id, "source_manifest", second_head.latest_version_id
    )
    second_content = SourceManifestContentV1.model_validate(second_record.version.content)

    assert second_record.version.version_number == 2
    assert second_record.version.parent_version_id == first_record.version.id
    assert second_head.revision == 2
    assert second_head.accepted_version_id is None
    assert [document.source_document_id for document in second_content.documents] == [
        first_source.id,
        second_source.id,
    ]
    assert (
        repository.get_artifact_version(
            project.id, "source_manifest", first_record.version.id
        ).version.content
        == first_record.version.content
    )


def test_source_manifest_failure_rolls_back_source_blocks_and_head(tmp_path: Path) -> None:
    failure_enabled = True

    def fail_after_manifest_version(operation: str, step: str) -> None:
        if failure_enabled and (operation, step) == (
            "import_source",
            "manifest_version_inserted",
        ):
            raise RuntimeError("injected manifest failure")

    repository = StudioRepository(
        tmp_path / "workspace.db",
        id_factory=deterministic_id_factory(),
        clock=lambda: datetime(2026, 8, 3, 12, 0, tzinfo=UTC),
        transaction_hook=fail_after_manifest_version,
    )
    project = create_project(repository)
    parsed = ingest_text_file(filename="story.txt", content="第一章\n雾城".encode())

    with pytest.raises(RuntimeError, match="injected manifest failure"):
        repository.import_source(project.id, parsed)

    assert repository.list_sources(project.id) == []
    assert repository.get_project(project.id).revision == 1
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "source_manifest")

    failure_enabled = False
    imported = repository.import_source(project.id, parsed)
    assert imported.filename == "story.txt"
    assert repository.get_artifact_head(project.id, "source_manifest").revision == 1


@pytest.mark.parametrize("offsets", [(1, 6), (0, 1), (0, 1000)])
def test_invalid_utf8_or_block_span_rolls_back_artifact(
    tmp_path: Path,
    offsets: tuple[int, int],
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    source = repository.import_source(
        project.id,
        ingest_text_file(filename="story.txt", content="第一章\n雾城".encode()),
    )
    paragraph = source.blocks[-1]

    with pytest.raises(SourceSpanInvalidError):
        repository.create_artifact_version(
            project_id=project.id,
            artifact_type="test_artifact",
            schema_version="1.0.0",
            content={"title": "雾城", "facts": [{"fact_id": "fact_1"}]},
            author_actor_type="human",
            author_actor_id="local-user",
            change_summary="非法引用",
            source_spans=(
                ArtifactSourceSpanDraft(
                    fact_id="fact_1",
                    source_document_id=source.id,
                    source_block_id=paragraph.id,
                    role="supports",
                    start_byte=paragraph.normalized_start_byte + offsets[0],
                    end_byte=paragraph.normalized_start_byte + offsets[1],
                    claim="非法",
                ),
            ),
        )

    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "test_artifact")


def test_artifact_dependency_points_to_exact_upstream_version(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    source_manifest = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": []},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="来源基线",
    )

    story_bible = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"title": "雾城", "facts": []},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="故事圣经",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source_manifest.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )

    dependency = story_bible.dependencies[0]
    assert dependency.downstream_version_id == story_bible.version.id
    assert dependency.upstream_version_id == source_manifest.version.id
    assert dependency.impact == "blocking"


def test_cross_project_source_span_is_rejected_without_partial_artifact(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    source_project = create_project(repository, "来源项目")
    target_project = create_project(repository, "目标项目")
    source = repository.import_source(
        source_project.id,
        ingest_text_file(filename="story.txt", content="第一段".encode()),
    )
    block = source.blocks[0]

    with pytest.raises(SourceSpanInvalidError):
        repository.create_artifact_version(
            project_id=target_project.id,
            artifact_type="test_artifact",
            schema_version="1.0.0",
            content={"title": "错误项目", "facts": [{"fact_id": "fact_1"}]},
            author_actor_type="human",
            author_actor_id="local-user",
            change_summary="跨项目引用",
            source_spans=(
                ArtifactSourceSpanDraft(
                    fact_id="fact_1",
                    source_document_id=source.id,
                    source_block_id=block.id,
                    role="supports",
                    start_byte=block.normalized_start_byte,
                    end_byte=block.normalized_end_byte,
                    claim="错误项目",
                ),
            ),
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(target_project.id, "test_artifact")


def test_identifier_collision_rolls_back_artifact_transaction(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = create_repository(database)
    project = create_project(repository)
    existing = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": []},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="来源",
    )

    collision = StudioRepository(
        database,
        id_factory=lambda prefix: (
            existing.version.id if prefix == "ver" else f"{prefix}_{'f' * 32}"
        ),
    )
    with pytest.raises(ArtifactConflictError):
        collision.create_artifact_version(
            project_id=project.id,
            artifact_type="test_artifact",
            schema_version="1.0.0",
            content={"title": "冲突", "facts": []},
            author_actor_type="human",
            author_actor_id="local-user",
            change_summary="应回滚",
        )

    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "test_artifact")
