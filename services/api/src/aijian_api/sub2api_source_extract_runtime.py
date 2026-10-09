"""Supervise one explicitly approved Sub2API source.extract task at a time."""

from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass
from datetime import timedelta
from time import monotonic
from typing import Protocol

from aijian_api.credential_vault import CredentialVault
from aijian_api.provider_connection_repository import (
    ProviderConnectionNotFoundError,
    ProviderConnectionRepository,
)
from aijian_api.sub2api_source_extract_worker import (
    SUB2API_SOURCE_EXTRACT_TASK_KIND,
    Sub2APISourceExtractResult,
    Sub2APISourceExtractWorker,
)
from aijian_api.task_ledger import LocalTaskLedger

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class AuthorizedSub2APITask:
    """Persisted, unconsumed user approval selected for one queued task."""

    task_id: str
    approval_id: str
    connection_id: str
    connection_revision: int


class Sub2APIBindingSource(Protocol):
    def next_ready(self, *, exclude_task_ids: frozenset[str]) -> AuthorizedSub2APITask | None: ...


class Sub2APISourceExtractRuntime:
    """Preflight local dependencies, claim once, and delegate atomic consent use."""

    def __init__(
        self,
        *,
        ledger: LocalTaskLedger,
        worker: Sub2APISourceExtractWorker,
        bindings: Sub2APIBindingSource,
        connections: ProviderConnectionRepository,
        credentials: CredentialVault,
        worker_id: str,
        lease_duration: timedelta = timedelta(seconds=90),
        poll_interval: timedelta = timedelta(seconds=1),
    ) -> None:
        if not worker_id or lease_duration <= timedelta(0) or poll_interval <= timedelta(0):
            raise ValueError("Sub2API runtime requires an id and positive intervals")
        self._ledger = ledger
        self._worker = worker
        self._bindings = bindings
        self._connections = connections
        self._credentials = credentials
        self._worker_id = worker_id
        self._lease_duration = lease_duration
        self._poll_seconds = poll_interval.total_seconds()
        self._stop = threading.Event()
        self._iteration = threading.Lock()
        self._claimed_task_ids: set[str] = set()
        self._thread = threading.Thread(
            target=self._run, name="aijian-sub2api-source-extract", daemon=False
        )
        self._started = False
        self._availability_reason = "CONFIGURED_NOT_STARTED"

    def availability(self) -> str:
        if self._stop.is_set():
            return "STOPPING" if self._thread.is_alive() else "STOPPED"
        return self._availability_reason

    def start(self) -> None:
        if self._started or self._stop.is_set():
            raise RuntimeError("Sub2API runtime cannot be restarted")
        self._thread.start()
        self._started = True
        self._availability_reason = "WAITING_FOR_EXPLICIT_APPROVAL"

    def stop(self, *, timeout: float = 120.0) -> None:
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Sub2API runtime stop timeout must be finite and positive")
        deadline = monotonic() + timeout
        self._stop.set()
        if self._started:
            self._thread.join(timeout=max(0.0, deadline - monotonic()))
            if self._thread.is_alive():
                raise RuntimeError("Sub2API runtime did not stop in time")
        if not self._iteration.acquire(timeout=max(0.0, deadline - monotonic())):
            raise RuntimeError("Sub2API operation did not stop in time")
        self._iteration.release()

    def run_once(self) -> Sub2APISourceExtractResult | None:
        if self._stop.is_set() or not self._iteration.acquire(blocking=False):
            return None
        try:
            if self._stop.is_set():
                return None
            try:
                binding = self._bindings.next_ready(
                    exclude_task_ids=frozenset(self._claimed_task_ids)
                )
            except Exception:
                self._availability_reason = "APPROVAL_SOURCE_UNAVAILABLE"
                raise
            if binding is None:
                self._availability_reason = "WAITING_FOR_EXPLICIT_APPROVAL"
                return None
            if (
                not isinstance(binding, AuthorizedSub2APITask)
                or not binding.task_id
                or not binding.approval_id
                or not binding.connection_id
                or type(binding.connection_revision) is not int
                or binding.connection_revision < 1
            ):
                self._availability_reason = "APPROVAL_BINDING_INVALID"
                raise ValueError("Sub2API approval binding is invalid")
            if binding.task_id in self._claimed_task_ids:
                return None
            try:
                connection = self._connections.get(binding.connection_id)
            except ProviderConnectionNotFoundError:
                self._availability_reason = "PROVIDER_CONNECTION_UNAVAILABLE"
                return None
            if (
                not connection.enabled
                or connection.provider_kind != "SUB2API"
                or connection.revision != binding.connection_revision
            ):
                self._availability_reason = "PROVIDER_CONNECTION_UNAVAILABLE"
                return None
            try:
                credential = self._credentials.get(connection.credential_ref)
            except Exception:
                self._availability_reason = "PROVIDER_CREDENTIAL_UNAVAILABLE"
                return None
            if not credential:
                self._availability_reason = "PROVIDER_CREDENTIAL_UNAVAILABLE"
                return None
            del credential
            if self._stop.is_set():
                return None
            claim = self._ledger.claim_remote_task(
                worker_id=self._worker_id,
                lease_duration=self._lease_duration,
                task_id=binding.task_id,
                task_kind=SUB2API_SOURCE_EXTRACT_TASK_KIND,
            )
            if claim is None:
                self._availability_reason = "WAITING_FOR_CLAIMABLE_TASK"
                return None
            self._claimed_task_ids.add(binding.task_id)
            self._availability_reason = "EXECUTING"
            try:
                result = self._worker.execute(claim, approval_id=binding.approval_id)
            except Exception:
                self._availability_reason = "EXECUTION_REQUIRES_RECONCILIATION"
                raise
            self._availability_reason = "WAITING_FOR_EXPLICIT_APPROVAL"
            return result
        finally:
            self._iteration.release()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                if self.run_once() is not None:
                    continue
            except Exception as error:
                _LOGGER.warning(
                    "Sub2API source.extract iteration failed: %s",
                    type(error).__name__,
                    extra={"worker_id": self._worker_id},
                )
            self._stop.wait(self._poll_seconds)
