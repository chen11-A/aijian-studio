"""Unit tests for the pure label-based invalidation golden oracle."""

from __future__ import annotations

from scripts.invalidation_golden_oracle import (
    GoldenAffectedGroup,
    GoldenInvalidationMismatch,
    GoldenOperation,
    GoldenPathRecord,
    compare_golden_invalidation,
    serialize_golden_result,
)


def _direct_path() -> GoldenPathRecord:
    return GoldenPathRecord(
        path_ordinal=0,
        path_labels=("root_v2", "direct_v1"),
        relationship_sequence=("derived_from",),
        impact_sequence=("blocking",),
        effective_impact="blocking",
    )


def _diamond_via_mid_a() -> GoldenPathRecord:
    return GoldenPathRecord(
        path_ordinal=1,
        path_labels=("root_v2", "mid_a_v1", "diamond_v1"),
        relationship_sequence=("derived_from", "derived_from"),
        impact_sequence=("blocking", "blocking"),
        effective_impact="blocking",
    )


def _diamond_via_mid_b() -> GoldenPathRecord:
    return GoldenPathRecord(
        path_ordinal=2,
        path_labels=("root_v2", "mid_b_v1", "diamond_v1"),
        relationship_sequence=("references", "derived_from"),
        impact_sequence=("advisory", "blocking"),
        effective_impact="advisory",
    )


def _direct_group() -> GoldenAffectedGroup:
    return GoldenAffectedGroup(
        label="direct_v1",
        paths=(_direct_path(),),
        strongest_effective_impact="blocking",
        independent_path_count=1,
        general_stale=True,
        general_blocked=True,
        render_blocked=True,
    )


def _diamond_group() -> GoldenAffectedGroup:
    return GoldenAffectedGroup(
        label="diamond_v1",
        paths=(_diamond_via_mid_a(), _diamond_via_mid_b()),
        strongest_effective_impact="blocking",
        independent_path_count=2,
        general_stale=True,
        general_blocked=True,
        render_blocked=True,
    )


def _expected_operation() -> GoldenOperation:
    # Hand-authored oracle: direct leaf + diamond (two independent paths).
    # Unaffected control "unaffected_v1" is intentionally absent.
    return GoldenOperation(
        affected_groups=(_direct_group(), _diamond_group()),
        human_authored_descendants_unchanged=True,
    )


def _observed_operation() -> GoldenOperation:
    # Independently constructed with the same values as the happy-path oracle.
    return GoldenOperation(
        affected_groups=(
            GoldenAffectedGroup(
                label="direct_v1",
                paths=(
                    GoldenPathRecord(
                        path_ordinal=0,
                        path_labels=("root_v2", "direct_v1"),
                        relationship_sequence=("derived_from",),
                        impact_sequence=("blocking",),
                        effective_impact="blocking",
                    ),
                ),
                strongest_effective_impact="blocking",
                independent_path_count=1,
                general_stale=True,
                general_blocked=True,
                render_blocked=True,
            ),
            GoldenAffectedGroup(
                label="diamond_v1",
                paths=(
                    GoldenPathRecord(
                        path_ordinal=1,
                        path_labels=("root_v2", "mid_a_v1", "diamond_v1"),
                        relationship_sequence=("derived_from", "derived_from"),
                        impact_sequence=("blocking", "blocking"),
                        effective_impact="blocking",
                    ),
                    GoldenPathRecord(
                        path_ordinal=2,
                        path_labels=("root_v2", "mid_b_v1", "diamond_v1"),
                        relationship_sequence=("references", "derived_from"),
                        impact_sequence=("advisory", "blocking"),
                        effective_impact="advisory",
                    ),
                ),
                strongest_effective_impact="blocking",
                independent_path_count=2,
                general_stale=True,
                general_blocked=True,
                render_blocked=True,
            ),
        ),
        human_authored_descendants_unchanged=True,
    )


def test_valid_observation_returns_zero_misses_and_deterministic_bytes() -> None:
    result = compare_golden_invalidation(_expected_operation(), _observed_operation())

    assert result["missed_invalidations"] == []
    assert result["unexpected_invalidations"] == []
    assert result["missed_invalidation_count"] == 0
    assert result["unexpected_invalidation_count"] == 0
    assert result["human_authored_descendants_unchanged"] is True
    assert result["affected_group_count"] == 2
    assert result["independent_path_count"] == 3

    payload = serialize_golden_result(result)
    assert payload == serialize_golden_result(result)
    assert payload.endswith(b"\n")
    assert payload.decode("utf-8").startswith("{\n")
    # Sorted keys: affected_* before human_* before independent_* before missed_*.
    text = payload.decode("utf-8")
    assert text.index('"affected_group_count"') < text.index(
        '"human_authored_descendants_unchanged"'
    )
    assert b"unaffected_v1" not in payload


