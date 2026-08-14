"""Label-based pure golden oracle for invalidation acceptance."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

Impact = Literal["blocking", "render_only", "advisory"]

_VALID_IMPACTS: frozenset[str] = frozenset({"blocking", "render_only", "advisory"})
# advisory < render_only < blocking: path effective = least severe edge impact.
_IMPACT_SEVERITY: dict[str, int] = {
    "advisory": 0,
    "render_only": 1,
    "blocking": 2,
}


class GoldenInvalidationMismatch(Exception):
    """Observed invalidation golden data does not match the expected oracle."""


@dataclass(frozen=True, slots=True)
class GoldenPathRecord:
    path_ordinal: int
    path_labels: tuple[str, ...]
    relationship_sequence: tuple[str, ...]
    impact_sequence: tuple[Impact, ...]
    effective_impact: Impact


@dataclass(frozen=True, slots=True)
class GoldenAffectedGroup:
    label: str
    paths: tuple[GoldenPathRecord, ...]
    strongest_effective_impact: Impact
    independent_path_count: int
    general_stale: bool
    general_blocked: bool
    render_blocked: bool


@dataclass(frozen=True, slots=True)
class GoldenOperation:
    """Expected or observed normalized invalidation operation (label-based)."""

    affected_groups: tuple[GoldenAffectedGroup, ...]
    human_authored_descendants_unchanged: bool


def compare_golden_invalidation(
    expected: GoldenOperation,
    observed: GoldenOperation,
) -> dict[str, Any]:
    """Compare observed operation to an independently supplied expected oracle.

    Returns a normalized success dictionary with zero misses/extras, or raises
    GoldenInvalidationMismatch when any exact-match rule fails.
    """

    _require_internally_coherent(expected, role="expected")
    _require_internally_coherent(observed, role="observed")

    expected_by_label = {group.label: group for group in expected.affected_groups}
    observed_by_label = {group.label: group for group in observed.affected_groups}
    expected_labels = set(expected_by_label)
    observed_labels = set(observed_by_label)
    missed = sorted(expected_labels - observed_labels)
    unexpected = sorted(observed_labels - expected_labels)
    if missed or unexpected:
        raise GoldenInvalidationMismatch(
            "affected group labels mismatch: "
            f"missed_invalidations={missed!r}, unexpected_invalidations={unexpected!r}"
        )

    for label in sorted(expected_labels):
        _compare_affected_group(expected_by_label[label], observed_by_label[label])

    return _normalize_success_result(observed)


def serialize_golden_result(result: Mapping[str, Any]) -> bytes:
    """Serialize a golden result as deterministic UTF-8 JSON with trailing LF."""

    text = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    return text.encode("utf-8")


def _require_internally_coherent(operation: GoldenOperation, *, role: str) -> None:
    """Fail closed when a golden operation is not self-consistent."""

    if not operation.human_authored_descendants_unchanged:
        raise GoldenInvalidationMismatch(
            f"{role} human_authored_descendants_unchanged must be true for "
            "golden acceptance"
        )

    labels = [group.label for group in operation.affected_groups]
    if len(labels) != len(set(labels)):
        raise GoldenInvalidationMismatch(f"{role} affected group labels are not unique")

    for group in operation.affected_groups:
        _require_coherent_group(group, role=role)

    ordinals = [
        path.path_ordinal
        for group in operation.affected_groups
        for path in group.paths
    ]
    if any(ordinal < 0 for ordinal in ordinals):
        raise GoldenInvalidationMismatch(
            f"{role} path ordinals must be non-negative"
        )
    if len(ordinals) != len(set(ordinals)):
        raise GoldenInvalidationMismatch(
            f"{role} path ordinals must be unique across the operation"
        )
    expected_ordinals = set(range(len(ordinals)))
    if set(ordinals) != expected_ordinals:
        raise GoldenInvalidationMismatch(
            f"{role} path ordinals must be contiguous 0..N-1 without gaps or duplicates"
        )


def _require_coherent_group(group: GoldenAffectedGroup, *, role: str) -> None:
    if not group.label:
        raise GoldenInvalidationMismatch(f"{role} affected group label must be non-empty")
    if not group.paths:
        raise GoldenInvalidationMismatch(
            f"{role} affected group {group.label!r} must have at least one path"
        )
    if group.independent_path_count != len(group.paths):
        raise GoldenInvalidationMismatch(
            f"{role} independent_path_count for {group.label!r} must equal "
            f"len(paths) ({len(group.paths)}), got {group.independent_path_count!r}"
        )

    for path in group.paths:
        _require_coherent_path(path, group_label=group.label, role=role)

    if group.strongest_effective_impact not in _VALID_IMPACTS:
        raise GoldenInvalidationMismatch(
            f"{role} invalid strongest_effective_impact "
            f"{group.strongest_effective_impact!r} for {group.label!r}; "
            "expected one of blocking|render_only|advisory"
        )

    strongest = _strongest_impact(path.effective_impact for path in group.paths)
    if group.strongest_effective_impact != strongest:
        raise GoldenInvalidationMismatch(
            f"{role} strongest_effective_impact for {group.label!r} must be "
            f"{strongest!r}, got {group.strongest_effective_impact!r}"
        )

    expect_general = strongest == "blocking"
    expect_render = strongest in ("blocking", "render_only")
    if group.general_stale is not expect_general:
        raise GoldenInvalidationMismatch(
            f"{role} general_stale for {group.label!r} must be {expect_general!r} "
            f"when strongest is {strongest!r}, got {group.general_stale!r}"
        )
    if group.general_blocked is not expect_general:
        raise GoldenInvalidationMismatch(
            f"{role} general_blocked for {group.label!r} must be {expect_general!r} "
            f"when strongest is {strongest!r}, got {group.general_blocked!r}"
        )
    if group.render_blocked is not expect_render:
        raise GoldenInvalidationMismatch(
            f"{role} render_blocked for {group.label!r} must be {expect_render!r} "
            f"when strongest is {strongest!r}, got {group.render_blocked!r}"
        )


def _require_coherent_path(
    path: GoldenPathRecord,
    *,
    group_label: str,
    role: str,
) -> None:
    if path.path_ordinal < 0:
        raise GoldenInvalidationMismatch(
            f"{role} path ordinal must be non-negative in group {group_label!r}, "
            f"got {path.path_ordinal!r}"
        )
    if not path.path_labels or any(not label for label in path.path_labels):
        raise GoldenInvalidationMismatch(
            f"{role} path labels must be non-empty in group {group_label!r}"
        )
    edge_count = len(path.relationship_sequence)
    if len(path.impact_sequence) != edge_count:
        raise GoldenInvalidationMismatch(
            f"{role} relationship/impact sequence length mismatch in group "
            f"{group_label!r}: relationships={edge_count}, "
            f"impacts={len(path.impact_sequence)}"
        )
    if len(path.path_labels) != edge_count + 1:
        raise GoldenInvalidationMismatch(
            f"{role} path label arity mismatch in group {group_label!r}: "
            f"len(path_labels)={len(path.path_labels)} must equal "
            f"len(edges)+1={edge_count + 1}"
        )
    if not path.impact_sequence:
        raise GoldenInvalidationMismatch(
            f"{role} path impact_sequence must be non-empty in group {group_label!r}"
        )
    for impact in path.impact_sequence:
        if impact not in _VALID_IMPACTS:
            raise GoldenInvalidationMismatch(
                f"{role} invalid impact {impact!r} in group {group_label!r}; "
                "expected one of blocking|render_only|advisory"
            )
    if path.effective_impact not in _VALID_IMPACTS:
        raise GoldenInvalidationMismatch(
            f"{role} invalid effective_impact {path.effective_impact!r} in group "
            f"{group_label!r}; expected one of blocking|render_only|advisory"
        )
    expected_effective = _least_severe_impact(path.impact_sequence)
    if path.effective_impact != expected_effective:
        raise GoldenInvalidationMismatch(
            f"{role} effective_impact mismatch in group {group_label!r}: "
            f"must be least-severe edge impact {expected_effective!r}, "
            f"got {path.effective_impact!r}"
        )


def _least_severe_impact(impacts: Iterable[Impact]) -> Impact:
    return min(impacts, key=lambda impact: _IMPACT_SEVERITY[impact])


def _strongest_impact(impacts: Iterable[Impact]) -> Impact:
    return max(impacts, key=lambda impact: _IMPACT_SEVERITY[impact])


def _compare_affected_group(
    expected: GoldenAffectedGroup,
    observed: GoldenAffectedGroup,
) -> None:
    label = expected.label
    if expected.strongest_effective_impact != observed.strongest_effective_impact:
        raise GoldenInvalidationMismatch(
            f"strongest_effective_impact mismatch for {label!r}: "
            f"expected {expected.strongest_effective_impact!r}, "
            f"observed {observed.strongest_effective_impact!r}"
        )
    if expected.independent_path_count != observed.independent_path_count:
        raise GoldenInvalidationMismatch(
            f"independent_path_count mismatch for {label!r}: "
            f"expected {expected.independent_path_count!r}, "
            f"observed {observed.independent_path_count!r}"
        )
    if expected.general_stale != observed.general_stale:
        raise GoldenInvalidationMismatch(
            f"general_stale mismatch for {label!r}: "
            f"expected {expected.general_stale!r}, observed {observed.general_stale!r}"
        )
    if expected.general_blocked != observed.general_blocked:
        raise GoldenInvalidationMismatch(
            f"general_blocked mismatch for {label!r}: "
            f"expected {expected.general_blocked!r}, observed {observed.general_blocked!r}"
        )
    if expected.render_blocked != observed.render_blocked:
        raise GoldenInvalidationMismatch(
            f"render_blocked mismatch for {label!r}: "
            f"expected {expected.render_blocked!r}, observed {observed.render_blocked!r}"
        )
    if len(expected.paths) != len(observed.paths):
        raise GoldenInvalidationMismatch(
            f"path multiplicity mismatch for {label!r}: "
            f"expected {len(expected.paths)}, observed {len(observed.paths)}"
        )

    expected_paths = sorted(expected.paths, key=lambda path: path.path_ordinal)
    observed_paths = sorted(observed.paths, key=lambda path: path.path_ordinal)
    for expected_path, observed_path in zip(expected_paths, observed_paths, strict=True):
        if expected_path != observed_path:
            raise GoldenInvalidationMismatch(
                f"path mismatch for {label!r}: "
                f"expected {expected_path!r}, observed {observed_path!r}"
            )


def _path_to_dict(path: GoldenPathRecord) -> dict[str, Any]:
    return {
        "effective_impact": path.effective_impact,
        "impact_sequence": list(path.impact_sequence),
        "path_labels": list(path.path_labels),
        "path_ordinal": path.path_ordinal,
        "relationship_sequence": list(path.relationship_sequence),
    }


def _group_to_dict(group: GoldenAffectedGroup) -> dict[str, Any]:
    paths = [
        _path_to_dict(path)
        for path in sorted(group.paths, key=lambda item: item.path_ordinal)
    ]
    return {
        "general_blocked": group.general_blocked,
        "general_stale": group.general_stale,
        "independent_path_count": group.independent_path_count,
        "label": group.label,
        "paths": paths,
        "render_blocked": group.render_blocked,
        "strongest_effective_impact": group.strongest_effective_impact,
    }


def _normalize_success_result(operation: GoldenOperation) -> dict[str, Any]:
    groups = [
        _group_to_dict(group)
        for group in sorted(operation.affected_groups, key=lambda item: item.label)
    ]
    path_count = sum(len(group.paths) for group in operation.affected_groups)
    return {
        "affected_group_count": len(groups),
        "affected_groups": groups,
        "human_authored_descendants_unchanged": (
            operation.human_authored_descendants_unchanged
        ),
        "independent_path_count": path_count,
        "missed_invalidation_count": 0,
        "missed_invalidations": [],
        "unexpected_invalidation_count": 0,
        "unexpected_invalidations": [],
    }
