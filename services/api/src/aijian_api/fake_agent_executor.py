"""Process-isolated Fake Agent/Skill execution that stops at proposal review."""

from collections.abc import Callable
from datetime import timedelta
from importlib import import_module
from inspect import isfunction
from multiprocessing import get_context
from multiprocessing.connection import Connection
from multiprocessing.process import BaseProcess
from time import monotonic

from aijian_api.agent_skill_contracts import ArtifactProposalV1, AttemptSnapshotV1
from aijian_api.artifact_proposal_store import ArtifactProposalStore
from aijian_api.task_ledger import LocalTaskLedger

type FakeAgentSkillHandler = Callable[[AttemptSnapshotV1], ArtifactProposalV1]


class FakeSkillTimeoutError(TimeoutError):
    """The bounded Fake Skill handler did not finish before its trusted timeout."""


class FakeSkillExecutionError(RuntimeError):
    """The isolated Fake Skill failed without returning a valid proposal."""


class FakeAgentSkillExecutor:
    def __init__(
        self,
        ledger: LocalTaskLedger,
        proposal_store: ArtifactProposalStore,
        *,
        worker_id: str,
        lease_duration: timedelta,
        handler_timeout: timedelta,
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
        if handler_timeout <= timedelta(0):
            raise ValueError("handler timeout must be positive")
        if (
            not isfunction(handler)
            or handler.__name__ == "<lambda>"
            or "<locals>" in handler.__qualname__
            or _resolve_handler(handler) is not handler
        ):
            raise ValueError("Fake Skill handler must be an importable top-level function")
        self._ledger = ledger
        self._proposal_store = proposal_store
        self._worker_id = worker_id
        self._lease_duration = lease_duration
        self._handler = handler
        self._heartbeat_interval = resolved_heartbeat_interval
        self._handler_timeout = handler_timeout

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
        process_context = get_context("spawn")
        receive, send = process_context.Pipe(duplex=False)
        process = process_context.Process(
            target=_run_isolated_handler,
            args=(send, self._handler, snapshot),
            name="aijian-fake-agent",
        )
        try:
            process.start()
        except Exception:
            receive.close()
            send.close()
            raise
        send.close()
        deadline = monotonic() + self._handler_timeout.total_seconds()
        try:
            while True:
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise FakeSkillTimeoutError("Fake Skill handler timed out")
                wait_seconds = min(self._heartbeat_interval.total_seconds(), remaining)
                try:
                    message_ready = receive.poll(wait_seconds)
                except (EOFError, OSError) as error:
                    raise FakeSkillExecutionError(
                        "Fake Skill process exited without a result"
                    ) from error
                if message_ready:
                    try:
                        message = receive.recv()
                    except (EOFError, OSError) as error:
                        raise FakeSkillExecutionError(
                            "Fake Skill process exited without a result"
                        ) from error
                    proposal = _proposal_from_message(message)
                    break
                if not process.is_alive():
                    raise FakeSkillExecutionError(
                        f"Fake Skill process exited without a result ({process.exitcode})"
                    )
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise FakeSkillTimeoutError("Fake Skill handler timed out")
                running = self._ledger.heartbeat(
                    running,
                    lease_duration=self._lease_duration,
                    lock_timeout=timedelta(seconds=remaining),
                )
        finally:
            receive.close()
            _stop_process(process)
        persisted = self._proposal_store.persist(running, proposal)
        self._ledger.complete_local_proposal_task(
            running,
            proposal_id=persisted.proposal.proposal_id,
        )
        return True


def _run_isolated_handler(
    send: Connection,
    handler: FakeAgentSkillHandler,
    snapshot: AttemptSnapshotV1,
) -> None:
    try:
        proposal = handler(snapshot)
        send.send(("proposal", proposal.model_dump(mode="json")))
    except BaseException as error:
        send.send(("error", type(error).__name__, str(error)))
    finally:
        send.close()


def _resolve_handler(handler: FakeAgentSkillHandler) -> object | None:
    try:
        resolved: object = import_module(handler.__module__)
        for part in handler.__qualname__.split("."):
            resolved = getattr(resolved, part)
        return resolved
    except (AttributeError, ImportError):
        return None


def _proposal_from_message(message: object) -> ArtifactProposalV1:
    if not isinstance(message, tuple) or not message:
        raise FakeSkillExecutionError("Fake Skill returned an invalid process message")
    if message[0] == "error" and len(message) == 3:
        raise FakeSkillExecutionError(f"Fake Skill failed: {message[1]}: {message[2]}")
    if message[0] != "proposal" or len(message) != 2:
        raise FakeSkillExecutionError("Fake Skill returned an invalid process message")
    try:
        return ArtifactProposalV1.model_validate(message[1])
    except ValueError as error:
        raise FakeSkillExecutionError("Fake Skill returned an invalid proposal") from error


def _stop_process(process: BaseProcess) -> None:
    if process.is_alive():
        process.terminate()
    process.join(timeout=1)
    if process.is_alive():
        process.kill()
        process.join(timeout=1)