def test_missing_affected_version_fails() -> None:
    observed = GoldenOperation(
        affected_groups=(_direct_group(),),
        human_authored_descendants_unchanged=True,
    )
    try:
        compare_golden_invalidation(_expected_operation(), observed)
    except GoldenInvalidationMismatch as error:
        assert "missed_invalidations" in str(error)
        assert "diamond_v1" in str(error)
    else:
        raise AssertionError("expected GoldenInvalidationMismatch")


def test_unexpected_affected_version_fails() -> None:
    unexpected = GoldenAffectedGroup(
        label="unaffected_v1",
        paths=(
            GoldenPathRecord(
                path_ordinal=3,
                path_labels=("root_v2", "unaffected_v1"),
                relationship_sequence=("mentions",),
                impact_sequence=("advisory",),
                effective_impact="advisory",
            ),
        ),
        strongest_effective_impact="advisory",
        independent_path_count=1,
        general_stale=False,
        general_blocked=False,
        render_blocked=False,
    )
    observed = GoldenOperation(
        affected_groups=(_direct_group(), _diamond_group(), unexpected),
        human_authored_descendants_unchanged=True,
    )
    try:
        compare_golden_invalidation(_expected_operation(), observed)
    except GoldenInvalidationMismatch as error:
        assert "unexpected_invalidations" in str(error)
        assert "unaffected_v1" in str(error)
    else:
        raise AssertionError("expected GoldenInvalidationMismatch")


def test_missing_one_diamond_path_fails() -> None:
    incomplete_diamond = GoldenAffectedGroup(
        label="diamond_v1",
        paths=(_diamond_via_mid_a(),),
        strongest_effective_impact="blocking",
        independent_path_count=1,
        general_stale=True,
        general_blocked=True,
        render_blocked=True,
    )
    observed = GoldenOperation(
        affected_groups=(_direct_group(), incomplete_diamond),
        human_authored_descendants_unchanged=True,
    )
    try:
        compare_golden_invalidation(_expected_operation(), observed)
    except GoldenInvalidationMismatch as error:
        message = str(error)
        assert "path" in message.lower() or "ordinal" in message.lower()
    else:
        raise AssertionError("expected GoldenInvalidationMismatch")


def test_wrong_edge_or_effective_impact_fails() -> None:
    wrong_path = GoldenPathRecord(
        path_ordinal=2,
        path_labels=("root_v2", "mid_b_v1", "diamond_v1"),
        relationship_sequence=("references", "derived_from"),
        impact_sequence=("advisory", "blocking"),
        effective_impact="blocking",  # should be advisory (path min)
    )
    wrong_diamond = GoldenAffectedGroup(
        label="diamond_v1",
        paths=(_diamond_via_mid_a(), wrong_path),
        strongest_effective_impact="blocking",
        independent_path_count=2,
        general_stale=True,
        general_blocked=True,
        render_blocked=True,
    )
    observed = GoldenOperation(
        affected_groups=(_direct_group(), wrong_diamond),
        human_authored_descendants_unchanged=True,
    )
    try:
        compare_golden_invalidation(_expected_operation(), observed)
    except GoldenInvalidationMismatch as error:
        message = str(error)
        assert "path mismatch" in message or "effective_impact" in message
    else:
        raise AssertionError("expected GoldenInvalidationMismatch")


