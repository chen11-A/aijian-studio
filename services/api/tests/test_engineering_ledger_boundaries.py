"""Real temporary SQLite ledger tests; synthetic receipts are not encoder evidence."""

import sqlite3
from contextlib import contextmanager
from dataclasses import replace
from types import SimpleNamespace

import pytest
from aijian_api.engineering_test_export_contracts import (
    ENGINEERING_FIXTURE_ID,
    ENGINEERING_FIXTURE_SHA256,
    ENGINEERING_MEDIA_MAX_BYTES,
    EngineeringTestExportRequest,
)
from aijian_api.engineering_test_export_store import (
    EngineeringTestExportError,
    EngineeringTestExportStore,
)
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_output_verify import VerifiedProductOutput
from aijian_api.repository import StudioRepository

OPERATION = "etexp_" + "a" * 32


def request(operation=OPERATION):
    return EngineeringTestExportRequest(
        operation_id=operation,
        fixture_id=ENGINEERING_FIXTURE_ID,
        fixture_sha256=ENGINEERING_FIXTURE_SHA256,
    )


def output(operation=OPERATION):
    # Deliberately no MP4 or executable is created. The store accepts an upstream
    # verified DTO; actual byte/encoder verification has its own independent gate.
    return VerifiedProductOutput(
        absolute_path="C:/synthetic/" + operation + ".mp4",
        sha256="1" * 64,
        byte_size=128,
        probe_json="{}",
        probe_hash="sha256:" + "2" * 64,
        verified_at="2026-10-10T00:00:00Z",
    )


@pytest.fixture
def ledger(tmp_path):
    repository = StudioRepository(tmp_path / "workspace" / "studio.sqlite3")
    toolchain = MediaToolchain(
        profile_id="synthetic-ledger-only",
        version="0.0.0",
        ffmpeg_path=tmp_path / "not-created-ffmpeg.exe",
        ffprobe_path=tmp_path / "not-created-ffprobe.exe",
        ffmpeg_sha256="3" * 64,
        ffprobe_sha256="4" * 64,
        configuration_flags=(),
        license_class="LGPL",
        spdx_license="LGPL-2.1-only",
        distribution_status="DEVELOPMENT_ONLY",
    )
    return SimpleNamespace(
        repository=repository, toolchain=toolchain, store=EngineeringTestExportStore(repository)
    )


def dump(ledger):
    with ledger.repository._connection() as connection:
        return tuple(connection.iterdump())


def prepare(ledger, state, operation=OPERATION):
    store = ledger.store
    store.claim(request(operation), ledger.toolchain)
    if state in {"running", "verifying", "succeeded"}:
        store.start(operation)
    if state in {"verifying", "succeeded"}:
        store.verifying(operation)
    if state == "succeeded":
        store.succeed(operation, output(operation))
    if state == "unknown":
        store.unknown(operation, "SYNTHETIC_LOST_REPLY")
    if state in {"cancel-requested", "cancelled"}:
        store.request_cancel(operation)
    if state == "cancelled":
        store.cancelled(operation)


def test_claim_replay_monotonic_progress_and_bound_success_receipt(ledger):
    store = ledger.store
    first, replayed = store.claim(request(), ledger.toolchain)
    assert not replayed and first.status == "CLAIMED" and first.output is None
    before = dump(ledger)
    assert store.claim(request(), ledger.toolchain) == (first, True)
    assert dump(ledger) == before
    assert store.start(OPERATION).status == "RUNNING"
    for frames in (0, 1, 32, 32, 64):
        assert store.progress(OPERATION, frames).progress_frames == frames
    assert store.verifying(OPERATION).progress_phase == "VERIFYING"
    result = store.succeed(OPERATION, output())
    assert result.status == "SUCCEEDED" and result.scope == "ENGINEERING_TEST"
    assert result.output.sha256 == "1" * 64
    assert result.output.media_url == f"/api/v1/engineering-test/exports/{OPERATION}/media"
    assert store.get(OPERATION) == result
    before = dump(ledger)
    assert store.request_cancel(OPERATION) == result
    assert store.claim(request(), ledger.toolchain) == (result, True)
    assert store.recover_interrupted() == 0 and dump(ledger) == before


