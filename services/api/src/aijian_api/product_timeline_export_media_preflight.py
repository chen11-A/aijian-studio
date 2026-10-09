"""Fail-closed, bounded checks for selected product-export media versions.

This module never claims an export, creates a path, or invokes an encoder. It is
kept separate from the registered preflight until the selected reader has QA.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path
from typing import Literal

from aijian_api.media_asset_selected_reader import (
    MAX_READ_SECONDS,
    SelectedMediaAssetRead,
    read_selected_media_asset_version,
)
from aijian_api.product_timeline_export_contracts import (
    ProductExportAssetRef,
    ProductExportIssueScope,
    ProductExportPreflightIssue,
    ProductExportPreflightRequest,
)

MediaScope = Literal["VIDEO", "DIALOGUE", "BGM", "SFX"]
SelectedReader = Callable[[Path, str, str, str], SelectedMediaAssetRead]

_MEDIA_FIELDS: tuple[tuple[MediaScope, str, Literal["video", "audio"]], ...] = (
    ("VIDEO", "video_master", "video"),
    ("DIALOGUE", "dialogue_mix", "audio"),
    ("BGM", "bgm_mix", "audio"),
    ("SFX", "sfx_mix", "audio"),
)
_READER_FAILURES = frozenset(
    {
        "MISSING",
        "CORRUPT",
        "UNVERIFIED_SIZE_LIMIT",
        "NOT_FOUND",
        "UNKNOWN_DATABASE",
        "UNKNOWN_DATABASE_BUSY",
        "UNKNOWN_DATABASE_CHANGED",
        "UNKNOWN_MEDIA_CHANGED",
        "UNKNOWN_UNSAFE_PATH",
        "UNKNOWN_INVALID_RECORD",
        "UNKNOWN_READ_BUDGET",
        "UNKNOWN_UNSUPPORTED_PLATFORM",
    }
)
MAX_MEDIA_PREFLIGHT_SECONDS = (MAX_READ_SECONDS + 1.0) * len(_MEDIA_FIELDS)


def _issue(
    scope: ProductExportIssueScope, suffix: str, message: str
) -> ProductExportPreflightIssue:
    return ProductExportPreflightIssue(code=f"{scope}_{suffix}", scope=scope, message=message)


def inspect_selected_product_media(
    database_path: Path,
    project_id: str,
    episode_id: str,
    payload: ProductExportPreflightRequest,
    *,
    reader: SelectedReader = read_selected_media_asset_version,
    clock: Callable[[], float] = time.monotonic,
) -> tuple[ProductExportPreflightIssue, ...]:
    """Inspect at most four selected asset refs under one conservative time budget.

    VERIFIED proves only the reader's byte and database checks. Rights, media
    technique, episode role, and formal timeline binding require separate proof.
    Missing refs and artifact refs remain blocked by the parent preflight.
    """

    deadline = clock() + MAX_MEDIA_PREFLIGHT_SECONDS
    issues: list[ProductExportPreflightIssue] = []
    for scope, field_name, expected_kind in _MEDIA_FIELDS:
        reference = getattr(payload, field_name)
        if not isinstance(reference, ProductExportAssetRef):
            continue
        if deadline - clock() < MAX_READ_SECONDS:
            issues.append(
                _issue(
                    scope,
                    "READ_BUDGET_EXHAUSTED",
                    "Media verification has no remaining request budget.",
                )
            )
            continue
        try:
            result = reader(database_path, project_id, reference.asset_id, reference.version_id)
        except Exception:
            issues.append(
                _issue(
                    scope,
                    "READ_UNKNOWN",
                    "The selected media version could not be verified.",
                )
            )
            continue
        if clock() > deadline:
            issues.append(
                _issue(
                    scope,
                    "READ_BUDGET_EXHAUSTED",
                    "Media verification exceeded the request budget.",
                )
            )
            continue
        if result.status != "VERIFIED":
            suffix = result.status if result.status in _READER_FAILURES else "READ_UNKNOWN"
            issues.append(
                _issue(
                    scope,
                    suffix,
                    "The selected media version is not verified.",
                )
            )
            continue
        version = result.version
        if version is None or (
            version.project_id != project_id
            or version.asset_id != reference.asset_id
            or version.version_id != reference.version_id
        ):
            issues.append(
                _issue(
                    scope,
                    "RECORD_IDENTITY_INVALID",
                    "The verified media identity differs from the request.",
                )
            )
            continue
        if version.sha256 != reference.sha256:
            issues.append(
                _issue(
                    scope,
                    "HASH_CHANGED",
                    "The selected media hash differs from storage.",
                )
            )
        if version.kind != expected_kind:
            issues.append(
                _issue(
                    scope,
                    "KIND_MISMATCH",
                    "The selected media kind does not match this track.",
                )
            )
        if not any(use.episode_id == episode_id for use in version.episode_uses):
            issues.append(
                _issue(
                    scope,
                    "EPISODE_REFERENCE_MISSING",
                    "The selected version is not referenced by this episode.",
                )
            )
        if version.rights_status != "CLEARED":
            issues.append(
                _issue(
                    scope,
                    f"RIGHTS_{version.rights_status}",
                    "The selected version has no cleared rights.",
                )
            )
        issues.append(
            _issue(
                scope,
                "RIGHTS_DECISION_UNVERIFIED",
                "An authoritative human rights decision is not bound to this version.",
            )
        )
        issues.append(
            _issue(
                scope,
                "TECHNICAL_PROBE_UNVERIFIED",
                "Decode, duration, and stream properties are not approved for export.",
            )
        )
        issues.append(
            _issue(
                scope,
                "FORMAL_BINDING_UNVERIFIED",
                "The selected version is not bound to an approved formal timeline track.",
            )
        )
    return tuple(issues)