def test_incorrect_counts_strongest_flags_or_noncontiguous_ordinals_fail() -> None:
    wrong_count = GoldenAffectedGroup(
        label="diamond_v1",
        paths=(_diamond_via_mid_a(), _diamond_via_mid_b()),
        strongest_effective_impact="blocking",
        independent_path_count=1,  # should be 2
        general_stale=True,
        general_blocked=True,
        render_blocked=True,
    )
    try:
        compare_golden_invalidation(
            _expected_operation(),
            GoldenOperation(
                affected_groups=(_direct_group(), wrong_count),
                human_authored_descendants_unchanged=True,
            ),
        )
    except GoldenInvalidationMismatch as error:
        assert "independent_path_count" in str(error)
    else:
        raise AssertionError("expected GoldenInvalidationMismatch for count")

    wrong_strongest = GoldenAffectedGroup(
        label="diamond_v1",
        paths=(_diamond_via_mid_a(), _diamond_via_mid_b()),
        strongest_effective_impact="advisory",  # should be blocking
        independent_path_count=2,
        general_stale=True,
        general_blocked=True,
        render_blocked=True,
    )
    try:
        compare_golden_invalidation(
            _expected_operation(),
            GoldenOperation(
                affected_groups=(_direct_group(), wrong_strongest),
                human_authored_descendants_unchanged=True,
            ),
        )
    except GoldenInvalidationMismatch as error:
        assert "strongest_effective_impact" in str(error)
    else:
        raise AssertionError("expected GoldenInvalidationMismatch for strongest")

    wrong_flags = GoldenAffectedGroup(
        label="diamond_v1",
        paths=(_diamond_via_mid_a(), _diamond_via_mid_b()),
        strongest_effective_impact="blocking",
        independent_path_count=2,
        general_stale=False,
        general_blocked=False,
        render_blocked=False,
    )
    try:
        compare_golden_invalidation(
            _expected_operation(),
            GoldenOperation(
                affected_groups=(_direct_group(), wrong_flags),
                human_authored_descendants_unchanged=True,
            ),
        )
    except GoldenInvalidationMismatch as error:
        assert "general_stale" in str(error) or "general_blocked" in str(error)
    else:
        raise AssertionError("expected GoldenInvalidationMismatch for flags")

    gapped = GoldenAffectedGroup(
        label="diamond_v1",
        paths=(
            GoldenPathRecord(
                path_ordinal=1,
                path_labels=("root_v2", "mid_a_v1", "diamond_v1"),
                relationship_sequence=("derived_from", "derived_from"),
                impact_sequence=("blocking", "blocking"),
                effective_impact="blocking",
            ),
            GoldenPathRecord(
                path_ordinal=4,  # gap / non-contiguous global ordinals
                path_labels=("root_v2", "mid_b_v1", "diamond_v1"),
                relationship_sequence=("references", "derived_from"),
                impact_sequence=("advisory", "blocking"),
                effective_impact="advisory",
            ),
        ),
        strongest_effective_impact="blocking",
        independent_path_count=2,
        general_stale=True,
        general_blocked=True,
        render_blocked=True,
    )
    try:
        compare_golden_invalidation(
            _expected_operation(),
            GoldenOperation(
                affected_groups=(_direct_group(), gapped),
                human_authored_descendants_unchanged=True,
            ),
        )
    except GoldenInvalidationMismatch as error:
        assert "ordinal" in str(error).lower()
    else:
        raise AssertionError("expected GoldenInvalidationMismatch for ordinals")


def test_human_authored_descendants_unchanged_false_fails() -> None:
    observed = GoldenOperation(
        affected_groups=(_direct_group(), _diamond_group()),
        human_authored_descendants_unchanged=False,
    )
    try:
        compare_golden_invalidation(_expected_operation(), observed)
    except GoldenInvalidationMismatch as error:
        assert "human_authored_descendants_unchanged" in str(error)
    else:
        raise AssertionError("expected GoldenInvalidationMismatch")


def test_identical_invalid_arity_or_effective_impact_is_rejected() -> None:
    # Path labels length must equal edge count + 1; effective_impact must be
    # the least-severe edge impact (advisory < render_only < blocking).
    bad_arity = GoldenPathRecord(
        path_ordinal=0,
        path_labels=("a",),  # should be two labels for one edge
        relationship_sequence=("derived_from",),
        impact_sequence=("advisory",),
        effective_impact="advisory",
    )
    bad_arity_group = GoldenAffectedGroup(
        label="a",
        paths=(bad_arity,),
        strongest_effective_impact="advisory",
        independent_path_count=1,
        general_stale=False,
        general_blocked=False,
        render_blocked=False,
    )
    bad_arity_op = GoldenOperation(
        affected_groups=(bad_arity_group,),
        human_authored_descendants_unchanged=True,
    )
    try:
        compare_golden_invalidation(bad_arity_op, bad_arity_op)
    except GoldenInvalidationMismatch as error:
        assert "arity" in str(error).lower() or "path label" in str(error).lower()
    else:
        raise AssertionError("expected GoldenInvalidationMismatch for path arity")

    bad_effective = GoldenPathRecord(
        path_ordinal=0,
        path_labels=("a", "b"),
        relationship_sequence=("derived_from",),
        impact_sequence=("advisory",),
        effective_impact="blocking",  # must be advisory (least severe)
    )
    bad_effective_group = GoldenAffectedGroup(
        label="b",
        paths=(bad_effective,),
        strongest_effective_impact="blocking",
        independent_path_count=1,
        general_stale=True,
        general_blocked=True,
        render_blocked=True,
    )
    bad_effective_op = GoldenOperation(
        affected_groups=(bad_effective_group,),
        human_authored_descendants_unchanged=True,
    )
    try:
        compare_golden_invalidation(bad_effective_op, bad_effective_op)
    except GoldenInvalidationMismatch as error:
        assert "effective_impact" in str(error)
    else:
        raise AssertionError("expected GoldenInvalidationMismatch for effective_impact")


