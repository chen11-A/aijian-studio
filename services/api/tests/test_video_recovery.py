"""Real SQLite/restart/OS-lock/local video evidence; transport is synthetic GET only."""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from aijian_api.generation_failure_store import GenerationFailureError, GenerationFailureStore
from aijian_api.repository import StudioRepository
from aijian_api.story_film import StoryFilmService, _ffmpeg
from aijian_api.video_recovery import VideoRecoveryService
from aijian_api.video_recovery_lock import VideoRecoveryBusy, VideoRecoveryLock
from aijian_api.video_recovery_store import VideoRecoveryStore
from aijian_api.xai_media import XaiHttpResponse, XaiMediaClient
from prepared_generation_test_schema import (
    PREPARED_TABLES,
    assert_prepared_tables_empty,
    remove_empty_prepared_tables,
)
from test_draft_export_runtime import toolchain
from test_story_film import _project

ACCOUNT = "a" * 64


@pytest.fixture
def media(tmp_path):
    path = tmp_path / "original.mp4"
    _ffmpeg(
        toolchain().ffmpeg_path,
        [
            "-f",
            "lavfi",
            "-i",
            "color=red:s=160x90:r=24:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
    )
    return path.read_bytes()


def setup(tmp_path):
    repo, project = _project(tmp_path)
    failures = GenerationFailureStore(repo)
    failures.configure(project, expected_revision=0, failure_limit=1)
    reservation = failures.reserve(project, input_sha256="b" * 64, attempt_key="original")
    VideoRecoveryStore(repo).attach(project, reservation, ACCOUNT, "provider-id")
    failures.settle(project, reservation, "UNKNOWN")
    return repo, project, reservation


class Transport:
    def __init__(self, media, status="done", hold=None):
        self.media, self.status, self.hold = media, status, hold
        self.calls = []

    def send(self, request):
        self.calls.append(request)
        assert request.method == "GET", "recovery must never submit or cancel"
        if request.url.endswith("/videos/provider-id"):
            if self.hold:
                self.hold[0].set()
                assert self.hold[1].wait(5)
            return XaiHttpResponse(
                200,
                json.dumps(
                    {"status": self.status, "video": {"url": "https://media.example/recovered.mp4"}}
                ).encode(),
            )
        assert request.url == "https://media.example/recovered.mp4"
        return XaiHttpResponse(200, self.media)


def service(repo):
    return VideoRecoveryService(repo, StoryFilmService(repo, toolchain))


def test_restart_recovers_only_get_and_releases_only_after_full_readable_video(tmp_path, media):
    repo, project, reservation = setup(tmp_path)
    restarted = StudioRepository(repo.database_path)
    transport = Transport(media)
    recovered = service(restarted).recover(
        project, ACCOUNT, reservation.attempt_id, XaiMediaClient(transport, token="synthetic")
    )
    assert recovered["kind"] == "RECOVERED"
    assert recovered["file"]["sha256"] == hashlib.sha256(media).hexdigest()
    assert service(restarted).bytes(project, ACCOUNT, reservation.attempt_id) == media
    assert [request.method for request in transport.calls] == ["GET", "GET"]
    assert GenerationFailureStore(restarted).reserve(
        project, input_sha256="b" * 64, attempt_key="explicit-new-attempt"
    )
    again = service(restarted).recover(
        project, ACCOUNT, reservation.attempt_id, XaiMediaClient(transport, token="refreshed")
    )
    assert again == recovered
    assert len(transport.calls) == 2
    assert service(restarted).list(project, ACCOUNT)["items"][0]["state"] == "RECOVERED"
    assert (tmp_path / "original.mp4").read_bytes() == media


@pytest.mark.parametrize(
    "status,data,reason",
    [
        ("processing", b"", "WAITING"),
        ("done", b"not-video", "NO_VALID_VIDEO"),
        ("failed", b"", "PROVIDER_FAILED"),
    ],
)
def test_unresolved_or_invalid_video_preserves_occupancy(tmp_path, status, data, reason):
    repo, project, reservation = setup(tmp_path)
    transport = Transport(data, status)
    result = service(repo).recover(
        project, ACCOUNT, reservation.attempt_id, XaiMediaClient(transport, token="synthetic")
    )
    assert result == {"kind": "UNKNOWN", "attemptId": reservation.attempt_id, "reason": reason}
    with pytest.raises(GenerationFailureError, match="INPUT_FAILURE_LIMIT"):
        GenerationFailureStore(repo).reserve(project, input_sha256="b" * 64, attempt_key="new")


def test_account_project_missing_id_and_actual_input_membership_reject_before_get(tmp_path):
    repo, project, reservation = setup(tmp_path)
    transport = Transport(b"")
    for wrong_project, account, identifier in [
        (project, "c" * 64, reservation.attempt_id),
        ("prj_" + "d" * 32, ACCOUNT, reservation.attempt_id),
        (project, ACCOUNT, "d" * 32),
    ]:
        with pytest.raises(GenerationFailureError, match="RECOVERY_NOT_FOUND"):
            service(repo).recover(
                wrong_project, account, identifier, XaiMediaClient(transport, token="synthetic")
            )
    assert transport.calls == []
    assert service(repo).list(project, "c" * 64)["items"] == []
    # A legacy/crashed pre-response attempt without an ID remains occupied, not invented.
    other = GenerationFailureStore(repo).reserve(
        project, input_sha256="e" * 64, attempt_key="no-id"
    )
    with pytest.raises(GenerationFailureError, match="RECOVERY_NOT_FOUND"):
        service(repo).recover(
            project, ACCOUNT, other.attempt_id, XaiMediaClient(transport, token="synthetic")
        )
    assert transport.calls == []


def test_active_original_poll_and_parallel_recovery_share_real_lock(tmp_path, media):
    repo, project, reservation = setup(tmp_path)
    held = VideoRecoveryLock(repo.database_path, reservation.attempt_id)
    try:
        assert service(repo).recover(
            project,
            ACCOUNT,
            reservation.attempt_id,
            XaiMediaClient(Transport(media), token="synthetic"),
        ) == {"kind": "FAILED", "code": "BUSY"}
        with pytest.raises(VideoRecoveryBusy):
            VideoRecoveryLock(repo.database_path, reservation.attempt_id)
    finally:
        held.close()
    entered, release = Event(), Event()
    transport = Transport(media, hold=(entered, release))
    with ThreadPoolExecutor() as executor:
        pending = executor.submit(
            service(repo).recover,
            project,
            ACCOUNT,
            reservation.attempt_id,
            XaiMediaClient(transport, token="synthetic"),
        )
        try:
            assert entered.wait(5)
            assert service(repo).recover(
                project,
                ACCOUNT,
                reservation.attempt_id,
                XaiMediaClient(transport, token="synthetic"),
            ) == {"kind": "FAILED", "code": "BUSY"}
        finally:
            release.set()
        assert pending.result()["kind"] == "RECOVERED"
    assert len(transport.calls) == 2


def test_original_producer_persists_accepted_id_and_later_recovery_never_resubmits(
    tmp_path, monkeypatch
):
    from aijian_api.xai_media import XaiHttpResponse
    from test_story_film import _IMAGE, _allow_live, _media_bytes, _request, _ScriptedTransport

    repo, project = _project(tmp_path)
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=1)
    _allow_live(monkeypatch, tmp_path / "status.log")
    clip, voice = _media_bytes(tmp_path)
    original = _ScriptedTransport(
        [
            XaiHttpResponse(200, json.dumps(_IMAGE).encode()),
            XaiHttpResponse(200, voice, "audio/wav"),
            XaiHttpResponse(200, b'{"request_id":"provider-id"}'),
            XaiHttpResponse(503, b"{}"),
        ]
    )
    GenerationFailureStore(repo, scope="story_creation").configure(
        project,
        expected_revision=0,
        failure_limit=1,
    )
    producer = StoryFilmService(repo, toolchain, transport=original)
    request = _request("grok_subscription")
    producer.produce(project, request, media_token="synthetic", dispatch_account=ACCOUNT)
    identifiers, _ = VideoRecoveryStore(repo).list_ids(project, ACCOUNT)
    assert len(identifiers) == 1
    row = VideoRecoveryStore(repo).read(project, ACCOUNT, identifiers[0])
    assert row.status == "UNKNOWN" and row.provider_request_id == "provider-id"
    assert (
        sum(r.method == "POST" and r.url.endswith("/videos/generations") for r in original.requests)
        == 1
    )
    restarted = StudioRepository(repo.database_path)
    transport = Transport(clip)
    recovered = service(restarted).recover(
        project, ACCOUNT, identifiers[0], XaiMediaClient(transport, token="refreshed")
    )
    assert recovered["kind"] == "RECOVERED"
    assert service(restarted).bytes(project, ACCOUNT, identifiers[0]) == clip
    assert [r.method for r in transport.calls] == ["GET", "GET"]
    no_transport = _ScriptedTransport([])
    # Original task/idempotency is retained; recovery is never an automatic re-run.
    StoryFilmService(restarted, toolchain, transport=no_transport).produce(
        project, request, media_token="synthetic", dispatch_account=ACCOUNT
    )
    assert no_transport.requests == []


