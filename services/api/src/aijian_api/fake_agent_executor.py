"""Provider-free Agent/Skill executor that stops at a human-reviewable proposal."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import timedelta

from aijian_api.agent_skill_contracts import ArtifactProposalV1, AttemptSnapshotV1
from aijian_api.artifact_proposal_store import ArtifactProposalStore
from aijian_api.task_ledger import LocalTaskLedger

type FakeAgentSkillHandler = Callable[[AttemptSnapshotV1], ArtifactProposalV1]


class FakeAgentSkillExecutor:
    def __init__(
        self,
        ledger: LocalTaskLedger,
        proposal_store: ArtifactProposalStore,
        *,
        worker_id: str,
        lease_duration: timedelta,
        handler: FakeAgentSkillHandler,
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
        self._proposal_store = proposal_store
        self._worker_id = worker_id
        self._lease_duration = lease_duration
        self._handler = handler
        self._heartbeat_interval = resolved_heartbeat_interval

    def run_once(self, *, task_id: str | None = None) -> bool:
        claim = self._ledger.claim_ready_task(
            worker_id=self._worker_id,
            lease_duration=self._lease_duration,
            task_id=task_id,
        )
        if claim is None:
            return False
        running = self._ledger.mark_attempt_running(claim)
        snapshot = self._ledger.read_agent_skill_snapshot(running)
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="aijian-fake-agent") as pool:
            result = pool.submit(self._handler, snapshot)
            while True:
                try:
                    proposal = result.result(
                        timeout=self._heartbeat_interval.total_seconds()
                    )
                    break
                except FutureTimeoutError:
                    running = self._ledger.heartbeat(
                        running,
                        lease_duration=self._lease_duration,
                    )
        persisted = self._proposal_store.persist(running, proposal)
        self._ledger.complete_local_proposal_task(
            running,
            proposal_id=persisted.proposal.proposal_id,
        )
        return True
