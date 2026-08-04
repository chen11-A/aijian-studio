"""One-step local executor composed over the persistent task ledger."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import timedelta

from aijian_api.task_ledger import ClaimedTask, LocalTaskLedger

type LocalTaskHandler = Callable[[ClaimedTask], str]


class LocalExecutor:
    def __init__(
        self,
        ledger: LocalTaskLedger,
        *,
        worker_id: str,
        lease_duration: timedelta,
        handler: LocalTaskHandler,
        heartbeat_interval: timedelta | None = None,
    ) -> None:
        resolved_heartbeat_interval = (
            lease_duration / 3 if heartbeat_interval is None else heartbeat_interval
        )
        if resolved_heartbeat_interval <= timedelta(0):
            raise ValueError("heartbeat interval must be positive")
        if resolved_heartbeat_interval >= lease_duration:
            raise ValueError("heartbeat interval must be shorter than the lease")
        self._ledger = ledger
        self._worker_id = worker_id
        self._lease_duration = lease_duration
        self._handler = handler
        self._heartbeat_interval = resolved_heartbeat_interval

    def run_once(self) -> bool:
        claim = self._ledger.claim_ready_task(
            worker_id=self._worker_id,
            lease_duration=self._lease_duration,
        )
        if claim is None:
            return False
        running = self._ledger.mark_attempt_running(claim)
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="aijian-local-task") as pool:
            result = pool.submit(self._handler, running)
            while True:
                try:
                    output_version_id = result.result(
                        timeout=self._heartbeat_interval.total_seconds()
                    )
                    break
                except FutureTimeoutError:
                    running = self._ledger.heartbeat(
                        running,
                        lease_duration=self._lease_duration,
                    )
        self._ledger.complete_local_task(running, output_version_id=output_version_id)
        return True
