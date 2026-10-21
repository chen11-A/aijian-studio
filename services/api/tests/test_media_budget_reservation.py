"""Persistent budget holds and the pre-dispatch gate. No network and no provider."""

import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path

import pytest
from aijian_api.media_budget_policy import MAX_MICRO_UNITS, BudgetAssessment
from aijian_api.media_budget_store import (
    MediaBudgetConflict,
    MediaBudgetError,
    MediaBudgetNotFound,
    MediaBudgetStore,
    MediaDispatchRequest,
    _optional_text,
    _required_int,
    _text,
)
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from test_migrations import create_v1_database, migrate_through

NOW = datetime(2026, 10, 12, 8, 0, tzinfo=UTC)


class RecordingStub:
    def __init__(self) -> None:
        self.ids: list[str] = []

    def dispatch(self, reservation_id: str) -> None:
        self.ids.append(reservation_id)


class RefusingStub:
    def dispatch(self, reservation_id: str) -> None:
        raise RuntimeError("refusing paid call")


def workspace(tmp_path: Path):
    database = tmp_path / "workspace.sqlite3"
    repository = StudioRepository(database, clock=lambda: NOW)
    project = repository.create_project(
        name="预算作品",
        aspect_ratio="9:16",
        target_duration_seconds=60,
        source_language="zh-CN",
    )
    recorder = RecordingStub()
    store = MediaBudgetStore(repository, clock=lambda: NOW, paid_call=recorder)
    return database, repository, project, store, recorder


def request(
    project_id: str,
    *,
    key: str,
    amount: int | None,
    episode_id: str | None = None,
    currency: str = "USD",
) -> MediaDispatchRequest:
    return MediaDispatchRequest(project_id, key, currency, amount, episode_id)


def reservation_rows(database: Path) -> list[sqlite3.Row]:
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        return list(connection.execute("SELECT * FROM media_budget_reservations").fetchall())


def receipt_count(database: Path) -> int:
    with sqlite3.connect(database) as connection:
        return int(
            connection.execute("SELECT COUNT(*) FROM media_budget_dispatch_receipts").fetchone()[0]
        )


def test_episode_reservations_count_once_toward_the_project_total(tmp_path: Path) -> None:
    database, repository, project, store, recorder = workspace(tmp_path)
    episode_one = f"ep_{project.id}"
    episode_two = repository.create_episode(project.id, title="第二集").id
    store.save_budget(
        project_id=project.id,
        currency="USD",
        project_limit_micro=100,
        episode_limits={episode_one: 90, episode_two: 90},
    )

    first = store.dispatch(request(project.id, key="ep1", amount=40, episode_id=episode_one))
    second = store.dispatch(request(project.id, key="ep2", amount=40, episode_id=episode_two))
    blocked = store.dispatch(request(project.id, key="ep2-more", amount=30, episode_id=episode_two))

    assert first.outcome == second.outcome == "DISPATCHED"
    assert first.provider_called is second.provider_called is blocked.provider_called is False
    assert blocked.outcome == "BLOCKED"
    assert blocked.assessment is not None
    assert blocked.assessment.status == "PROJECT_LIMIT_EXCEEDED"
    assert blocked.reservation_id is None
    project_usage, first_usage = store.scope_usage(project.id, episode_one)
    _, second_usage = store.scope_usage(project.id, episode_two)
    assert project_usage is not None and first_usage is not None and second_usage is not None
    assert project_usage.reserved_micro == 80
    assert first_usage.reserved_micro == 40
    assert second_usage.reserved_micro == 40
    assert project_usage.reserved_micro == first_usage.reserved_micro + second_usage.reserved_micro
    assert len(reservation_rows(database)) == 2
    assert len(recorder.ids) == 2


