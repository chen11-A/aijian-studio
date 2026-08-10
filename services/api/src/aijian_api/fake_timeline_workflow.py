"""Deterministic local workflow that turns an imported source into an editable preview."""

from datetime import UTC, datetime, timedelta
from hashlib import sha256

from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import ArtifactVersionRecord, SourceDocument
from aijian_api.local_executor import LocalExecutor
from aijian_api.media_contracts import SequenceFrameRateData, SequenceTimebaseData
from aijian_api.repository import ArtifactNotFoundError, StudioRepository
from aijian_api.task_ledger import ClaimedTask, LocalTaskLedger
from aijian_api.timeline import TimelineAssetV1, TimelineClipV1, TimelineVersionV1
from aijian_api.timeline_routes import TimelineAlreadyExistsError

_GRAPH = {"nodes": ["timeline.assemble.fake"]}
_DEFINITION_HASH = canonical_content_hash(_GRAPH)


class SourceRequiredError(RuntimeError):
    """The project has no imported source that can drive a preview."""


class FakeTimelineWorkflowNotReadyError(RuntimeError):
    """The targeted task exists but is not currently claimable."""


def _derived_hash(source_hash: str, index: int) -> str:
    digest = sha256(f"{source_hash}:fake-asset:{index}".encode()).hexdigest()
    return f"sha256:{digest}"


def _timeline(source: SourceDocument) -> TimelineVersionV1:
    timebase = SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(num=25, den=1),
        timecode_mode="NON_DROP_FRAME",
    )
    assets = tuple(
        TimelineAssetV1(
            asset_id=f"fake-asset-{index:02d}",
            source_asset_sha256=_derived_hash(source.raw_sha256, index),
            source_frame_count=100,
        )
        for index in range(1, 4)
    )
    clips = tuple(
        TimelineClipV1(
            clip_id=f"fake-shot-{index:02d}",
            asset_id=asset.asset_id,
            source_in_frame=0,
            duration_frames=50,
        )
        for index, asset in enumerate(assets, start=1)
    )
    return TimelineVersionV1(
        timeline_id=f"preview-{source.id.removeprefix('src_')[:12]}",
        revision=1,
        sequence_timebase=timebase,
        assets=assets,
        clips=clips,
    )


def _matches_source(record: ArtifactVersionRecord, source: SourceDocument) -> bool:
    timeline = TimelineVersionV1.model_validate(record.version.content)
    return timeline.assets[0].source_asset_sha256 == _derived_hash(source.raw_sha256, 1)


def start_fake_timeline_workflow(
    repository: StudioRepository,
    project_id: str,
) -> ArtifactVersionRecord:
    sources = repository.list_sources(project_id)
    if not sources:
        raise SourceRequiredError
    source = repository.get_source(project_id, sources[0].id)

    try:
        existing = repository.get_latest_artifact(project_id, "timeline")
    except ArtifactNotFoundError:
        existing = None
    if existing is not None:
        if _matches_source(existing, source):
            return existing
        raise TimelineAlreadyExistsError

    manifest = repository.get_latest_artifact(project_id, "source_manifest")
    request_fingerprint = canonical_content_hash(
        {
            "workflow": "phase0-fake-timeline-v1",
            "source_id": source.id,
            "source_hash": source.raw_sha256,
            "source_manifest_version_id": manifest.version.id,
        }
    )
    ledger = LocalTaskLedger(repository.database_path)
    queued = ledger.enqueue_local_node(
        project_id=project_id,
        definition_id="phase0-fake-timeline",
        definition_version=1,
        definition_hash=_DEFINITION_HASH,
        graph=_GRAPH,
        workflow_input_hash=manifest.version.content_hash,
        node_key="timeline.assemble.fake",
        node_type="timeline.assemble.fake",
        contract_version=1,
        input_bindings={
            "source_document_id": source.id,
            "source_manifest_version_id": manifest.version.id,
        },
        node_input_hash=manifest.version.content_hash,
        request_fingerprint=request_fingerprint,
        idempotency_key=f"phase0.fake-timeline:{manifest.version.id}",
        max_attempts=2,
        task_kind="local.timeline.assemble.fake",
        priority=80,
        available_at=datetime.now(UTC),
    )

    def create_output(claim: ClaimedTask) -> str:
        created = repository.create_artifact_version(
            project_id=project_id,
            artifact_type="timeline",
            schema_version="1.0.0",
            content=_timeline(source).model_dump(mode="python", exclude_computed_fields=True),
            author_actor_type="agent",
            author_actor_id="fake-timeline-workflow",
            change_summary="根据来源生成确定性 Fake 时间线",
            producer_attempt_id=claim.attempt_id,
        )
        return created.version.id

    executor = LocalExecutor(
        ledger,
        worker_id="fake-timeline-local-worker",
        lease_duration=timedelta(seconds=30),
        handler=create_output,
    )
    if not executor.run_once(task_id=queued.task_id):
        raise FakeTimelineWorkflowNotReadyError
    return repository.get_latest_artifact(project_id, "timeline")
