"""Replaceable process boundary for local task handlers."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import Protocol

from aijian_api.task_ledger import ClaimedTask

type HeartbeatCallback = Callable[[ClaimedTask], ClaimedTask]
type LocalTaskHandler = Callable[[ClaimedTask], str]


class LocalProcessSupervisor(Protocol):
    def run(self, claim: ClaimedTask, heartbeat: HeartbeatCallback) -> str:
        """Run one claimed task and return the produced artifact version id."""


class ThreadedProcessSupervisor:
    """In-process supervisor used by tests and current local execution."""

    def __init__(
        self,
        *,
        handler: LocalTaskHandler,
        heartbeat_timeout_seconds: float,
    ) -> None:
        if heartbeat_timeout_seconds <= 0:
            raise ValueError("heartbeat timeout must be positive")
        self._handler = handler
        self._heartbeat_timeout_seconds = heartbeat_timeout_seconds

    def run(self, claim: ClaimedTask, heartbeat: HeartbeatCallback) -> str:
        running = claim
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="aijian-local-task") as pool:
            result = pool.submit(self._handler, running)
            while True:
                try:
                    return result.result(timeout=self._heartbeat_timeout_seconds)
                except FutureTimeoutError:
                    running = heartbeat(running)