def test_episode_spend_counts_without_a_sub_budget(tmp_path: Path) -> None:
    _database, _repository, project, store, _recorder = workspace(tmp_path)
    episode_id = f"ep_{project.id}"
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=50, episode_limits={}
    )

    decision = store.dispatch(request(project.id, key="scene", amount=30, episode_id=episode_id))
    blocked = store.dispatch(request(project.id, key="scene-2", amount=21, episode_id=episode_id))

    assert decision.outcome == "DISPATCHED"
    project_usage, episode_usage = store.scope_usage(project.id, episode_id)
    assert episode_usage is None
    assert project_usage is not None
    assert project_usage.reserved_micro == 30
    assert blocked.outcome == "BLOCKED"
    assert blocked.assessment is not None
    assert blocked.assessment.status == "PROJECT_LIMIT_EXCEEDED"


def test_episode_cap_blocks_while_the_project_still_has_room(tmp_path: Path) -> None:
    _database, _repository, project, store, recorder = workspace(tmp_path)
    episode_id = f"ep_{project.id}"
    store.save_budget(
        project_id=project.id,
        currency="USD",
        project_limit_micro=100,
        episode_limits={episode_id: 30},
    )

    blocked = store.dispatch(
        request(project.id, key="over-episode", amount=31, episode_id=episode_id)
    )
    assert blocked.outcome == "BLOCKED"
    assert blocked.assessment is not None
    assert blocked.assessment.status == "EPISODE_LIMIT_EXCEEDED"
    assert recorder.ids == []

    allowed = store.dispatch(
        request(project.id, key="fit-episode", amount=30, episode_id=episode_id)
    )
    assert allowed.outcome == "DISPATCHED"
    project_usage, episode_usage = store.scope_usage(project.id, episode_id)
    assert project_usage is not None and episode_usage is not None
    assert project_usage.reserved_micro == episode_usage.reserved_micro == 30


def test_over_budget_blocks_before_the_stub(tmp_path: Path) -> None:
    database, _repository, project, store, recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="CNY", project_limit_micro=10, episode_limits={}
    )

    blocked = store.dispatch(request(project.id, key="too-much", amount=11, currency="CNY"))
    exact = store.dispatch(request(project.id, key="exact", amount=10, currency="CNY"))
    one_more = store.dispatch(request(project.id, key="one-more", amount=1, currency="CNY"))

    assert blocked.outcome == "BLOCKED"
    assert blocked.assessment is not None
    assert blocked.assessment.status == "PROJECT_LIMIT_EXCEEDED"
    assert blocked.reservation_id is None
    assert exact.outcome == "DISPATCHED"
    assert exact.stub_invoked is True
    assert exact.provider_called is False
    assert one_more.outcome == "BLOCKED"
    assert [row["idempotency_key"] for row in reservation_rows(database)] == ["exact"]
    assert recorder.ids == [exact.reservation_id]
    assert receipt_count(database) == 1


def test_unknown_request_amount_is_not_reserved_as_zero(tmp_path: Path) -> None:
    database, _repository, project, store, recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )

    unknown = store.dispatch(request(project.id, key="missing-quote", amount=None))
    zero = store.dispatch(request(project.id, key="explicit-zero", amount=0))

    assert unknown.outcome == "BLOCKED"
    assert unknown.assessment is not None
    assert unknown.assessment.status == "UNKNOWN_AMOUNT"
    assert unknown.assessment.project_available_micro == 100
    assert reservation_rows(database)[0]["amount_micro"] == 0
    assert reservation_rows(database)[0]["idempotency_key"] == "explicit-zero"
    assert zero.outcome == "DISPATCHED"
    assert recorder.ids == [zero.reservation_id]