def test_os_lock_is_released_by_real_process_exit_not_a_timeout(tmp_path):
    import os
    import subprocess
    import sys
    from pathlib import Path

    repo, _project_id, reservation = setup(tmp_path)
    code = (
        "import sys;from pathlib import Path;"
        "from aijian_api.video_recovery_lock import VideoRecoveryLock;"
        "lock=VideoRecoveryLock(Path(sys.argv[1]),sys.argv[2]);"
        "print('LOCKED',flush=True);sys.stdin.read(1)"
    )
    child_environment = os.environ.copy()
    # pytest pythonpath affects only this process; the real child must use this worktree too.
    source = str(Path(__file__).resolve().parents[1] / "src")
    inherited = child_environment.get("PYTHONPATH")
    child_environment["PYTHONPATH"] = os.pathsep.join([source, *([inherited] if inherited else [])])
    child = subprocess.Popen(
        [sys.executable, "-c", code, str(repo.database_path), reservation.attempt_id],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env=child_environment,
    )
    try:
        assert child.stdout.readline().strip() == "LOCKED"
        with pytest.raises(VideoRecoveryBusy):
            VideoRecoveryLock(repo.database_path, reservation.attempt_id)
    finally:
        child.communicate("x", timeout=5)
    assert child.returncode == 0
    recovered = VideoRecoveryLock(repo.database_path, reservation.attempt_id)
    recovered.close()


