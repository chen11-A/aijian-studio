"""One-step local executor composed over the persistent task ledger."""

from collections.abc import Callable
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
    ) -> None:
        self._ledger = ledger
        self._worker_id = worker_id
        self._lease_duration = lease_duration
        self._handler = handler

    def run_once(self) -> bool:
        claim = self._ledger.claim_ready_task(
            worker_id=self._worker_id,
            lease_duration=self._lease_duration,
        )
        if claim is None:
            return False
        running = self._ledger.mark_attempt_running(claim)
        output_version_id = self._handler(running)
        self._ledger.complete_local_task(running, output_version_id=output_version_id)
        return True