def test_unknown_historical_amount_blocks_even_a_zero_request(tmp_path: Path) -> None:
    database, _repository, project, store, recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )
    reservation_id = store.record_unreconciled_usage(
        project_id=project.id, idempotency_key="legacy", currency="USD"
    )
    again = store.record_unreconciled_usage(
        project_id=project.id, idempotency_key="legacy", currency="USD"
    )

    replay = store.dispatch(request(project.id, key="legacy", amount=None))
    with pytest.raises(MediaBudgetConflict, match="different reservation"):
        store.dispatch(request(project.id, key="legacy", amount=0))
    episode_id = f"ep_{project.id}"
    with pytest.raises(MediaBudgetConflict, match="different reservation"):
        store.record_unreconciled_usage(
            project_id=project.id, idempotency_key="legacy", currency="USD", episode_id=episode_id
        )
    blocked = store.dispatch(request(project.id, key="new", amount=0))
    project_usage, _episode_usage = store.scope_usage(project.id)

    assert again == reservation_id
    assert replay.outcome == "REPLAYED"
    assert replay.reservation_id == reservation_id
    assert blocked.outcome == "BLOCKED"
    assert blocked.assessment is not None
    assert blocked.assessment.status == "UNKNOWN_AMOUNT"
    assert blocked.assessment.project_available_micro is None
    assert project_usage is not None
    assert project_usage.spent_micro is None
    assert project_usage.reserved_micro is None
    assert recorder.ids == []
    stored = reservation_rows(database)
    assert [(row["amount_known"], row["amount_micro"], row["status"]) for row in stored] == [
        (0, None, "UNKNOWN")
    ]


def test_unknown_outcome_stays_reserved_across_reopen_and_cannot_be_zeroed(tmp_path: Path) -> None:
    database, _repository, project, store, _recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )
    decision = store.dispatch(request(project.id, key="held", amount=40))
    assert decision.reservation_id is not None
    store.mark_outcome_unknown(project_id=project.id, reservation_id=decision.reservation_id)
    store.mark_outcome_unknown(project_id=project.id, reservation_id=decision.reservation_id)
    with pytest.raises(MediaBudgetError, match="cannot be released as zero"):
        store.cancel(project_id=project.id, reservation_id=decision.reservation_id)

    reopened = MediaBudgetStore(StudioRepository(database), clock=lambda: NOW)
    blocked = reopened.dispatch(request(project.id, key="later", amount=61))
    usage, _episode = reopened.scope_usage(project.id)

    assert blocked.outcome == "BLOCKED"
    assert blocked.assessment is not None
    assert blocked.assessment.status == "PROJECT_LIMIT_EXCEEDED"
    assert usage is not None
    assert usage.reserved_micro == 40
    assert usage.spent_micro == 0
    assert reservation_rows(database)[0]["status"] == "UNKNOWN"


def test_concurrent_reservations_stop_at_the_project_limit(tmp_path: Path) -> None:
    database, repository, project, store, _recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )
    barrier = threading.Barrier(2)
    results: list[object] = []
    lock = threading.Lock()

    def attempt(key: str, amount: int) -> None:
        local = MediaBudgetStore(repository, clock=lambda: NOW, paid_call=RecordingStub())
        barrier.wait(timeout=10)
        try:
            decision = local.dispatch(request(project.id, key=key, amount=amount))
        except Exception as error:  # pragma: no cover - failure is asserted below
            decision = error
        with lock:
            results.append(decision)

    threads = [
        threading.Thread(target=attempt, args=("left", 60)),
        threading.Thread(target=attempt, args=("right", 60)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)

    assert not any(thread.is_alive() for thread in threads)
    assert sum(isinstance(item, Exception) for item in results) == 0
    dispatched = [item for item in results if getattr(item, "outcome", None) == "DISPATCHED"]
    blocked = [item for item in results if getattr(item, "outcome", None) == "BLOCKED"]
    assert len(dispatched) == 1
    assert len(blocked) == 1
    assert blocked[0].assessment.status == "PROJECT_LIMIT_EXCEEDED"  # type: ignore[attr-defined]
    usage, _episode = store.scope_usage(project.id)
    assert usage is not None
    assert usage.reserved_micro == 60
    assert len(reservation_rows(database)) == 1

    both: list[object] = []

    def attempt_fit(key: str) -> None:
        local = MediaBudgetStore(repository, clock=lambda: NOW, paid_call=RecordingStub())
        barrier_fit.wait(timeout=10)
        decision = local.dispatch(request(project.id, key=key, amount=20))
        with lock:
            both.append(decision)

    barrier_fit = threading.Barrier(2)
    fitting = [
        threading.Thread(target=attempt_fit, args=("fit-a",)),
        threading.Thread(target=attempt_fit, args=("fit-b",)),
    ]
    for thread in fitting:
        thread.start()
    for thread in fitting:
        thread.join(30)
    assert [item.outcome for item in both] == ["DISPATCHED", "DISPATCHED"]  # type: ignore[attr-defined]
    usage, _episode = store.scope_usage(project.id)
    assert usage is not None
    assert usage.reserved_micro == 100


def test_replay_does_not_reserve_or_stub_twice(tmp_path: Path) -> None:
    database, _repository, project, store, recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )
    first = store.dispatch(request(project.id, key="same", amount=15))
    second = store.dispatch(request(project.id, key="same", amount=15))

    with pytest.raises(MediaBudgetConflict, match="different reservation"):
        store.dispatch(request(project.id, key="same", amount=16))
    usage, _episode = store.scope_usage(project.id)
    assert first.outcome == "DISPATCHED"
    assert second.outcome == "REPLAYED"
    assert second.stub_invoked is False
    assert second.reservation_id == first.reservation_id
    assert recorder.ids == [first.reservation_id]
    assert usage is not None
    assert usage.reserved_micro == 15
    assert len(reservation_rows(database)) == 1
    with sqlite3.connect(database) as connection:
        billing = connection.execute(
            "SELECT billing_class, account_kind, attempt_id FROM dispatch_billing_records"
        ).fetchall()
    assert billing == [("metered", "paid_media", None)]


