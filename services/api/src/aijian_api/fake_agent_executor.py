"""Process-isolated Fake Agent/Skill execution that stops at proposal review."""

import json
import os
import subprocess
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from importlib import import_module
from inspect import isfunction
from multiprocessing import get_context
from multiprocessing.connection import Connection
from multiprocessing.process import BaseProcess
from time import monotonic, sleep
from typing import Literal, cast

from aijian_api.agent_skill_contracts import (
    ArtifactProposalV1,
    AttemptSnapshotV1,
    ProposalCostV1,
    ProposalQcV1,
)
from aijian_api.agent_skill_registry import ResolvedDelegation
from aijian_api.artifact_proposal_store import ArtifactProposalStore
from aijian_api.task_ledger import ClaimedTask, LocalTaskLedger

type FakeAgentSkillHandler = Callable[[AttemptSnapshotV1, int], ArtifactProposalV1]
type FakeAgentSkillInputHandler = Callable[[AttemptSnapshotV1, int, object], ArtifactProposalV1]
type FakeAgentSkillAnyHandler = FakeAgentSkillHandler | FakeAgentSkillInputHandler
type FakeAgentSkillInputBuilder = Callable[[AttemptSnapshotV1, ClaimedTask], object]

_SUBPROCESS_ENVIRONMENT_KEYS = (
    "COMSPEC",
    "PATH",
    "PATHEXT",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "WINDIR",
)


class FakeSkillTimeoutError(TimeoutError):
    """The bounded Fake Skill handler did not finish before its trusted timeout."""


class FakeSkillExecutionError(RuntimeError):
    """The isolated Fake Skill failed without returning a valid proposal."""


class FakeSkillShutdownRequested(RuntimeError):
    """The local runtime is stopping without changing durable task state."""