@pytest.mark.parametrize("state", ["claimed", "running", "verifying"])
def test_cancellation_is_explicit_idempotent_and_blocks_execution(ledger, state):
    prepare(ledger, state)
    store = ledger.store
    first = store.request_cancel(OPERATION)
    assert first.cancel_requested_at is not None
    assert store.request_cancel(OPERATION) == first
    result = store.cancelled(OPERATION)
    assert result.status == "CANCELLED" and result.output is None
    before = dump(ledger)
    assert store.cancelled(OPERATION) == result
    assert store.request_cancel(OPERATION) == result
    assert dump(ledger) == before


@pytest.mark.parametrize("state", ["claimed", "running", "verifying", "unknown"])
def test_unknown_retains_first_reason_and_never_restarts(ledger, state):
    prepare(ledger, state)
    first = ledger.store.unknown(OPERATION, "FIRST_REASON")
    assert first.status == "UNKNOWN" and first.output is None
    before = dump(ledger)
    assert ledger.store.unknown(OPERATION, "SECOND_REASON") == first
    assert dump(ledger) == before
    with pytest.raises(EngineeringTestExportError, match="not queued"):
        ledger.store.start(OPERATION)
    assert dump(ledger) == before


@pytest.mark.parametrize(
    "action,state,code",
    [
        ("start", state, "NOT_STARTABLE")
        for state in ["running", "verifying", "cancel-requested", "cancelled", "succeeded"]
    ]
    + [
        ("progress", state, "PROGRESS_CONFLICT")
        for state in [
            "claimed",
            "verifying",
            "cancel-requested",
            "cancelled",
            "unknown",
            "succeeded",
        ]
    ]
    + [
        ("verifying", state, "NOT_VERIFYING")
        for state in [
            "claimed",
            "verifying",
            "cancel-requested",
            "cancelled",
            "unknown",
            "succeeded",
        ]
    ]
    + [("unknown", state, "TERMINAL") for state in ["cancelled", "succeeded"]]
    + [
        ("cancelled", state, "NOT_CANCELLABLE")
        for state in ["claimed", "running", "verifying", "unknown", "succeeded"]
    ]
    + [
        ("succeed", state, "OUTPUT_CONFLICT")
        for state in ["claimed", "running", "cancel-requested", "cancelled", "unknown", "succeeded"]
    ],
)
def test_illegal_transition_is_atomic(ledger, action, state, code):
    prepare(ledger, state)
    before = dump(ledger)
    arguments = {"progress": (1,), "unknown": ("TEST_REASON",), "succeed": (output(),)}
    with pytest.raises(EngineeringTestExportError) as caught:
        getattr(ledger.store, action)(OPERATION, *arguments.get(action, ()))
    assert caught.value.code == code
    assert dump(ledger) == before


@pytest.mark.parametrize("frames", [-1, 65, True, False, 1.0, "1", None])
def test_invalid_progress_does_not_write(ledger, frames):
    prepare(ledger, "running")
    before = dump(ledger)
    with pytest.raises(EngineeringTestExportError) as caught:
        ledger.store.progress(OPERATION, frames)
    assert caught.value.code == "INVALID_PROGRESS" and dump(ledger) == before


def test_stale_progress_does_not_regress(ledger):
    prepare(ledger, "running")
    ledger.store.progress(OPERATION, 40)
    before = dump(ledger)
    with pytest.raises(EngineeringTestExportError) as caught:
        ledger.store.progress(OPERATION, 39)
    assert caught.value.code == "PROGRESS_CONFLICT" and dump(ledger) == before


