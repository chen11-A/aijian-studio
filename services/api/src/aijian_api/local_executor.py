"""One-step local executor composed over the persistent task ledger."""

from collections.abc import Callable
from datetime import timedelta

from aijian_api.fault_injection import FaultInjector, InjectedProcessCrash, KillPoint
from aijian_api.subprocess_supervisor import LocalProcessSupervisor, ThreadedProcessSupervisor
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
        supervisor: LocalProcessSupervisor | None = None,
        fault_injector: FaultInjector | None = None,
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
        self._supervisor = supervisor
        self._fault_injector = fault_injector or FaultInjector()

    def run_once(self) -> bool:
        claim = self._ledger.claim_ready_task(
            worker_id=self._worker_id,
            lease_duration=self._lease_duration,
        )
        if claim is None:
            return False
        self._fault_injector.check(KillPoint.AFTER_CLAIM)
        running = self._ledger.mark_attempt_running(claim)
        self._fault_injector.check(KillPoint.AFTER_MARK_RUNNING)

        current_claim = running

        def heartbeat(claim: ClaimedTask) -> ClaimedTask:
            nonlocal current_claim
            current_claim = self._ledger.heartbeat(claim, lease_duration=self._lease_duration)
            return current_claim

        supervisor = self._supervisor or ThreadedProcessSupervisor(
            handler=self._handler,
            heartbeat_timeout_seconds=self._heartbeat_interval.total_seconds(),
        )
        try:
            self._fault_injector.check(KillPoint.BEFORE_HANDLER)
            output_version_id = supervisor.run(running, heartbeat)
            self._fault_injector.check(KillPoint.AFTER_HANDLER_OUTPUT)
        except InjectedProcessCrash:
            raise
        except Exception as error:
            self._ledger.fail_local_task(current_claim, error_code=type(error).__name__)
            raise
        self._fault_injector.check(KillPoint.BEFORE_COMPLETION)
        self._ledger.complete_local_task(current_claim, output_version_id=output_version_id)
        self._fault_injector.check(KillPoint.AFTER_COMPLETION)
        return True
