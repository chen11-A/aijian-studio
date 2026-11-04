"""Synthetic human-declaration audit chains; these tests do not establish real rights."""

import sqlite3
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore, RightsDecisionError
from test_media_asset_read_boundaries import media as media
from test_media_asset_store_boundaries import dump


def command(revision=0, suffix="a", decision="CLEARED"):
    return HumanRightsDecisionInput(
        operation_id="rdop_" + suffix * 32,
        expected_revision=revision,
        decision=decision,
        basis_text="Synthetic fixture declaration only, no real media rights.",
    )


def append(media, value=None, actor="test-human"):
    return MediaAssetRightsStore(media.repository).append_human_decision(
        media.project.id,
        media.asset.id,
        media.version.id,
        value if value is not None else command(),
        actor_id=actor,
    )


def test_append_and_replay_preserve_monotonic_chain_and_original_receipt(media):
    first = append(media)
    before = dump(media)
    replayed = append(media)
    assert replayed.replayed and replayed.is_latest
    assert replayed.decision == first.decision
    assert dump(media) == before
    second = append(media, command(1, "b", "RESTRICTED"))
    assert second.decision.previous_decision_id == first.decision.decision_id
    assert second.decision.revision == 2
    replayed_old = append(media)
    assert replayed_old.replayed and not replayed_old.is_latest
    assert replayed_old.current_revision == 2
    store = MediaAssetRightsStore(media.repository)
    assert store.audit_history(media.project.id, media.asset.id, media.version.id) == (
        first.decision,
        second.decision,
    )
    assert (
        store.get_operation_receipt(
            media.project.id, media.asset.id, media.version.id, command().operation_id
        ).decision
        == first.decision
    )


@pytest.mark.parametrize(
    "fault,code", [("stale", "REVISION_CONFLICT"), ("reused", "OPERATION_CONFLICT")]
)
def test_revision_and_operation_conflicts_do_not_append(media, fault, code):
    append(media)
    before = dump(media)
    value = command(0, "b") if fault == "stale" else command(0, "a", "RESTRICTED")
    with pytest.raises(RightsDecisionError) as caught:
        append(media, value)
    assert caught.value.code == code
    assert dump(media) == before


@pytest.mark.parametrize(
    "actor",
    [None, 0, "", " spaced", "trailing ", "x" * 129, "line\nbreak", "nul\x00", "del\x7f", "\ud800"],
)
def test_invalid_actor_never_creates_rights_decision(media, actor):
    before = dump(media)
    with pytest.raises(RightsDecisionError) as caught:
        append(media, actor=actor)
    assert caught.value.code == "INVALID_ACTOR"
    assert dump(media) == before


def test_actor_unicode_is_normalized_before_audit_hashing(media):
    receipt = append(media, actor="Cafe\u0301")
    assert receipt.decision.actor_id == "Café"
    assert append(media, actor="Café").replayed


@pytest.mark.parametrize(
    "value",
    [
        object(),
        {},
        command().model_copy(update={"expected_revision": True}),
        command().model_copy(update={"basis_text": "short"}),
    ],
)
def test_unvalidated_inputs_are_revalidated_before_database_write(media, value):
    before = dump(media)
    with pytest.raises(RightsDecisionError) as caught:
        append(media, value)
    assert caught.value.code == "INVALID_INPUT"
    assert dump(media) == before


@pytest.mark.parametrize("method", ["append", "audit", "receipt"])
@pytest.mark.parametrize("field", [0, 1, 2])
def test_invalid_scope_never_falls_back_to_another_version(media, method, field):
    ids = [media.project.id, media.asset.id, media.version.id]
    ids[field] = "bad"
    store = MediaAssetRightsStore(media.repository)
    with pytest.raises(RightsDecisionError) as caught:
        if method == "append":
            store.append_human_decision(*ids, command(), actor_id="test-human")
        elif method == "audit":
            store.audit_history(*ids)
        else:
            store.get_operation_receipt(*ids, command().operation_id)
    assert caught.value.code == "INVALID_ID"


def test_absent_version_and_operation_are_distinct(media):
    store = MediaAssetRightsStore(media.repository)
    with pytest.raises(RightsDecisionError) as absent_operation:
        store.get_operation_receipt(
            media.project.id, media.asset.id, media.version.id, command().operation_id
        )
    assert absent_operation.value.code == "OPERATION_NOT_FOUND"
    with pytest.raises(RightsDecisionError) as absent_version:
        store.audit_history(media.project.id, media.asset.id, "asv_" + "0" * 32)
    assert absent_version.value.code == "VERSION_NOT_FOUND"


@pytest.mark.parametrize(
    "failure,code",
    [(sqlite3.IntegrityError, "REVISION_CONFLICT"), (sqlite3.OperationalError, "WRITE_UNKNOWN")],
)
@pytest.mark.parametrize("existing", [False, True])
def test_commit_failure_rolls_back_both_history_and_head(
    media, monkeypatch, failure, code, existing
):
    if existing:
        append(media)
    original = media.repository._connection
    before = dump(media)

    @contextmanager
    def connection():
        with original() as real:

            def commit():
                raise failure("synthetic commit fault")

            yield SimpleNamespace(execute=real.execute, rollback=real.rollback, commit=commit)

    monkeypatch.setattr(media.repository, "_connection", connection)
    with pytest.raises(RightsDecisionError) as caught:
        append(media, command(int(existing), "b"))
    assert caught.value.code == code
    assert dump(media) == before