@pytest.mark.parametrize("reason", ["", "ab", "bad", "A" * 81, "A B", "AB\n", "AB\x00"])
def test_invalid_unknown_reason_is_atomic(ledger, reason):
    prepare(ledger, "claimed")
    before = dump(ledger)
    with pytest.raises(EngineeringTestExportError) as caught:
        ledger.store.unknown(OPERATION, reason)
    assert caught.value.code == "INVALID_REASON" and dump(ledger) == before


@pytest.mark.parametrize("fault", ["zero", "large", "wrong-path", "cancelled"])
def test_success_requires_bound_uncancelled_verification_and_size(ledger, fault):
    prepare(ledger, "verifying")
    receipt = output()
    if fault == "zero":
        receipt = replace(receipt, byte_size=0)
    elif fault == "large":
        receipt = replace(receipt, byte_size=ENGINEERING_MEDIA_MAX_BYTES + 1)
    elif fault == "wrong-path":
        receipt = replace(receipt, absolute_path="C:/synthetic/wrong.mp4")
    else:
        ledger.store.request_cancel(OPERATION)
    before = dump(ledger)
    with pytest.raises(EngineeringTestExportError) as caught:
        ledger.store.succeed(OPERATION, receipt)
    assert caught.value.code == ("OUTPUT_SIZE" if fault in {"zero", "large"} else "OUTPUT_CONFLICT")
    assert dump(ledger) == before


def test_recovery_marks_only_interrupted_operations_unknown_once(ledger):
    states = ["claimed", "running", "verifying", "cancelled", "unknown", "succeeded"]
    for index, state in enumerate(states):
        prepare(ledger, state, "etexp_" + f"{index:032x}")
    assert ledger.store.recover_interrupted() == 3
    for index, state in enumerate(states):
        result = ledger.store.get("etexp_" + f"{index:032x}")
        if index < 3:
            assert result.status == "UNKNOWN" and result.unknown_reason == "PROCESS_INTERRUPTED"
        else:
            assert result.status == state.upper()
    before = dump(ledger)
    assert ledger.store.recover_interrupted() == 0 and dump(ledger) == before


@pytest.mark.parametrize(
    "action",
    [
        "claim",
        "request_cancel",
        "start",
        "progress",
        "verifying",
        "unknown",
        "cancelled",
        "succeed",
        "recover_interrupted",
    ],
)
def test_commit_failure_rolls_back_every_mutation(ledger, monkeypatch, action):
    if action != "claim":
        prepare(
            ledger,
            {
                "progress": "running",
                "verifying": "running",
                "succeed": "verifying",
                "cancelled": "cancel-requested",
            }.get(action, "claimed"),
        )
    original = ledger.repository._connection
    before = dump(ledger)

    @contextmanager
    def failing_connection():
        with original() as real:

            def commit():
                raise sqlite3.OperationalError("synthetic commit failure")

            yield SimpleNamespace(execute=real.execute, rollback=real.rollback, commit=commit)

    arguments = {
        "claim": (request(), ledger.toolchain),
        "progress": (OPERATION, 10),
        "unknown": (OPERATION, "TEST_UNKNOWN"),
        "succeed": (OPERATION, output()),
        "recover_interrupted": (),
    }
    with monkeypatch.context() as patch:
        patch.setattr(ledger.repository, "_connection", failing_connection)
        with pytest.raises(sqlite3.OperationalError, match="synthetic commit failure"):
            getattr(ledger.store, action)(*arguments.get(action, (OPERATION,)))
    assert dump(ledger) == before


@pytest.mark.parametrize(
    "operation,code", [("bad", "INVALID_ID"), ("etexp_" + "f" * 32, "NOT_FOUND")]
)
def test_unknown_identity_is_not_created_by_read(ledger, operation, code):
    before = dump(ledger)
    with pytest.raises(EngineeringTestExportError) as caught:
        ledger.store.get(operation)
    assert caught.value.code == code and dump(ledger) == before