class FakeAgentSkillExecutor:
    def __init__(
        self,
        ledger: LocalTaskLedger,
        proposal_store: ArtifactProposalStore,
        *,
        worker_id: str,
        lease_duration: timedelta,
        handler_timeout: timedelta,
        handler: FakeAgentSkillAnyHandler,
        delegation: ResolvedDelegation,
        heartbeat_interval: timedelta | None = None,
        input_builder: FakeAgentSkillInputBuilder | None = None,
        stop_requested: Callable[[], bool] | None = None,
        isolation_backend: Literal["multiprocessing", "subprocess"] = "multiprocessing",
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
        if isolation_backend not in {"multiprocessing", "subprocess"}:
            raise ValueError("Fake Skill isolation backend is unsupported")
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
        self._input_builder = input_builder
        self._stop_requested = stop_requested or (lambda: False)
        self._isolation_backend = isolation_backend
        delegation.assert_registry_resolved()
        self._delegation = delegation

    def run_once(self, *, task_id: str | None = None) -> bool:
        self._raise_if_stopping()
        claim = self._ledger.claim_ready_task(
            worker_id=self._worker_id,
            lease_duration=self._lease_duration,
            task_id=task_id,
            task_kind="local.agent-skill.fake",
        )
        if claim is None:
            return False
        if claim.task_kind != "local.agent-skill.fake":
            raise PermissionError("Fake Agent/Skill executor claimed an unsupported task kind")
        self._raise_if_stopping()
        running = self._ledger.mark_attempt_running(claim)
        snapshot = self._ledger.read_agent_skill_snapshot(running)
        handler_input = (
            None if self._input_builder is None else self._input_builder(snapshot, running)
        )
        retry_budget = self._retry_budget(snapshot)
        deadline = monotonic() + self._handler_timeout.total_seconds()
        proposal, running = self._execute_handler(
            snapshot,
            running,
            invocation_index=0,
            deadline=deadline,
            handler_input=handler_input,
        )
        if _requires_qc_retry(proposal) and _retry_is_budgeted(proposal, retry_budget):
            self._raise_if_stopping()
            retried, running = self._execute_handler(
                snapshot,
                running,
                invocation_index=1,
                deadline=deadline,
                handler_input=handler_input,
            )
            proposal = _with_cumulative_cost(proposal, retried, retry_budget)
        self._raise_if_stopping()
        persisted = self._proposal_store.persist(running, proposal)
        self._ledger.complete_local_proposal_task(
            running,
            proposal_id=persisted.proposal.proposal_id,
        )
        return True

    def _raise_if_stopping(self) -> None:
        if self._stop_requested():
            raise FakeSkillShutdownRequested("Fake Skill runtime shutdown requested")

    def _retry_budget(self, snapshot: AttemptSnapshotV1) -> tuple[int, int]:
        agent = self._delegation.agent_definition
        skill = self._delegation.skill_definition
        if (
            snapshot.agent_definition_id != agent.agent_definition_id
            or snapshot.agent_version != agent.version
            or snapshot.skill_definition_id != skill.skill_definition_id
            or snapshot.skill_version != skill.version
        ):
            raise PermissionError("Attempt snapshot does not match the resolved delegation")
        return skill.budget.hard_limit_micros, skill.budget.retry_increment_limit_micros

    def _execute_handler(
        self,
        snapshot: AttemptSnapshotV1,
        running: ClaimedTask,
        *,
        invocation_index: int,
        deadline: float,
        handler_input: object | None,
    ) -> tuple[ArtifactProposalV1, ClaimedTask]:
        if self._isolation_backend == "subprocess":
            return self._execute_subprocess_handler(
                snapshot,
                running,
                invocation_index=invocation_index,
                deadline=deadline,
                handler_input=handler_input,
            )
        process_context = get_context("spawn")
        receive, send = process_context.Pipe(duplex=False)
        process = process_context.Process(
            target=_run_isolated_handler,
            args=(
                send,
                self._handler,
                snapshot.model_dump(mode="json"),
                invocation_index,
                self._input_builder is not None,
                handler_input,
            ),
            name="aijian-fake-agent",
        )
        try:
            process.start()
        except Exception:
            receive.close()
            send.close()
            raise
        send.close()
        try:
            while True:
                self._raise_if_stopping()
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
        return proposal, running

    def _execute_subprocess_handler(
        self,
        snapshot: AttemptSnapshotV1,
        running: ClaimedTask,
        *,
        invocation_index: int,
        deadline: float,
        handler_input: object | None,
    ) -> tuple[ArtifactProposalV1, ClaimedTask]:
        environment = {
            key: os.environ[key] for key in _SUBPROCESS_ENVIRONMENT_KEYS if key in os.environ
        }
        environment["PYTHONIOENCODING"] = "utf-8"
        environment["PYTHONUTF8"] = "1"
        environment["PYTHONPATH"] = os.pathsep.join(str(entry) for entry in sys.path)
        request = json.dumps(
            {
                "handler_module": self._handler.__module__,
                "handler_qualname": self._handler.__qualname__,
                "snapshot": snapshot.model_dump(mode="json"),
                "invocation_index": invocation_index,
                "has_handler_input": self._input_builder is not None,
                "handler_input": handler_input,
            },
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        process = subprocess.Popen(
            [sys.executable, "-m", "aijian_api.fake_agent_subprocess"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env=environment,
        )
        pool = ThreadPoolExecutor(max_workers=1)
        communication = pool.submit(process.communicate, request)
        try:
            while not communication.done():
                self._raise_if_stopping()
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise FakeSkillTimeoutError("Fake Skill handler timed out")
                wait_seconds = min(self._heartbeat_interval.total_seconds(), remaining)
                if self._wait_for_subprocess(communication.done, wait_seconds):
                    break
                running = self._ledger.heartbeat(
                    running,
                    lease_duration=self._lease_duration,
                    lock_timeout=timedelta(seconds=remaining),
                )
            stdout, _stderr = communication.result()
        finally:
            _stop_subprocess(process)
            pool.shutdown(wait=True, cancel_futures=True)
        if process.returncode != 0 or len(stdout.encode("utf-8")) > 2 * 1024 * 1024:
            raise FakeSkillExecutionError(
                f"Fake Skill process exited without a result ({process.returncode})"
            )
        try:
            message = json.loads(stdout)
        except json.JSONDecodeError as error:
            raise FakeSkillExecutionError("Fake Skill returned invalid JSON") from error
        return _proposal_from_wire_message(message), running

    @staticmethod
    def _wait_for_subprocess(done: Callable[[], bool], seconds: float) -> bool:
        end = monotonic() + seconds
        while monotonic() < end:
            if done():
                return True
            remaining = end - monotonic()
            if remaining > 0:
                sleep(min(0.01, remaining))
        return done()


def _run_isolated_handler(
    send: Connection,
    handler: FakeAgentSkillAnyHandler,
    raw_snapshot: object,
    invocation_index: int,
    has_handler_input: bool,
    handler_input: object | None,
) -> None:
    try:
        snapshot = AttemptSnapshotV1.model_validate(raw_snapshot)
        proposal = (
            cast(FakeAgentSkillInputHandler, handler)(snapshot, invocation_index, handler_input)
            if has_handler_input
            else cast(FakeAgentSkillHandler, handler)(snapshot, invocation_index)
        )
        send.send(("proposal", proposal.model_dump(mode="json")))
    except BaseException as error:
        send.send(("error", type(error).__name__, str(error)))
    finally:
        send.close()


def _resolve_handler(handler: FakeAgentSkillAnyHandler) -> object | None:
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


def _proposal_from_wire_message(message: object) -> ArtifactProposalV1:
    if not isinstance(message, dict):
        raise FakeSkillExecutionError("Fake Skill returned an invalid process message")
    if message.get("kind") == "error":
        expected_keys = {"kind", "error_class", "error_stage", "error_locations"}
        locations = message.get("error_locations")
        if (
            set(message) != expected_keys
            or not isinstance(message.get("error_class"), str)
            or not 1 <= len(message["error_class"]) <= 120
            or not isinstance(message.get("error_stage"), str)
            or not 1 <= len(message["error_stage"]) <= 120
            or not isinstance(locations, list)
            or len(locations) > 32
            or any(not isinstance(location, str) or len(location) > 240 for location in locations)
        ):
            raise FakeSkillExecutionError("Fake Skill returned an invalid error receipt")
        raise FakeSkillExecutionError(
            f"Fake Skill failed: {message['error_class']} "
            f"at {message['error_stage']} fields={locations}"
        )
    if set(message) != {"kind", "proposal"} or message.get("kind") != "proposal":
        raise FakeSkillExecutionError("Fake Skill returned an invalid process message")
    try:
        return ArtifactProposalV1.model_validate(message["proposal"])
    except ValueError as error:
        raise FakeSkillExecutionError("Fake Skill returned an invalid proposal") from error


def _stop_process(process: BaseProcess) -> None:
    if process.is_alive():
        process.terminate()
    process.join(timeout=1)
    if process.is_alive():
        process.kill()
        process.join(timeout=1)


def _stop_subprocess(process: subprocess.Popen[str]) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=1)


def _requires_qc_retry(proposal: ArtifactProposalV1) -> bool:
    return any(check.status != "PASS" for check in proposal.qc)


def _retry_is_budgeted(
    proposal: ArtifactProposalV1,
    retry_budget: tuple[int, int],
) -> bool:
    hard_limit, retry_increment_limit = retry_budget
    reservation = max(proposal.cost.estimated_micros, proposal.cost.actual_micros)
    remaining = hard_limit - proposal.cost.actual_micros
    return remaining >= 0 and reservation <= min(remaining, retry_increment_limit)


def _with_cumulative_cost(
    initial: ArtifactProposalV1,
    retried: ArtifactProposalV1,
    retry_budget: tuple[int, int],
) -> ArtifactProposalV1:
    hard_limit, retry_increment_limit = retry_budget
    cumulative_estimated = initial.cost.estimated_micros + retried.cost.estimated_micros
    cumulative_actual = initial.cost.actual_micros + retried.cost.actual_micros
    budget_qc: list[ProposalQcV1] = []
    if (
        retried.cost.estimated_micros > retry_increment_limit
        or retried.cost.actual_micros > retry_increment_limit
    ):
        budget_qc.append(
            ProposalQcV1(
                check_id="budget.retry-increment",
                status="FAIL",
                details="retry cost exceeded the frozen Skill retry increment",
            )
        )
    if cumulative_estimated > hard_limit or cumulative_actual > hard_limit:
        budget_qc.append(
            ProposalQcV1(
                check_id="budget.hard-limit",
                status="FAIL",
                details="cumulative cost exceeded the frozen Skill hard limit",
            )
        )
    return retried.model_copy(
        update={
            "cost": ProposalCostV1(
                estimated_micros=cumulative_estimated,
                actual_micros=cumulative_actual,
            ),
            "qc": (*retried.qc, *budget_qc),
        }
    )