def test_original_input_binding_and_modified_recovered_bytes_are_not_reauthorized(tmp_path, media):
    repo, project, reservation = setup(tmp_path)
    transport = Transport(media)
    recovering = service(repo)
    assert (
        recovering.recover(
            project, ACCOUNT, reservation.attempt_id, XaiMediaClient(transport, token="synthetic")
        )["kind"]
        == "RECOVERED"
    )
    recovered_path = (
        tmp_path / "story-films" / "recovered-videos" / f"recovered-{reservation.attempt_id}.mp4"
    )
    recovered_path.write_bytes(b"changed bytes")
    with pytest.raises(GenerationFailureError, match="RECOVERY_OUTPUT_UNVERIFIABLE"):
        recovering.bytes(project, ACCOUNT, reservation.attempt_id)
    assert recovering.describe(project, ACCOUNT, reservation.attempt_id)["kind"] == "UNKNOWN"
    # The stored reservation and attachment must still name the identical actual video input.
    with repo._connection() as connection:
        connection.execute(
            "UPDATE generation_failure_attempt SET input_sha256=? WHERE id=?",
            ("f" * 64, reservation.attempt_id),
        )
        connection.commit()
    with pytest.raises(GenerationFailureError, match="RECOVERY_NOT_FOUND"):
        recovering.recover(
            project, ACCOUNT, reservation.attempt_id, XaiMediaClient(transport, token="synthetic")
        )
    assert len(transport.calls) == 2


def test_migration_52_preserves_existing_policy_attempt_rows_and_old_table_sql(tmp_path):
    import sqlite3

    from aijian_api.repository import SCHEMA_VERSION

    repo, project = _project(tmp_path)
    store = GenerationFailureStore(repo)
    store.configure(project, expected_revision=0, failure_limit=1)
    held = store.reserve(project, input_sha256="e" * 64, attempt_key="legacy-unknown")
    store.settle(project, held, "UNKNOWN")
    with sqlite3.connect(repo.database_path) as connection:
        # Reconstruct actual v51, without either later migration's tables.
        remove_empty_prepared_tables(connection)
        connection.execute("DROP TABLE generation_video_recovery")
        connection.execute("DROP TABLE story_creation_failure_attempt")
        connection.execute("DROP TABLE story_creation_failure_policy")
        connection.execute("PRAGMA user_version=51")
        old_sql = connection.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        old_attempts = connection.execute("SELECT * FROM generation_failure_attempt").fetchall()
        old_policies = connection.execute("SELECT * FROM generation_failure_policy").fetchall()
    restarted = StudioRepository(repo.database_path)
    with sqlite3.connect(restarted.database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 54
        assert_prepared_tables_empty(connection)
        assert [
            row
            for row in connection.execute(
                "SELECT name,sql FROM sqlite_master WHERE type='table' "
                "AND name NOT IN ('generation_video_recovery', 'story_creation_failure_policy', "
                "'story_creation_failure_attempt') ORDER BY name"
            ).fetchall()
            if row[0] not in PREPARED_TABLES
        ] == old_sql
        assert (
            connection.execute("SELECT * FROM generation_failure_attempt").fetchall()
            == old_attempts
        )
        assert (
            connection.execute("SELECT * FROM generation_failure_policy").fetchall() == old_policies
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM generation_video_recovery").fetchone()[0] == 0
        )
    with pytest.raises(GenerationFailureError, match="INPUT_FAILURE_LIMIT"):
        GenerationFailureStore(restarted).reserve(project, input_sha256="e" * 64, attempt_key="new")