def test_raising_the_limit_does_not_replay_a_blocked_dispatch(tmp_path: Path) -> None:
    database, _repository, project, store, recorder = workspace(tmp_path)
    first_head = store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=10, episode_limits={}
    )
    blocked = store.dispatch(request(project.id, key="needs-room", amount=11))
    raised = store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )
    reopened = MediaBudgetStore(
        StudioRepository(database), clock=lambda: NOW, paid_call=RecordingStub()
    )

    assert blocked.outcome == "BLOCKED"
    assert first_head.revision == 1
    assert raised.revision == 2
    assert recorder.ids == []
    assert reservation_rows(database) == []
    assert reopened.read_head(project.id) == raised
    resumed = reopened.dispatch(request(project.id, key="needs-room", amount=11))
    assert resumed.outcome == "DISPATCHED"
    assert recorder.ids == []
    with sqlite3.connect(database) as connection:
        stored = connection.execute(
            "SELECT revision, project_limit_micro FROM media_budget_revisions ORDER BY revision"
        ).fetchall()
    assert stored == [(1, 10), (2, 100)]


def test_cancel_releases_a_known_hold_and_a_second_cancel_is_stable(tmp_path: Path) -> None:
    database, _repository, project, store, _recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )
    decision = store.dispatch(request(project.id, key="hold", amount=60))
    assert decision.reservation_id is not None
    store.cancel(project_id=project.id, reservation_id=decision.reservation_id)
    store.cancel(project_id=project.id, reservation_id=decision.reservation_id)
    replay = store.dispatch(request(project.id, key="hold", amount=60))
    replacement = store.dispatch(request(project.id, key="hold-2", amount=60))
    usage, _episode = store.scope_usage(project.id)

    assert replay.outcome == "REPLAYED"
    assert replacement.outcome == "DISPATCHED"
    assert usage is not None
    assert usage.reserved_micro == 60
    statuses = {row["idempotency_key"]: row["status"] for row in reservation_rows(database)}
    assert statuses == {"hold": "CANCELLED", "hold-2": "RESERVED"}


def test_settled_row_counts_as_spent_and_cannot_be_cancelled_away(tmp_path: Path) -> None:
    database, _repository, project, store, _recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )
    decision = store.dispatch(request(project.id, key="acked", amount=40))
    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE media_budget_reservations SET status = 'SETTLED' WHERE reservation_id = ?",
            (decision.reservation_id,),
        )
    with pytest.raises(MediaBudgetError, match="cannot be released"):
        store.cancel(project_id=project.id, reservation_id=decision.reservation_id or "")
    blocked = store.dispatch(request(project.id, key="more", amount=61))
    usage, _episode = store.scope_usage(project.id)

    assert blocked.outcome == "BLOCKED"
    assert usage is not None
    assert usage.spent_micro == 40
    assert usage.reserved_micro == 0


