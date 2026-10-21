"""Billing class gate for text dispatch and the monetary budget ledger."""

import inspect
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.dispatch_billing import (
    DispatchBillingBlocked,
    NoSourceSubscriptionAccess,
    SubscriptionAccessSnapshot,
    classify_dispatch_billing,
    insert_dispatch_billing_record,
    require_prefixed_id,
)
from aijian_api.media_budget_store import (
    MediaBudgetConflict,
    MediaBudgetNotFound,
    MediaBudgetStore,
    MediaDispatchRequest,
)
from aijian_api.remote_execution_authorization import RemoteDispatchSnapshotDraft
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_ledger_models import timestamp
from test_migrations import create_v1_database, migrate_through

NOW = datetime(2026, 10, 21, 8, 0, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"
CONNECTION_ID = "pcn_" + "1" * 32
CONTEXT_ID = "ctx_" + "2" * 32
AGENT_RUN_ID = "agr_" + "3" * 32
SKILL_RUN_ID = "skr_" + "4" * 32


class ScriptedProbe:
    def __init__(self, snapshot: SubscriptionAccessSnapshot) -> None:
        self.snapshot = snapshot
        self.calls: list[tuple[str, str | None, str | None]] = []

    def probe(
        self,
        connection: sqlite3.Connection,
        *,
        connection_id: str,
        provider_kind: str | None,
        account_kind: str | None,
    ) -> SubscriptionAccessSnapshot:
        _ = connection
        self.calls.append((connection_id, provider_kind, account_kind))
        return self.snapshot


class ExplodingProbe:
    def probe(
        self,
        connection: sqlite3.Connection,
        *,
        connection_id: str,
        provider_kind: str | None,
        account_kind: str | None,
    ) -> SubscriptionAccessSnapshot:
        raise AssertionError("metered dispatch must not probe a subscription account")


Expected = tuple[str, str | None, str]
Case = tuple[str | None, str | None, str | None, Expected]


def classify_cases() -> list[Case]:
    return [
        (None, "gpt_login", "CPA_LOOPBACK_V1", ("subscription", "gpt_login", "account_kind")),
        (None, "chatgpt_login", None, ("subscription", "gpt_login", "account_kind")),
        (None, "grok_login", None, ("subscription", "grok_login", "account_kind")),
        (None, "api_key", "CPA_LOOPBACK_V1", ("metered", "api_key", "account_kind")),
        (None, "paid_media", None, ("metered", "paid_media", "account_kind")),
        (None, None, "CPA_LOOPBACK_V1", ("subscription", "gpt_login", "transport_mapping")),
        ("", "", "CPA_LOOPBACK_V1", ("subscription", "gpt_login", "transport_mapping")),
        (None, None, "OTHER", ("metered", None, "unknown_as_metered")),
        (
            None,
            "prepaid_card",
            "CPA_LOOPBACK_V1",
            ("metered", "prepaid_card", "unknown_as_metered"),
        ),
        ("free", "gpt_login", "CPA_LOOPBACK_V1", ("metered", "gpt_login", "unknown_as_metered")),
        ("subscription", "api_key", None, ("metered", "api_key", "conflict_as_metered")),
        ("metered", "grok_login", None, ("metered", "grok_login", "conflict_as_metered")),
        ("subscription", None, "CPA_LOOPBACK_V1", ("subscription", None, "explicit")),
        ("metered", None, "CPA_LOOPBACK_V1", ("metered", None, "explicit")),
    ]


@pytest.mark.parametrize(
    ("explicit_class", "account_kind", "endpoint", "expected"), classify_cases()
)
def test_classification_keeps_unknown_and_conflicts_on_the_metered_side(
    explicit_class: str | None,
    account_kind: str | None,
    endpoint: str | None,
    expected: tuple[str, str | None, str],
) -> None:
    classified = classify_dispatch_billing(
        explicit_class=explicit_class, account_kind=account_kind, endpoint_binding=endpoint
    )
    assert (
        classified.billing_class,
        classified.account_kind,
        classified.classification_source,
    ) == expected


def test_overlong_billing_tokens_are_rejected() -> None:
    with pytest.raises(ValueError, match="billing account kind"):
        classify_dispatch_billing(
            explicit_class=None, account_kind="k" * 65, endpoint_binding="CPA_LOOPBACK_V1"
        )
    with pytest.raises(ValueError, match="billing class"):
        classify_dispatch_billing(explicit_class="c" * 65, account_kind=None, endpoint_binding=None)


def test_default_probe_reports_unknown_health_without_reading_the_database(tmp_path: Path) -> None:
    database = tmp_path / "probe.sqlite3"
    StudioRepository(database)
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        snapshot = NoSourceSubscriptionAccess().probe(
            connection, connection_id=CONNECTION_ID, provider_kind="CPA_LOOPBACK", account_kind=None
        )
    assert snapshot == SubscriptionAccessSnapshot(None, None, None)


def _project(tmp_path: Path) -> tuple[Path, StudioRepository, str]:
    database = tmp_path / "workspace.sqlite3"
    repository = StudioRepository(database, clock=lambda: NOW)
    project = repository.create_project(
        name="计费作品",
        aspect_ratio="9:16",
        target_duration_seconds=60,
        source_language="zh-CN",
    )
    return database, repository, project.id


def _seed_text_connection(database: Path, project_id: str) -> None:
    context = {
        "project_id": project_id,
        "agent_definition": {"definition_id": "remote.agent", "version": "1.0.0"},
        "skill_definition": {"definition_id": "remote.extract", "version": "1.0.0"},
        "entries": [],
        "total_byte_count": 0,
    }
    now_text = timestamp(NOW)
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            INSERT INTO provider_connections (
                connection_id, provider_kind, display_name, base_url, enabled,
                models_json, revision, created_at, updated_at, credential_ref
            ) VALUES (
                ?, 'CPA_LOOPBACK', 'GPT login', 'http://127.0.0.1:8317', 1,
                ?, 1, ?, ?, ?
            )
            """,
            (
                CONNECTION_ID,
                '[{"model_id":"remote-model","capabilities":["TEXT"]}]',
                now_text,
                now_text,
                CONNECTION_ID,
            ),
        )
        connection.execute(
            "INSERT INTO agent_runs VALUES (?, ?, ?, ?, 'PENDING', ?, 1, ?, ?)",
            (
                AGENT_RUN_ID,
                project_id,
                "remote.agent",
                "1.0.0",
                json.dumps([SKILL_RUN_ID]),
                now_text,
                now_text,
            ),
        )
        connection.execute(
            "INSERT INTO agent_context_manifests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                CONTEXT_ID,
                project_id,
                "remote.agent",
                "1.0.0",
                "remote.extract",
                "1.0.0",
                json.dumps(context, separators=(",", ":")),
                HASH_B,
                now_text,
            ),
        )
        connection.execute(
            "INSERT INTO skill_runs VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, 1, ?, ?)",
            (
                SKILL_RUN_ID,
                project_id,
                AGENT_RUN_ID,
                "remote.extract",
                "1.0.0",
                CONTEXT_ID,
                now_text,
                now_text,
            ),
        )


def _snapshot(project_id: str, idempotency_key: str) -> dict[str, object]:
    payload: dict[str, object] = {
        "schema_version": "1.0.0",
        "project_id": project_id,
        "agent_run_id": AGENT_RUN_ID,
        "skill_run_id": SKILL_RUN_ID,
        "output_artifact_type": "Screenplay",
        "agent_definition_id": "remote.agent",
        "agent_version": "1.0.0",
        "skill_definition_id": "remote.extract",
        "skill_version": "1.0.0",
        "prompt_version": "remote@1.0.0",
        "policy_version": "remote-policy@1.0.0",
        "provider_connection_id": CONNECTION_ID,
        "model_id": "remote-model",
        "capability_snapshot_hash": HASH_A,
        "input_hash": HASH_A,
        "output_schema_version": "1.0.0",
        "idempotency_key": idempotency_key,
    }
    payload["attempt_fingerprint"] = canonical_sha256(
        {key: value for key, value in payload.items() if key != "schema_version"}
    )
    return payload


def _draft() -> RemoteDispatchSnapshotDraft:
    return RemoteDispatchSnapshotDraft(
        connection_id=CONNECTION_ID,
        connection_revision=1,
        approved_model_id="remote-model",
        endpoint_binding="CPA_LOOPBACK_V1",
        transport_contract_hash=HASH_B,
        dispatch_class="SYNTHETIC_CAPABILITY_PROBE",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        policy_version="remote-policy@1.0.0",
        context_manifest_id=CONTEXT_ID,
        context_manifest_hash=HASH_B,
        scope={"synthetic_bytes_hash": HASH_A, "probe_scope": "billing"},
    )


def _enqueue(
    database: Path,
    project_id: str,
    key: str,
    **billing: object,
):
    snapshot = _snapshot(project_id, key)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    return ledger.enqueue_remote_node(
        dispatch_snapshot=_draft(),
        project_id=project_id,
        definition_id="remote-extract",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["remote.extract"]},
        workflow_input_hash=HASH_A,
        node_key="source.extract",
        node_type="agent.skill.remote",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH_A,
        request_fingerprint=str(snapshot["attempt_fingerprint"]),
        idempotency_key=key,
        max_attempts=1,
        task_kind="remote.source.extract",
        priority=50,
        available_at=NOW,
        attempt_snapshot_kind="agent_skill_v1",
        attempt_snapshot=snapshot,
        billing_account_kind=billing.get("billing_account_kind"),  # type: ignore[arg-type]
        billing_class=billing.get("billing_class"),  # type: ignore[arg-type]
        metered_currency=billing.get("metered_currency"),  # type: ignore[arg-type]
        metered_amount_micro=billing.get("metered_amount_micro"),  # type: ignore[arg-type]
        episode_id=billing.get("episode_id"),  # type: ignore[arg-type]
        subscription_access=billing.get("subscription_access"),  # type: ignore[arg-type]
    )


def _billing_rows(database: Path) -> list[sqlite3.Row]:
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        return list(connection.execute("SELECT * FROM dispatch_billing_records").fetchall())


def _counts(database: Path) -> tuple[int, int, int]:
    with sqlite3.connect(database) as connection:
        tasks = connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone()[0]
        holds = connection.execute("SELECT COUNT(*) FROM media_budget_reservations").fetchone()[0]
        snaps = connection.execute("SELECT COUNT(*) FROM remote_dispatch_snapshots").fetchone()[0]
    return int(tasks), int(holds), int(snaps)


def test_subscription_text_extract_skips_the_money_gate_and_keeps_zero_budget(
    tmp_path: Path,
) -> None:
    database, _repository, project_id = _project(tmp_path)
    _seed_text_connection(database, project_id)
    queued = _enqueue(database, project_id, "sub-text")
    replay = _enqueue(database, project_id, "sub-text")

    assert queued.created is True
    assert replay.created is False
    assert replay.attempt_id == queued.attempt_id
    rows = _billing_rows(database)
    assert len(rows) == 1
    assert rows[0]["billing_class"] == "subscription"
    assert rows[0]["account_kind"] == "gpt_login"
    assert rows[0]["classification_source"] == "transport_mapping"
    assert rows[0]["attempt_id"] == queued.attempt_id
    assert rows[0]["reservation_id"] is None
    with sqlite3.connect(database) as connection:
        contract = connection.execute(
            """
            SELECT requested_additional_budget_micros, approved_currency
            FROM remote_dispatch_snapshots
            """
        ).fetchone()
    assert contract == (0, "USD")
    assert _counts(database)[1] == 0


def test_named_grok_and_chatgpt_logins_are_subscription_without_a_project_budget(
    tmp_path: Path,
) -> None:
    database, _repository, project_id = _project(tmp_path)
    _seed_text_connection(database, project_id)
    grok = _enqueue(database, project_id, "grok-text", billing_account_kind="grok_login")
    chat = _enqueue(database, project_id, "chat-text", billing_account_kind="chatgpt_login")
    kinds = {
        (row["attempt_id"], row["account_kind"], row["billing_class"])
        for row in _billing_rows(database)
    }
    assert kinds == {
        (grok.attempt_id, "grok_login", "subscription"),
        (chat.attempt_id, "gpt_login", "subscription"),
    }
    assert _counts(database)[1] == 0


def test_replay_with_a_different_billing_class_does_not_rewrite_the_record(tmp_path: Path) -> None:
    database, _repository, project_id = _project(tmp_path)
    _seed_text_connection(database, project_id)
    _enqueue(database, project_id, "same-text")
    with pytest.raises(ValueError, match="different billing class"):
        _enqueue(
            database,
            project_id,
            "same-text",
            billing_account_kind="api_key",
            metered_currency="USD",
            metered_amount_micro=1,
        )
    rows = _billing_rows(database)
    assert len(rows) == 1
    assert rows[0]["billing_class"] == "subscription"
    assert _counts(database) == (1, 0, 1)


def test_legacy_replay_records_the_class_once(tmp_path: Path) -> None:
    database, _repository, project_id = _project(tmp_path)
    _seed_text_connection(database, project_id)
    queued = _enqueue(database, project_id, "legacy-text")
    with sqlite3.connect(database) as connection:
        connection.execute("DELETE FROM dispatch_billing_records")
    replay = _enqueue(database, project_id, "legacy-text")
    rows = _billing_rows(database)
    assert replay.created is False
    assert len(rows) == 1
    assert rows[0]["attempt_id"] == queued.attempt_id
    assert rows[0]["billing_class"] == "subscription"


def test_metered_text_without_a_budget_is_blocked_before_enqueue(tmp_path: Path) -> None:
    database, _repository, project_id = _project(tmp_path)
    with pytest.raises(DispatchBillingBlocked, match="请先设置作品预算") as blocked:
        _enqueue(
            database,
            project_id,
            "api-text",
            billing_account_kind="api_key",
            metered_currency="USD",
            metered_amount_micro=1,
        )
    assert blocked.value.status == "UNCONFIGURED"
    assert blocked.value.billing_class == "metered"
    assert blocked.value.display_reason == "请先设置作品预算"
    assert _counts(database) == (0, 0, 0)
    assert _billing_rows(database) == []


def test_unknown_billing_kind_is_metered_and_does_not_become_a_subscription(
    tmp_path: Path,
) -> None:
    database, _repository, project_id = _project(tmp_path)
    with pytest.raises(DispatchBillingBlocked, match="请先设置作品预算") as blocked:
        _enqueue(database, project_id, "unknown-text", billing_account_kind="prepaid_card")
    assert blocked.value.billing_class == "metered"
    assert blocked.value.status == "UNCONFIGURED"
    assert _counts(database) == (0, 0, 0)


def test_metered_text_blocks_unknown_amounts_and_over_budget_spends(tmp_path: Path) -> None:
    database, repository, project_id = _project(tmp_path)
    MediaBudgetStore(repository, clock=lambda: NOW).save_budget(
        project_id=project_id, currency="USD", project_limit_micro=10, episode_limits={}
    )
    with pytest.raises(DispatchBillingBlocked, match="调用金额未知") as unknown:
        _enqueue(
            database,
            project_id,
            "unknown-amount",
            billing_account_kind="api_key",
            metered_currency="USD",
        )
    with pytest.raises(DispatchBillingBlocked, match="超出作品预算") as over:
        _enqueue(
            database,
            project_id,
            "over-budget",
            billing_account_kind="api_key",
            metered_currency="USD",
            metered_amount_micro=11,
        )
    assert unknown.value.status == "UNKNOWN_AMOUNT"
    assert over.value.status == "PROJECT_LIMIT_EXCEEDED"
    assert _counts(database) == (0, 0, 0)


def test_metered_text_reserves_inside_the_enqueue_and_leaves_the_contract_zero_budget(
    tmp_path: Path,
) -> None:
    database, repository, project_id = _project(tmp_path)
    _seed_text_connection(database, project_id)
    MediaBudgetStore(repository, clock=lambda: NOW).save_budget(
        project_id=project_id, currency="USD", project_limit_micro=100, episode_limits={}
    )
    probe = ExplodingProbe()
    queued = _enqueue(
        database,
        project_id,
        "priced-text",
        billing_account_kind="api_key",
        metered_currency="USD",
        metered_amount_micro=40,
        subscription_access=probe,
    )
    replay = _enqueue(
        database,
        project_id,
        "priced-text",
        billing_account_kind="api_key",
        metered_currency="USD",
        metered_amount_micro=40,
        subscription_access=probe,
    )

    assert replay.created is False
    assert replay.attempt_id == queued.attempt_id
    rows = _billing_rows(database)
    assert len(rows) == 1
    assert rows[0]["billing_class"] == "metered"
    assert rows[0]["account_kind"] == "api_key"
    assert rows[0]["attempt_id"] == queued.attempt_id
    assert rows[0]["reservation_id"] is not None
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        hold = connection.execute(
            "SELECT amount_micro, status, provider_called FROM media_budget_reservations"
        ).fetchone()
        contract = connection.execute(
            """
            SELECT requested_additional_budget_micros, approved_currency
            FROM remote_dispatch_snapshots
            """
        ).fetchone()
    assert tuple(hold) == (40, "RESERVED", 0)
    assert tuple(contract) == (0, "USD")
    usage, _episode = MediaBudgetStore(repository).scope_usage(project_id)
    assert usage is not None and usage.reserved_micro == 40


def test_explicit_zero_is_a_known_amount_and_episode_cap_still_blocks(tmp_path: Path) -> None:
    database, repository, project_id = _project(tmp_path)
    _seed_text_connection(database, project_id)
    episode_id = f"ep_{project_id}"
    MediaBudgetStore(repository, clock=lambda: NOW).save_budget(
        project_id=project_id,
        currency="USD",
        project_limit_micro=100,
        episode_limits={episode_id: 5},
    )
    allowed = _enqueue(
        database,
        project_id,
        "zero-text",
        billing_class="metered",
        metered_currency="USD",
        metered_amount_micro=0,
        episode_id=episode_id,
    )
    with pytest.raises(DispatchBillingBlocked, match="超出分集预算") as blocked:
        _enqueue(
            database,
            project_id,
            "episode-text",
            billing_account_kind="paid_media",
            metered_currency="USD",
            metered_amount_micro=6,
            episode_id=episode_id,
        )
    assert allowed.created is True
    assert blocked.value.status == "EPISODE_LIMIT_EXCEEDED"
    assert _counts(database) == (1, 1, 1)


def test_subscription_probe_blocks_only_a_negative_health_signal(tmp_path: Path) -> None:
    database, _repository, project_id = _project(tmp_path)
    _seed_text_connection(database, project_id)
    disconnected = ScriptedProbe(SubscriptionAccessSnapshot(False, None, None))
    with pytest.raises(DispatchBillingBlocked, match="订阅账号未连接") as offline:
        _enqueue(database, project_id, "offline", subscription_access=disconnected)
    quota = ScriptedProbe(SubscriptionAccessSnapshot(True, False, True))
    with pytest.raises(DispatchBillingBlocked, match="订阅额度不可用") as no_quota:
        _enqueue(database, project_id, "no-quota", subscription_access=quota)
    rate = ScriptedProbe(SubscriptionAccessSnapshot(None, None, False))
    with pytest.raises(DispatchBillingBlocked, match="订阅调用频率不可用") as no_rate:
        _enqueue(database, project_id, "no-rate", subscription_access=rate)
    unknown = ScriptedProbe(SubscriptionAccessSnapshot(None, None, None))
    queued = _enqueue(database, project_id, "unknown-health", subscription_access=unknown)

    assert offline.value.status == "DISCONNECTED"
    assert no_quota.value.status == "QUOTA_UNAVAILABLE"
    assert no_rate.value.status == "RATE_UNAVAILABLE"
    assert unknown.calls == [(CONNECTION_ID, "CPA_LOOPBACK", "gpt_login")]
    assert queued.created is True
    assert _counts(database) == (1, 0, 1)


def test_local_replay_does_not_record_a_billing_class(tmp_path: Path) -> None:
    database, _repository, project_id = _project(tmp_path)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    kwargs = dict(
        project_id=project_id,
        definition_id="local",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["local"]},
        workflow_input_hash=HASH_A,
        node_key="local.extract",
        node_type="local.extract",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH_A,
        request_fingerprint=HASH_B,
        idempotency_key="local-text",
        max_attempts=1,
        task_kind="local.agent-skill.fake",
        priority=50,
        available_at=NOW,
    )
    first = ledger.enqueue_local_node(**kwargs)
    second = ledger.enqueue_local_node(**kwargs)
    assert first.created is True
    assert second.created is False
    assert _billing_rows(database) == []


def test_billing_records_are_immutable_and_migration_49_is_additive(tmp_path: Path) -> None:
    database, repository, project_id = _project(tmp_path)
    _seed_text_connection(database, project_id)
    _enqueue(database, project_id, "frozen")
    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="billing record is immutable"):
            connection.execute("UPDATE dispatch_billing_records SET billing_class = 'metered'")

    legacy = tmp_path / "legacy.sqlite3"
    create_v1_database(legacy)
    migrate_through(legacy, 48)
    with sqlite3.connect(legacy) as connection:
        before = connection.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'remote_dispatch_snapshots'"
        ).fetchone()[0]
        names = {str(row[0]) for row in connection.execute("SELECT name FROM sqlite_master")}
        assert "dispatch_billing_records" not in names
        assert "media_budget_reservations" in names
    StudioRepository(legacy)
    with sqlite3.connect(legacy) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 49
        after = connection.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'remote_dispatch_snapshots'"
        ).fetchone()[0]
        assert after == before
        assert "requested_additional_budget_micros >= 0" in after
        assert "approved_currency TEXT NOT NULL CHECK (approved_currency = 'USD')" in after
        assert (
            connection.execute("SELECT COUNT(*) FROM dispatch_billing_records").fetchone()[0] == 0
        )
    assert repository.database_path == database


def test_a_metered_key_already_held_by_the_media_ledger_does_not_enqueue(
    tmp_path: Path,
) -> None:
    database, repository, project_id = _project(tmp_path)
    store = MediaBudgetStore(repository, clock=lambda: NOW)
    store.save_budget(
        project_id=project_id, currency="USD", project_limit_micro=20, episode_limits={}
    )
    held = store.dispatch(MediaDispatchRequest(project_id, "shared-key", "USD", 5))
    with pytest.raises(MediaBudgetConflict, match="already bound"):
        _enqueue(
            database,
            project_id,
            "shared-key",
            billing_account_kind="api_key",
            metered_currency="USD",
            metered_amount_micro=5,
        )
    assert held.reservation_id is not None
    assert _counts(database)[0] == 0
    assert [row["account_kind"] for row in _billing_rows(database)] == ["paid_media"]


def test_legacy_metered_replay_links_the_existing_reservation(tmp_path: Path) -> None:
    database, repository, project_id = _project(tmp_path)
    _seed_text_connection(database, project_id)
    MediaBudgetStore(repository, clock=lambda: NOW).save_budget(
        project_id=project_id, currency="USD", project_limit_micro=50, episode_limits={}
    )
    queued = _enqueue(
        database,
        project_id,
        "legacy-priced",
        billing_account_kind="api_key",
        metered_currency="USD",
        metered_amount_micro=7,
    )
    with sqlite3.connect(database) as connection:
        reservation_id = connection.execute(
            "SELECT reservation_id FROM media_budget_reservations"
        ).fetchone()[0]
        connection.execute("DELETE FROM dispatch_billing_records")
    replay = _enqueue(
        database,
        project_id,
        "legacy-priced",
        billing_account_kind="api_key",
        metered_currency="USD",
        metered_amount_micro=7,
    )
    rows = _billing_rows(database)
    assert replay.created is False
    assert replay.attempt_id == queued.attempt_id
    assert len(rows) == 1
    assert rows[0]["reservation_id"] == reservation_id
    assert rows[0]["billing_class"] == "metered"


def test_subscription_probe_must_return_a_snapshot_and_unknown_episode_fails(
    tmp_path: Path,
) -> None:
    database, repository, project_id = _project(tmp_path)

    class BadProbe:
        def probe(
            self,
            connection: sqlite3.Connection,
            *,
            connection_id: str,
            provider_kind: str | None,
            account_kind: str | None,
        ) -> object:
            assert provider_kind is None
            _ = (connection, connection_id, account_kind)
            return object()

    with pytest.raises(ValueError, match="invalid snapshot"):
        _enqueue(database, project_id, "bad-probe", subscription_access=BadProbe())
    MediaBudgetStore(repository, clock=lambda: NOW).save_budget(
        project_id=project_id, currency="USD", project_limit_micro=10, episode_limits={}
    )
    with pytest.raises(MediaBudgetNotFound, match="episode"):
        _enqueue(
            database,
            project_id,
            "missing-episode",
            billing_account_kind="api_key",
            metered_currency="USD",
            episode_id="ep_missing",
        )
    assert _counts(database) == (0, 0, 0)


def test_paid_media_billing_cannot_be_relabeled_and_record_ids_are_checked(
    tmp_path: Path,
) -> None:
    database, repository, project_id = _project(tmp_path)
    store = MediaBudgetStore(repository, clock=lambda: NOW)
    store.save_budget(
        project_id=project_id, currency="USD", project_limit_micro=10, episode_limits={}
    )
    decision = store.dispatch(MediaDispatchRequest(project_id, "held", "USD", 1))
    with sqlite3.connect(database) as connection:
        connection.execute("DELETE FROM dispatch_billing_records")
        connection.execute(
            """
            INSERT INTO dispatch_billing_records (
                record_id, project_id, billing_class, account_kind, classification_source,
                attempt_id, reservation_id, created_at
            ) VALUES (?, ?, 'subscription', 'gpt_login', 'account_kind', NULL, ?, ?)
            """,
            ("dbr_" + "ab" * 16, project_id, decision.reservation_id, timestamp(NOW)),
        )
    with pytest.raises(ValueError, match="different billing"):
        store.dispatch(MediaDispatchRequest(project_id, "held", "USD", 1))
    with sqlite3.connect(database) as connection:
        with pytest.raises(ValueError, match="attempt or a reservation"):
            insert_dispatch_billing_record(
                connection,
                record_id="dbr_" + "cd" * 16,
                project_id=project_id,
                billing_class="metered",
                account_kind=None,
                classification_source="explicit",
                attempt_id=None,
                reservation_id=None,
                created_at=timestamp(NOW),
            )
        with pytest.raises(ValueError, match="account kind"):
            insert_dispatch_billing_record(
                connection,
                record_id="dbr_" + "cd" * 16,
                project_id=project_id,
                billing_class="metered",
                account_kind="k" * 65,
                classification_source="unknown_as_metered",
                attempt_id=None,
                reservation_id=decision.reservation_id,
                created_at=timestamp(NOW),
            )
    with pytest.raises(ValueError, match="dbr id"):
        require_prefixed_id("not-an-id", "dbr")


def test_dispatch_billing_source_does_not_open_a_paid_client() -> None:
    source = Path(inspect.getfile(classify_dispatch_billing)).read_text(encoding="utf-8")
    for banned in ("import httpx", "import urllib", "import socket", "import requests", "sub2api"):
        assert banned not in source
