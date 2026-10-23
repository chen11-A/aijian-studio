"""用量 must not keep saying a previous process is still running locally."""

from datetime import UTC, datetime, timedelta

from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_queue_presentation import task_presentation
from aijian_api.task_queue_read import TaskQueueReader
from test_task_ledger import HASH_A, HASH_B, create_project


def _queue(ledger: LocalTaskLedger, project_id: str, node_key: str, when: datetime) -> str:
    queued = ledger.enqueue_local_node(
        project_id=project_id,
        definition_id=f"story-film-{node_key}",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": [node_key]},
        workflow_input_hash=HASH_A,
        node_key=node_key,
        node_type=node_key,
        contract_version=1,
        input_bindings={"source": "ver_source_1"},
        node_input_hash=HASH_A,
        request_fingerprint=HASH_B,
        idempotency_key=f"story-film:{node_key}:{HASH_A}",
        max_attempts=1,
        task_kind="local.story_film.v1",
        priority=50,
        available_at=when,
    )
    claimed = ledger.claim_ready_task(
        worker_id="story-film",
        lease_duration=timedelta(hours=3),
        task_id=queued.task_id,
        task_kind="local.story_film.v1",
    )
    assert claimed is not None
    return claimed.task_id


def test_usage_drops_local_work_left_running_before_this_session(tmp_path, monkeypatch):
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    started = datetime(2026, 10, 23, 5, 0, tzinfo=UTC)
    monkeypatch.setattr("aijian_api.task_queue_read._SESSION_STARTED", started)
    stale_id = _queue(
        LocalTaskLedger(database, clock=lambda: started - timedelta(hours=2)),
        project_id,
        "story_film_previous",
        started - timedelta(hours=2),
    )
    live_id = _queue(
        LocalTaskLedger(database, clock=lambda: started + timedelta(minutes=1)),
        project_id,
        "story_film_current",
        started + timedelta(minutes=1),
    )
    records = TaskQueueReader(database).list_project_tasks(project_id)
    labels = {record.task_id: task_presentation(record)[0] for record in records}
    stale = next(record for record in records if record.task_id == stale_id)
    assert labels[stale_id] == "上一次没有做完，已经结束"
    assert labels[stale_id] != "本地步骤失败，可安全重试"
    assert stale.error_code == "STALE_SESSION"
    assert stale.retry_disposition == "NON_RETRYABLE"
    assert stale.is_attention is False
    assert labels[live_id] == "正在本地执行"
    again = TaskQueueReader(database).list_project_tasks(project_id)
    assert len(again) == len(records)
    assert {record.task_id for record in again} == {record.task_id for record in records}


def test_usage_names_the_models_stored_on_the_story_film(tmp_path):
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    when = datetime(2026, 10, 23, 5, 0, tzinfo=UTC)
    LocalTaskLedger(database, clock=lambda: when).enqueue_local_node(
        project_id=project_id,
        definition_id="story-film-models",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["story_film"]},
        workflow_input_hash=HASH_A,
        node_key="story_film",
        node_type="story_film",
        contract_version=1,
        input_bindings={
            "image_model": "grok-imagine-image-2.0",
            "video_model": "grok-imagine-video-1.5",
            "speech_model": "grok-tts",
        },
        node_input_hash=HASH_A,
        request_fingerprint=HASH_B,
        idempotency_key="story-film:models",
        max_attempts=1,
        task_kind="local.story_film.v1",
        priority=50,
        available_at=when,
    )
    records = TaskQueueReader(database).list_project_tasks(project_id)
    assert len(records) == 1
    assert records[0].provider_model == "grok-imagine-image-2.0、grok-imagine-video-1.5、grok-tts"
