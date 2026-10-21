"""Desktop subscription dispatches record billing and never store a token."""

import sqlite3
from pathlib import Path

import pytest
from aijian_api.desktop_subscription_dispatch import (
    DesktopSubscriptionRequest,
    finish_desktop_subscription_dispatch,
    record_desktop_subscription_dispatch,
)
from aijian_api.dispatch_billing import DispatchBillingBlocked
from aijian_api.main import create_app
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient

TOKEN = "r" * 43
HOST = "127.0.0.1:43127"
ORIGIN = "app://aijian"
SHA = "sha256:" + "ab" * 32
KEY = "desktop-dispatch-key-0001"


def _repository(tmp_path: Path) -> tuple[StudioRepository, str]:
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="桌面派发",
        aspect_ratio="9:16",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    return repository, project.id


def _request(project_id: str, **changes) -> DesktopSubscriptionRequest:
    values = {
        "project_id": project_id,
        "account_kind": "grok_login",
        "model_id": "grok-4",
        "request_sha256": SHA,
        "idempotency_key": KEY,
        "connected": True,
    }
    values.update(changes)
    return DesktopSubscriptionRequest(**values)


def test_grok_and_chatgpt_logins_record_subscription_without_a_money_hold(tmp_path: Path) -> None:
    repository, project_id = _repository(tmp_path)
    grok = record_desktop_subscription_dispatch(repository, _request(project_id), now=repository._clock())
    chat = record_desktop_subscription_dispatch(
        repository,
        _request(
            project_id,
            account_kind="chatgpt_login",
            model_id="gpt-5",
            idempotency_key="desktop-dispatch-key-0002",
            request_sha256="sha256:" + "cd" * 32,
        ),
        now=repository._clock(),
    )
    assert grok.created and grok.account_kind == "grok_login" and grok.billing_class == "subscription"
    assert chat.account_kind == "gpt_login"
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 50
        rows = connection.execute(
            """
            SELECT billing_class, account_kind, attempt_id, reservation_id, desktop_dispatch_id
            FROM dispatch_billing_records ORDER BY account_kind
            """
        ).fetchall()
        assert [tuple(row) for row in rows] == [
            ("subscription", "gpt_login", None, None, chat.dispatch_id),
            ("subscription", "grok_login", None, None, grok.dispatch_id),
        ]
        assert connection.execute("SELECT COUNT(*) FROM media_budget_reservations").fetchone()[0] == 0
        sql = " ".join(
            str(row[0])
            for row in connection.execute(
                "SELECT sql FROM sqlite_master WHERE tbl_name = 'desktop_subscription_dispatches'"
            )
        )
        assert "token" not in sql
        assert "prompt" not in sql


def test_replay_does_not_insert_a_second_record_and_a_changed_key_conflicts(tmp_path: Path) -> None:
    repository, project_id = _repository(tmp_path)
    first = record_desktop_subscription_dispatch(repository, _request(project_id), now=repository._clock())
    again = record_desktop_subscription_dispatch(repository, _request(project_id), now=repository._clock())
    assert again.created is False and again.dispatch_id == first.dispatch_id
    with pytest.raises(Exception, match="幂等"):
        record_desktop_subscription_dispatch(
            repository, _request(project_id, model_id="grok-other"), now=repository._clock()
        )
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM dispatch_billing_records").fetchone()[0] == 1


def test_disconnected_subscription_and_unknown_kind_do_not_open_a_free_record(
    tmp_path: Path,
) -> None:
    repository, project_id = _repository(tmp_path)
    with pytest.raises(DispatchBillingBlocked, match="订阅账号未连接"):
        record_desktop_subscription_dispatch(
            repository, _request(project_id, connected=False), now=repository._clock()
        )
    with pytest.raises(Exception, match="无效"):
        record_desktop_subscription_dispatch(
            repository, _request(project_id, account_kind="api_key"), now=repository._clock()
        )
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM dispatch_billing_records").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM media_budget_reservations").fetchone()[0] == 0


def test_outcome_is_metadata_only_and_http_route_rejects_a_token_field(tmp_path: Path) -> None:
    repository, project_id = _repository(tmp_path)
    recorded = record_desktop_subscription_dispatch(
        repository, _request(project_id), now=repository._clock()
    )
    finished = finish_desktop_subscription_dispatch(
        repository,
        project_id=project_id,
        dispatch_id=recorded.dispatch_id,
        outcome="FAILED",
        failure_code="ENTITLEMENT_DENIED",
    )
    assert finished.outcome == "FAILED" and finished.failure_code == "ENTITLEMENT_DENIED"
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50102),
    )
    client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    rejected = client.post(
        f"/api/v1/projects/{project_id}/desktop-subscription-dispatches",
        json={
            "account_kind": "grok_login",
            "model_id": "grok-4",
            "request_sha256": SHA,
            "idempotency_key": "desktop-dispatch-key-0003",
            "access_token": "secret-token",
        },
    )
    assert rejected.status_code == 422
    accepted = client.post(
        f"/api/v1/projects/{project_id}/desktop-subscription-dispatches",
        json={
            "account_kind": "gpt_login",
            "model_id": "gpt-5",
            "request_sha256": "sha256:" + "ef" * 32,
            "idempotency_key": "desktop-dispatch-key-0003",
            "connected": True,
        },
    )
    assert accepted.status_code == 201
    body = accepted.json()["data"]
    assert body["billing_class"] == "subscription"
    assert body["account_kind"] == "gpt_login"
    assert "access_token" not in accepted.text
    with sqlite3.connect(repository.database_path) as connection:
        stored = connection.execute(
            "SELECT * FROM desktop_subscription_dispatches WHERE dispatch_id = ?",
            (body["dispatch_id"],),
        ).fetchone()
        assert stored is not None
        assert "secret" not in " ".join(str(value) for value in tuple(stored))