def test_stub_failure_rolls_back_the_reservation(tmp_path: Path) -> None:
    database, repository, project, _store, _recorder = workspace(tmp_path)
    store = MediaBudgetStore(repository, clock=lambda: NOW, paid_call=RefusingStub())
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )

    with pytest.raises(RuntimeError, match="refusing paid call"):
        store.dispatch(request(project.id, key="boom", amount=5))

    assert reservation_rows(database) == []
    assert receipt_count(database) == 0


def test_default_stub_records_a_local_receipt_without_a_paid_call(tmp_path: Path) -> None:
    database, repository, project, _store, _recorder = workspace(tmp_path)
    store = MediaBudgetStore(repository, clock=lambda: NOW)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=5, episode_limits={}
    )

    decision = store.dispatch(request(project.id, key="local", amount=5))

    assert decision.outcome == "DISPATCHED"
    assert decision.provider_called is False
    assert decision.stub_invoked is True
    with sqlite3.connect(database) as connection:
        receipt = connection.execute(
            "SELECT transport, provider_called FROM media_budget_dispatch_receipts"
        ).fetchone()
        remote = [
            connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "remote_execution_authorization_snapshots",
                "remote_dispatch_snapshots",
                "remote_settlement_receipts",
            )
        ]
    assert receipt == ("STUB_NO_PAID_CALL", 0)
    assert remote == [0, 0, 0]


def test_currency_mismatch_and_invalid_money_do_not_reserve(tmp_path: Path) -> None:
    database, _repository, project, store, recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=100, episode_limits={}
    )

    mismatch = store.dispatch(request(project.id, key="fx", amount=1, currency="CNY"))
    with pytest.raises(ValueError):
        store.dispatch(request(project.id, key="bool", amount=True))  # type: ignore[arg-type]
    with pytest.raises(MediaBudgetError, match="does not match"):
        store.record_unreconciled_usage(
            project_id=project.id, idempotency_key="fx-history", currency="CNY"
        )

    assert mismatch.outcome == "BLOCKED"
    assert mismatch.assessment is not None
    assert mismatch.assessment.status == "CURRENCY_MISMATCH"
    assert reservation_rows(database) == []
    assert recorder.ids == []


def test_unconfigured_budget_blocks_without_inventing_a_zero_limit(tmp_path: Path) -> None:
    database, _repository, project, store, recorder = workspace(tmp_path)

    with pytest.raises(MediaBudgetError, match="configured budget"):
        store.record_unreconciled_usage(
            project_id=project.id, idempotency_key="none", currency="USD"
        )
    decision = store.dispatch(request(project.id, key="early", amount=0))

    assert decision.outcome == "BLOCKED"
    assert decision.assessment is not None
    assert decision.assessment.status == "UNCONFIGURED"
    assert decision.display_reason == "请先设置作品预算"
    assert store.read_head(project.id) is None
    assert reservation_rows(database) == []
    assert recorder.ids == []


def test_missing_scope_and_bad_keys_fail_before_a_hold(tmp_path: Path) -> None:
    database, _repository, project, store, _recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=10, episode_limits={}
    )
    with pytest.raises(MediaBudgetNotFound, match="episode"):
        store.dispatch(request(project.id, key="missing", amount=1, episode_id="ep_missing"))
    with pytest.raises(MediaBudgetNotFound, match="project"):
        store.read_head("prj_missing")
    with pytest.raises(ValueError, match="idempotency"):
        store.dispatch(request(project.id, key="", amount=1))
    with pytest.raises(MediaBudgetNotFound, match="reservation"):
        store.cancel(project_id=project.id, reservation_id="mbr_" + "0" * 32)
    with pytest.raises(ValueError, match="control"):
        store.dispatch(request(project.id, key="bad\nkey", amount=1))
    with pytest.raises(ValueError, match="episode id"):
        store.save_budget(
            project_id=project.id, currency="USD", project_limit_micro=1, episode_limits={"": 1}
        )
    with pytest.raises(MediaBudgetNotFound, match="episode"):
        store.save_budget(
            project_id=project.id,
            currency="USD",
            project_limit_micro=1,
            episode_limits={"ep_missing": 1},
        )
    with pytest.raises(ValueError, match="project id"):
        store.read_head("")
    bare = MediaBudgetStore(store._repository, clock=lambda: NOW, ids=lambda _prefix: "not-an-id")
    with pytest.raises(ValueError, match="reservation id"):
        bare.dispatch(request(project.id, key="bad-id", amount=1))
    assert reservation_rows(database) == []


