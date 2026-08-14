"""Label-based pure golden oracle for invalidation acceptance."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

Impact = Literal["blocking", "render_only", "advisory"]


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

    _require_unique_group_labels(expected, role="expected")
    _require_unique_group_labels(observed, role="observed")
    _require_contiguous_global_ordinals(expected, role="expected")
    _require_contiguous_global_ordinals(observed, role="observed")

    if (
        expected.human_authored_descendants_unchanged
        != observed.human_authored_descendants_unchanged
    ):
        raise GoldenInvalidationMismatch(
            "human_authored_descendants_unchanged mismatch: "
            f"expected {expected.human_authored_descendants_unchanged!r}, "
            f"observed {observed.human_authored_descendants_unchanged!r}"
        )

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


def _require_unique_group_labels(operation: GoldenOperation, *, role: str) -> None:
    labels = [group.label for group in operation.affected_groups]
    if len(labels) != len(set(labels)):
        raise GoldenInvalidationMismatch(f"{role} affected group labels are not unique")


def _require_contiguous_global_ordinals(operation: GoldenOperation, *, role: str) -> None:
    ordinals = [
        path.path_ordinal
        for group in operation.affected_groups
        for path in group.paths
    ]
    if len(ordinals) != len(set(ordinals)):
        raise GoldenInvalidationMismatch(
            f"{role} path ordinals must be unique across the operation"
        )
    expected_ordinals = set(range(len(ordinals)))
    if set(ordinals) != expected_ordinals:
        raise GoldenInvalidationMismatch(
            f"{role} path ordinals must be contiguous 0..N-1 without gaps or duplicates"
        )


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
