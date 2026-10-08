"""Bounded supervisor for explicitly composed remote source.extract execution.

The binding reader is an injected source of already issued authorization facts.
It does not authorize dispatch: RemoteExecutionAuthorizationStore checks the
current grant, policy, task, and lease again after the atomic claim.
"""

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
from aijian_api.remote_execution_authorization import (
    RemoteCompositionPolicyReader,
    TrustedRemoteCompositionPolicy,
)
from aijian_api.remote_settlement_contracts import RemoteSettlementVerifier
from aijian_api.remote_source_extract_worker import (
    REMOTE_SOURCE_EXTRACT_TASK_KIND,
    RemoteSourceExtractResult,
    RemoteSourceExtractWorker,
    SettlementEvidenceSource,
)
from aijian_api.task_ledger import LocalTaskLedger

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class AuthorizedRemoteTask:
    """Read-only persisted ISSUE binding selected before claiming its task."""

    task_id: str
    authorization_id: str
    authorization_revision: int
    connection_id: str
    connection_revision: int


class AuthorizedRemoteBindingSource(Protocol):
    def next_ready(
        self, *, exclude_task_ids: frozenset[str]
    ) -> AuthorizedRemoteTask | None: ...


@dataclass(frozen=True, slots=True)
class RemoteSourceExtractComposition:
    """Dependencies supplied only by a separately trusted composition root."""

    bindings: AuthorizedRemoteBindingSource
    composition_policy_reader: RemoteCompositionPolicyReader
    settlement_source: SettlementEvidenceSource
    settlement_verifier: RemoteSettlementVerifier
    credentials: CredentialVault


class RemoteSourceExtractRuntime:
    """Run one remote attempt at a time; never retry an executed claim."""

    def __init__(
        self,
        *,
        ledger: LocalTaskLedger,
        worker: RemoteSourceExtractWorker,
        bindings: AuthorizedRemoteBindingSource,
        composition_policy_reader: RemoteCompositionPolicyReader,
        connections: ProviderConnectionRepository,
        credentials: CredentialVault,
        worker_id: str,
        lease_duration: timedelta = timedelta(seconds=30),
        poll_interval: timedelta = timedelta(seconds=1),
    ) -> None:
        if not worker_id or lease_duration <= timedelta(0) or poll_interval <= timedelta(0):
            raise ValueError("remote runtime requires a worker id and positive intervals")
        self._ledger = ledger
        self._worker = worker
        self._bindings = bindings
        self._composition_policy_reader = composition_policy_reader
        self._connections = connections
        self._credentials = credentials
        self._worker_id = worker_id
        self._lease_duration = lease_duration
        self._poll_seconds = poll_interval.total_seconds()
        self._stop = threading.Event()
        self._iteration = threading.Lock()
        self._claimed_task_ids: set[str] = set()
        self._thread = threading.Thread(
            target=self._run,
            name="aijian-remote-source-extract",
            daemon=False,
        )
        self._started = False
        self._availability_reason = "CONFIGURED_NOT_STARTED"

    def availability(self) -> str:
        if self._stop.is_set():
            return (
                "STOPPING"
                if self._thread.is_alive() or self._iteration.locked()
                else "STOPPED"
            )
        return self._availability_reason

    def start(self) -> None:
        if self._started or self._stop.is_set():
            raise RuntimeError("remote source.extract runtime cannot be restarted")
        self._thread.start()
        self._started = True
        self._availability_reason = "WAITING_FOR_AUTHORIZED_BINDING"

    def stop(self, *, timeout: float = 45.0) -> None:
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("remote runtime stop timeout must be finite and positive")
        deadline = monotonic() + timeout
        self._stop.set()
        if self._started:
            self._thread.join(timeout=max(0.0, deadline - monotonic()))
            if self._thread.is_alive():
                raise RuntimeError("remote source.extract runtime did not stop in time")
        if not self._iteration.acquire(timeout=max(0.0, deadline - monotonic())):
            raise RuntimeError("remote source.extract operation did not stop in time")
        self._iteration.release()

    def run_once(self) -> RemoteSourceExtractResult | None:
        """Select a persisted binding, preflight dependencies, then claim exactly once."""
        if self._stop.is_set() or not self._iteration.acquire(blocking=False):
            return None
        try:
            if self._stop.is_set():
                return None
            try:
                policy = self._composition_policy_reader()
            except Exception:
                self._availability_reason = "TRUSTED_POLICY_UNAVAILABLE"
                return None
            if not isinstance(policy, TrustedRemoteCompositionPolicy):
                self._availability_reason = "TRUSTED_POLICY_UNAVAILABLE"
                return None
            try:
                binding = self._bindings.next_ready(
                    exclude_task_ids=frozenset(self._claimed_task_ids)
                )
            except Exception:
                self._availability_reason = "AUTHORIZED_BINDING_SOURCE_UNAVAILABLE"
                raise
            if binding is None:
                self._availability_reason = "WAITING_FOR_AUTHORIZED_BINDING"
                return None
            if (
                not isinstance(binding, AuthorizedRemoteTask)
                or not binding.task_id
                or not binding.authorization_id
                or type(binding.authorization_revision) is not int
                or binding.authorization_revision < 1
                or not binding.connection_id
                or type(binding.connection_revision) is not int
                or binding.connection_revision < 1
            ):
                self._availability_reason = "AUTHORIZED_BINDING_INVALID"
                raise ValueError("remote binding source returned an invalid persisted binding")
            if binding.task_id in self._claimed_task_ids:
                self._availability_reason = "TASK_ALREADY_CLAIMED_BY_RUNTIME"
                return None
            try:
                connection = self._connections.get(binding.connection_id)
            except ProviderConnectionNotFoundError:
                self._availability_reason = "PROVIDER_CONNECTION_UNAVAILABLE"
                return None
            if (
                not connection.enabled
                or connection.provider_kind != "CPA_LOOPBACK"
                or connection.revision != binding.connection_revision
            ):
                self._availability_reason = "PROVIDER_CONNECTION_UNAVAILABLE"
                return None
            try:
                credential = self._credentials.get(connection.id)
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
                task_kind=REMOTE_SOURCE_EXTRACT_TASK_KIND,
            )
            if claim is None:
                self._availability_reason = "WAITING_FOR_CLAIMABLE_TASK"
                return None
            self._claimed_task_ids.add(binding.task_id)
            self._availability_reason = "EXECUTING"
            try:
                result = self._worker.execute(
                    claim,
                    authorization_id=binding.authorization_id,
                    authorization_revision=binding.authorization_revision,
                )
            except Exception:
                self._availability_reason = "EXECUTION_FAILED_REQUIRES_RECONCILIATION"
                raise
            self._availability_reason = "WAITING_FOR_AUTHORIZED_BINDING"
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
                    "remote source.extract iteration failed: %s",
                    type(error).__name__,
                    extra={"worker_id": self._worker_id},
                )
            self._stop.wait(self._poll_seconds)