def test_foreign_currency_and_overwide_rows_are_not_converted_or_truncated(tmp_path: Path) -> None:
    database, _repository, project, store, recorder = workspace(tmp_path)
    store.save_budget(
        project_id=project.id,
        currency="USD",
        project_limit_micro=MAX_MICRO_UNITS,
        episode_limits={},
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            INSERT INTO media_budget_reservations (
                reservation_id, project_id, episode_id, budget_revision, idempotency_key,
                currency, amount_known, amount_micro, status, provider_called,
                created_at, updated_at
            ) VALUES (?, ?, NULL, 1, 'foreign', 'EUR', 1, 1, 'RESERVED', 0, ?, ?)
            """,
            ("mbr_" + "a" * 32, project.id, NOW.isoformat(), NOW.isoformat()),
        )
    blocked = store.dispatch(request(project.id, key="after-foreign", amount=0))
    usage, _episode = store.scope_usage(project.id)
    assert blocked.outcome == "BLOCKED"
    assert blocked.assessment is not None
    assert blocked.assessment.status == "UNKNOWN_AMOUNT"
    assert usage is not None
    assert usage.reserved_micro is None
    assert recorder.ids == []

    with sqlite3.connect(database) as connection:
        connection.execute("DELETE FROM media_budget_reservations")
        for suffix, key in (("b", "wide-a"), ("c", "wide-b")):
            connection.execute(
                """
                INSERT INTO media_budget_reservations (
                    reservation_id, project_id, episode_id, budget_revision, idempotency_key,
                    currency, amount_known, amount_micro, status, provider_called,
                    created_at, updated_at
                ) VALUES (?, ?, NULL, 1, ?, 'USD', 1, ?, 'RESERVED', 0, ?, ?)
                """,
                (
                    "mbr_" + suffix * 32,
                    project.id,
                    key,
                    MAX_MICRO_UNITS,
                    NOW.isoformat(),
                    NOW.isoformat(),
                ),
            )
    with pytest.raises(ValueError, match="safe integers"):
        store.dispatch(request(project.id, key="after-wide", amount=0))
    assert receipt_count(database) == 0


def test_revision_and_receipt_rows_cannot_be_rewritten(tmp_path: Path) -> None:
    database, _repository, project, store, _recorder = workspace(tmp_path)
    episode_id = f"ep_{project.id}"
    store.save_budget(
        project_id=project.id,
        currency="USD",
        project_limit_micro=10,
        episode_limits={episode_id: 10},
    )
    decision = store.dispatch(request(project.id, key="fixed", amount=1, episode_id=episode_id))
    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="revision is immutable"):
            connection.execute("UPDATE media_budget_revisions SET project_limit_micro = 1")
        with pytest.raises(sqlite3.IntegrityError, match="episode limit is immutable"):
            connection.execute("UPDATE media_budget_episode_limits SET limit_micro = 1")
        with pytest.raises(sqlite3.IntegrityError, match="receipt is immutable"):
            connection.execute(
                """
                UPDATE media_budget_dispatch_receipts
                SET provider_called = 0 WHERE reservation_id = ?
                """,
                (decision.reservation_id,),
            )
        with pytest.raises(sqlite3.IntegrityError, match="identity is immutable"):
            connection.execute(
                "UPDATE media_budget_reservations SET amount_micro = 2 WHERE reservation_id = ?",
                (decision.reservation_id,),
            )


def test_forced_within_limit_without_a_head_or_amount_does_not_reserve(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database, _repository, project, store, recorder = workspace(tmp_path)

    def allow(**_kwargs: object) -> BudgetAssessment:
        return BudgetAssessment("WITHIN_LIMIT", 1, None)

    monkeypatch.setattr("aijian_api.media_budget_store.evaluate_media_budget", allow)
    with pytest.raises(MediaBudgetError, match="without a budget head"):
        store.dispatch(request(project.id, key="no-head", amount=1))
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=10, episode_limits={}
    )
    with pytest.raises(MediaBudgetError, match="known amount"):
        store.dispatch(request(project.id, key="no-amount", amount=None))
    assert reservation_rows(database) == []
    assert recorder.ids == []


def test_migration_48_adds_the_budget_ledger_without_rewriting_projects(tmp_path: Path) -> None:
    database = tmp_path / "legacy.sqlite3"
    create_v1_database(database)
    migrate_through(database, 47)
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 47
        names = {str(row[0]) for row in connection.execute("SELECT name FROM sqlite_master")}
        project_name = connection.execute("SELECT name FROM projects").fetchone()[0]
        authorization_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'remote_dispatch_snapshots'"
        ).fetchone()[0]
        assert "media_budget_revisions" not in names
    StudioRepository(database)
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 49
        assert connection.execute("SELECT name FROM projects").fetchone()[0] == project_name
        assert connection.execute("SELECT COUNT(*) FROM media_budget_revisions").fetchone()[0] == 0
        assert (
            connection.execute("SELECT COUNT(*) FROM media_budget_reservations").fetchone()[0] == 0
        )
        assert (
            connection.execute(
                "SELECT sql FROM sqlite_master WHERE name = 'remote_dispatch_snapshots'"
            ).fetchone()[0]
            == authorization_sql
        )
        assert "requested_additional_budget_micros >= 0" in authorization_sql
        assert (
            "approved_currency TEXT NOT NULL CHECK (approved_currency = 'USD')" in authorization_sql
        )


def test_corrupt_fields_and_unusable_holds_fail_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database, _repository, project, store, _recorder = workspace(tmp_path)
    with pytest.raises(ValueError, match="episode id"):
        store.dispatch(request(project.id, key="blank-episode", amount=1, episode_id=""))
    store.save_budget(
        project_id=project.id, currency="USD", project_limit_micro=10, episode_limits={}
    )
    decision = store.dispatch(request(project.id, key="held", amount=1))
    assert decision.reservation_id is not None
    store.cancel(project_id=project.id, reservation_id=decision.reservation_id)
    with pytest.raises(MediaBudgetError, match="marked unknown"):
        store.mark_outcome_unknown(project_id=project.id, reservation_id=decision.reservation_id)

    class FakeRow:
        def __getitem__(self, key: str) -> int:
            return 1

    with pytest.raises(MediaBudgetError, match="invalid"):
        _text(FakeRow(), "currency")  # type: ignore[arg-type]
    with pytest.raises(MediaBudgetError, match="invalid"):
        _optional_text(FakeRow(), "episode_id")  # type: ignore[arg-type]
    with pytest.raises(MediaBudgetError, match="invalid"):
        _required_int(True)

    monkeypatch.setattr(MediaBudgetStore, "_head", lambda self, connection, project_id: None)
    with pytest.raises(MediaBudgetError, match="was not stored"):
        store.save_budget(
            project_id=project.id, currency="USD", project_limit_micro=20, episode_limits={}
        )
    monkeypatch.undo()
    assert store.read_head(project.id) is not None
    assert store.read_head(project.id).revision == 1  # type: ignore[union-attr]
    assert len(reservation_rows(database)) == 1


def test_store_source_does_not_reference_a_paid_client() -> None:
    module_path = Path(__file__).parents[1] / "src" / "aijian_api" / "media_budget_store.py"
    text = module_path.read_text(encoding="utf-8")
    for banned in ("import httpx", "import urllib", "import socket", "import requests", "sub2api"):
        assert banned not in text