def test_identical_invalid_count_is_rejected() -> None:
    path = GoldenPathRecord(
        path_ordinal=0,
        path_labels=("a", "b"),
        relationship_sequence=("derived_from",),
        impact_sequence=("advisory",),
        effective_impact="advisory",
    )
    # independent_path_count must equal len(paths); audit example used 99.
    group = GoldenAffectedGroup(
        label="b",
        paths=(path,),
        strongest_effective_impact="advisory",
        independent_path_count=99,
        general_stale=False,
        general_blocked=False,
        render_blocked=False,
    )
    operation = GoldenOperation(
        affected_groups=(group,),
        human_authored_descendants_unchanged=True,
    )
    try:
        compare_golden_invalidation(operation, operation)
    except GoldenInvalidationMismatch as error:
        assert "independent_path_count" in str(error)
    else:
        raise AssertionError("expected GoldenInvalidationMismatch for path count")


def test_identical_invalid_strongest_or_flags_is_rejected() -> None:
    path = GoldenPathRecord(
        path_ordinal=0,
        path_labels=("a", "b"),
        relationship_sequence=("derived_from",),
        impact_sequence=("advisory",),
        effective_impact="advisory",
    )
    # Audit case: strongest/flags disagree with the sole advisory path.
    wrong_strongest = GoldenAffectedGroup(
        label="b",
        paths=(path,),
        strongest_effective_impact="blocking",
        independent_path_count=1,
        general_stale=True,
        general_blocked=True,
        render_blocked=True,
    )
    wrong_strongest_op = GoldenOperation(
        affected_groups=(wrong_strongest,),
        human_authored_descendants_unchanged=True,
    )
    try:
        compare_golden_invalidation(wrong_strongest_op, wrong_strongest_op)
    except GoldenInvalidationMismatch as error:
        message = str(error)
        assert (
            "strongest_effective_impact" in message
            or "general_stale" in message
            or "general_blocked" in message
            or "render_blocked" in message
        )
    else:
        raise AssertionError("expected GoldenInvalidationMismatch for strongest/flags")

    # Coherent strongest but incorrect flag derivation.
    wrong_flags = GoldenAffectedGroup(
        label="b",
        paths=(path,),
        strongest_effective_impact="advisory",
        independent_path_count=1,
        general_stale=True,  # must be False when strongest is advisory
        general_blocked=False,
        render_blocked=False,
    )
    wrong_flags_op = GoldenOperation(
        affected_groups=(wrong_flags,),
        human_authored_descendants_unchanged=True,
    )
    try:
        compare_golden_invalidation(wrong_flags_op, wrong_flags_op)
    except GoldenInvalidationMismatch as error:
        assert "general_stale" in str(error)
    else:
        raise AssertionError("expected GoldenInvalidationMismatch for flags")


def test_identical_false_human_immutability_is_rejected() -> None:
    path = GoldenPathRecord(
        path_ordinal=0,
        path_labels=("a", "b"),
        relationship_sequence=("derived_from",),
        impact_sequence=("advisory",),
        effective_impact="advisory",
    )
    group = GoldenAffectedGroup(
        label="b",
        paths=(path,),
        strongest_effective_impact="advisory",
        independent_path_count=1,
        general_stale=False,
        general_blocked=False,
        render_blocked=False,
    )
    # Equal on both sides is not enough: golden acceptance requires True.
    operation = GoldenOperation(
        affected_groups=(group,),
        human_authored_descendants_unchanged=False,
    )
    try:
        compare_golden_invalidation(operation, operation)
    except GoldenInvalidationMismatch as error:
        assert "human_authored_descendants_unchanged" in str(error)
    else:
        raise AssertionError(
            "expected GoldenInvalidationMismatch for false human immutability"
        )
