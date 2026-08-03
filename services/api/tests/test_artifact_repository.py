import hashlib
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
        artifact_type="story_bible",
        schema_version="1.0.0",
        content={"title": "雾城", "facts": []},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="建立故事圣经",
    )
    second = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content={"facts": [], "title": "雾城来信"},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="补充标题",
        parent_version_id=first.version.id,
        expected_revision=first.head.revision,
    )

    restored = StudioRepository(database).get_artifact_version(
        project.id, "story_bible", first.version.id
    )
    head = StudioRepository(database).get_artifact_head(project.id, "story_bible")

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
            artifact_type="story_bible",
            schema_version="1.0.0",
            content={"title": "过期编辑", "facts": []},
            author_actor_type="human",
            author_actor_id="local-user",
            change_summary="过期",
            parent_version_id=second.version.id,
            expected_revision=1,
        )
    assert repository.get_artifact_head(project.id, "story_bible") == second.head


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
        artifact_type="story_bible",
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
        .get_artifact_version(project.id, "story_bible", created.version.id)
        .source_spans[0]
        == span
    )


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
            artifact_type="story_bible",
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
        repository.get_artifact_head(project.id, "story_bible")


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
        artifact_type="story_bible",
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
            artifact_type="story_bible",
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
        repository.get_artifact_head(target_project.id, "story_bible")


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
            artifact_type="story_bible",
            schema_version="1.0.0",
            content={"title": "冲突", "facts": []},
            author_actor_type="human",
            author_actor_id="local-user",
            change_summary="应回滚",
        )

    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "story_bible")
