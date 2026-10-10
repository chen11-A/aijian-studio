"""Pure IPC and cleanup adapters; no child process or provider is started."""

import subprocess
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import fake_agent_executor as executor
from test_fake_agent_executor import fixture_bundle, resolved_delegation, valid_fake_skill


@pytest.mark.parametrize(
    "message",
    [
        None,
        [],
        (),
        ("unknown", {}),
        ("proposal",),
        ("proposal", {}, "extra"),
        ("proposal", {}),
        ("error", "Synthetic", "failure"),
    ],
)
def test_malformed_process_messages_cannot_become_proposals(message):
    with pytest.raises(executor.FakeSkillExecutionError):
        executor._proposal_from_message(message)


@pytest.mark.parametrize(
    "message",
    [
        None,
        [],
        {},
        {"kind": "other", "proposal": {}},
        {"kind": "proposal", "proposal": {}, "extra": 1},
        {"kind": "proposal", "proposal": {}},
    ],
)
def test_malformed_wire_messages_cannot_become_proposals(message):
    with pytest.raises(executor.FakeSkillExecutionError):
        executor._proposal_from_wire_message(message)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("error_class", None),
        ("error_class", ""),
        ("error_class", "x" * 121),
        ("error_stage", None),
        ("error_stage", ""),
        ("error_stage", "x" * 121),
        ("error_locations", None),
        ("error_locations", ["x"] * 33),
        ("error_locations", [1]),
        ("error_locations", ["x" * 241]),
        ("unexpected", True),
    ],
)
def test_wire_error_receipts_are_closed_and_bounded(field, value):
    message = {
        "kind": "error",
        "error_class": "SyntheticError",
        "error_stage": "validate",
        "error_locations": ["field"],
    }
    message[field] = value
    with pytest.raises(executor.FakeSkillExecutionError, match="invalid error receipt"):
        executor._proposal_from_wire_message(message)


def test_bounded_error_remains_failure_and_valid_proposal_round_trips():
    with pytest.raises(executor.FakeSkillExecutionError, match="SyntheticError at validate"):
        executor._proposal_from_wire_message(
            {
                "kind": "error",
                "error_class": "SyntheticError",
                "error_stage": "validate",
                "error_locations": ["field"],
            }
        )
    proposal = fixture_bundle().artifact_proposal
    body = proposal.model_dump(mode="json")
    assert executor._proposal_from_wire_message({"kind": "proposal", "proposal": body}) == proposal
    assert executor._proposal_from_message(("proposal", body)) == proposal


@pytest.mark.parametrize(
    ("alive", "kill"), [([False, False], False), ([True, False], False), ([True, True], True)]
)
def test_process_cleanup_escalates_only_when_child_remains_alive(alive, kill):
    process = Mock()
    process.is_alive.side_effect = alive
    executor._stop_process(process)
    assert process.terminate.call_count == int(alive[0])
    assert process.kill.call_count == int(kill)
    assert process.join.call_count == 1 + int(kill)
    assert all(call.kwargs == {"timeout": 1} for call in process.join.call_args_list)


def test_subprocess_termination_timeout_is_bounded_and_reaped():
    process = Mock()
    process.poll.return_value = None
    process.wait.side_effect = [subprocess.TimeoutExpired("synthetic", 1), 0]
    executor._stop_subprocess(process)
    process.terminate.assert_called_once()
    process.kill.assert_called_once()
    assert process.wait.call_count == 2
    assert all(call.kwargs == {"timeout": 1} for call in process.wait.call_args_list)


@pytest.mark.parametrize("input_enabled", [False, True])
def test_isolated_handler_closes_channel_on_bounded_error(input_enabled):
    send = Mock()
    handler = Mock(side_effect=ValueError("synthetic failure"))
    snapshot = fixture_bundle().attempt
    executor._run_isolated_handler(
        send, handler, snapshot.model_dump(mode="json"), 1, input_enabled, {"synthetic": True}
    )
    send.send.assert_called_once_with(("error", "ValueError", "synthetic failure"))
    send.close.assert_called_once()
    assert len(handler.call_args.args) == (3 if input_enabled else 2)


@pytest.mark.parametrize("fault", ["missing_module", "missing_attribute"])
def test_handler_lookup_failures_do_not_resolve_untrusted_callable(fault):
    handler = SimpleNamespace(
        __module__="no_such_synthetic_module"
        if fault == "missing_module"
        else "aijian_api.fake_agent_executor",
        __qualname__="no_such_handler",
    )
    assert executor._resolve_handler(handler) is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("heartbeat_interval", timedelta(0)),
        ("heartbeat_interval", timedelta(seconds=10)),
        ("handler_timeout", timedelta(0)),
        ("isolation_backend", "unsupported"),
        ("handler", lambda *args: None),
    ],
)
def test_invalid_executor_configuration_never_claims_work(field, value):
    ledger = Mock()
    kwargs = dict(
        worker_id="synthetic",
        lease_duration=timedelta(seconds=10),
        handler_timeout=timedelta(seconds=5),
        handler=valid_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    )
    kwargs[field] = value
    with pytest.raises(ValueError):
        executor.FakeAgentSkillExecutor(ledger, Mock(), **kwargs)
    ledger.claim_ready_task.assert_not_called()
