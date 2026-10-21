"""Desktop-only ledger for subscription login dispatches.

The request body is metadata. A token, prompt, or provider response is rejected
by the extra-forbid models and is never written.
"""

from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from aijian_api.desktop_subscription_dispatch import (
    DesktopSubscriptionDispatchError,
    DesktopSubscriptionRequest,
    finish_desktop_subscription_dispatch,
    record_desktop_subscription_dispatch,
)
from aijian_api.dispatch_billing import DispatchBillingBlocked
from aijian_api.episode_contracts import PROJECT_ID_PATTERN
from aijian_api.repository import StudioRepository

Project = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
Dispatch = Annotated[str, Path(pattern=r"^dsd_[0-9a-f]{32}$")]
_ROOT = "/api/v1/projects/{project_id}/desktop-subscription-dispatches"


class RecordDesktopSubscriptionDispatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_kind: str = Field(pattern=r"^(gpt_login|grok_login|chatgpt_login)$")
    model_id: str = Field(min_length=1, max_length=200)
    request_sha256: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=16, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    connected: bool | None = None
    quota_available: bool | None = None
    rate_available: bool | None = None


class FinishDesktopSubscriptionDispatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: str = Field(pattern=r"^(COMPLETED|FAILED)$")
    failure_code: str | None = Field(default=None, pattern=r"^[A-Z0-9_]{1,64}$")


def create_desktop_subscription_router(provider: Callable[[], StudioRepository]) -> APIRouter:
    router = APIRouter()

    @router.post(_ROOT)
    def record(project_id: Project, body: RecordDesktopSubscriptionDispatch, request: Request):
        try:
            recorded = record_desktop_subscription_dispatch(
                provider(),
                DesktopSubscriptionRequest(
                    project_id,
                    body.account_kind,
                    body.model_id,
                    body.request_sha256,
                    body.idempotency_key,
                    body.connected,
                    body.quota_available,
                    body.rate_available,
                ),
                now=provider()._clock(),
            )
        except DispatchBillingBlocked as blocked:
            return _error(request, 409, blocked.status, blocked.display_reason)
        except DesktopSubscriptionDispatchError as error:
            status = 404 if error.code == "PROJECT_NOT_FOUND" else 409
            return _error(request, status, error.code, error.message)
        return JSONResponse(
            status_code=201 if recorded.created else 200,
            content={"data": _payload(recorded), "request_id": str(_request_id(request))},
        )

    @router.post(_ROOT + "/{dispatch_id}/outcome")
    def finish(
        project_id: Project,
        dispatch_id: Dispatch,
        body: FinishDesktopSubscriptionDispatch,
        request: Request,
    ):
        try:
            recorded = finish_desktop_subscription_dispatch(
                provider(),
                project_id=project_id,
                dispatch_id=dispatch_id,
                outcome=body.outcome,
                failure_code=body.failure_code,
            )
        except DesktopSubscriptionDispatchError as error:
            status = 404 if error.code == "NOT_FOUND" else 409
            return _error(request, status, error.code, error.message)
        return {"data": _payload(recorded), "request_id": str(_request_id(request))}

    return router


def _payload(recorded) -> dict[str, object]:
    return {
        "dispatch_id": recorded.dispatch_id,
        "record_id": recorded.record_id,
        "project_id": recorded.project_id,
        "account_kind": recorded.account_kind,
        "billing_class": recorded.billing_class,
        "model_id": recorded.model_id,
        "request_sha256": recorded.request_sha256,
        "outcome": recorded.outcome,
        "failure_code": recorded.failure_code,
        "created": recorded.created,
    }


def _request_id(request: Request) -> UUID:
    return request.state.request_id


def _error(request: Request, status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {"code": code, "message": message},
            "request_id": str(_request_id(request)),
        },
    )
