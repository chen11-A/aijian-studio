"""Zero-write, bounded audit of the latest rights declaration for one version."""

from __future__ import annotations

import os
import re
import sqlite3
import stat
import time
from pathlib import Path

from aijian_api.media_asset_rights_contracts import (
    AuthoritativeRightsDecision,
    RightsDecisionReadResult,
)
from aijian_api.media_asset_rights_store import RightsDecisionError, _validated_history
from aijian_api.media_asset_selected_reader import (
    MAX_DATABASE_BYTES,
    MAX_READ_SECONDS,
    _hash_stream,
    _plain_directory,
    _ReadBudgetExceeded,
    _sidecar_state,
)
from aijian_api.media_probe import _is_remote_windows_path, _open_local_source

_PROJECT = re.compile(r"prj_[0-9a-f]{32}\Z")
_ASSET = re.compile(r"asset_[0-9a-f]{32}\Z")
_VERSION = re.compile(r"asv_[0-9a-f]{32}\Z")
_DECISION = re.compile(r"ard_[0-9a-f]{32}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")


def _read_database(
    database_path: Path,
    project_id: str,
    asset_id: str,
    version_id: str,
    expected_revision: int | None,
    expected_decision_id: str | None,
    expected_content_hash: str | None,
) -> RightsDecisionReadResult:
    uri = f"{database_path.as_uri()}?mode=ro&immutable=1&cache=private"
    connection = sqlite3.connect(uri, uri=True, timeout=0)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        version = connection.execute(
            """SELECT version.sha256 FROM media_asset_versions AS version
               JOIN media_assets AS asset
                 ON asset.project_id = version.project_id AND asset.id = version.asset_id
               WHERE version.project_id = ? AND version.asset_id = ?
                 AND version.id = ? AND asset.deleted_at IS NULL""",
            (project_id, asset_id, version_id),
        ).fetchone()
        if version is None:
            return RightsDecisionReadResult(status="NOT_FOUND")
        asset_sha256 = str(version["sha256"])
        if _HASH.fullmatch(asset_sha256) is None:
            return RightsDecisionReadResult(status="UNKNOWN_INVALID_RECORD")
        try:
            history = _validated_history(
                connection,
                project_id,
                asset_id,
                version_id,
                asset_sha256,
            )
        except RightsDecisionError:
            return RightsDecisionReadResult(status="UNKNOWN_INVALID_RECORD")
        revision = len(history)
        if expected_revision is not None and expected_revision != revision:
            return RightsDecisionReadResult(status="CONFLICT", current_revision=revision)
        if not history:
            if expected_decision_id is not None or expected_content_hash is not None:
                return RightsDecisionReadResult(status="CONFLICT", current_revision=0)
            return RightsDecisionReadResult(status="NO_DECISION", current_revision=0)
        latest = history[-1]
        if (expected_decision_id is not None and expected_decision_id != latest.decision_id) or (
            expected_content_hash is not None
            and expected_content_hash != latest.decision_content_hash
        ):
            return RightsDecisionReadResult(status="CONFLICT", current_revision=revision)
        return RightsDecisionReadResult(
            status="VERIFIED",
            current_revision=revision,
            decision=AuthoritativeRightsDecision(
                project_id=project_id,
                asset_id=asset_id,
                version_id=version_id,
                asset_sha256=asset_sha256,
                decision_id=latest.decision_id,
                revision=revision,
                decision=latest.decision,
                previous_decision_id=latest.previous_decision_id,
                decision_content_hash=latest.decision_content_hash,
                evidence_sha256=latest.evidence_sha256,
                actor_id=latest.actor_id,
                chain_integrity=True,
            ),
        )
    finally:
        connection.close()


def read_latest_rights_decision(
    database_path: Path,
    project_id: str,
    asset_id: str,
    version_id: str,
    *,
    expected_revision: int | None = None,
    expected_decision_id: str | None = None,
    expected_content_hash: str | None = None,
) -> RightsDecisionReadResult:
    """Return the latest authority or an explicit non-authoritative state.

    The immutable AssetVersionData.rights_status remains PENDING_REVIEW. A
    VERIFIED/CLEARED latest decision supersedes that legacy pending field for
    this exact version, but is a human declaration, not proof of legal rights.
    Final export still needs an atomic claim-time head CAS.
    """

    if (
        _PROJECT.fullmatch(project_id) is None
        or _ASSET.fullmatch(asset_id) is None
        or _VERSION.fullmatch(version_id) is None
    ):
        return RightsDecisionReadResult(status="NOT_FOUND")
    if (
        (
            expected_revision is not None
            and (
                isinstance(expected_revision, bool)
                or not isinstance(expected_revision, int)
                or expected_revision < 0
            )
        )
        or (expected_decision_id is not None and _DECISION.fullmatch(expected_decision_id) is None)
        or (expected_content_hash is not None and _HASH.fullmatch(expected_content_hash) is None)
    ):
        return RightsDecisionReadResult(status="CONFLICT")
    if os.name != "nt":
        return RightsDecisionReadResult(status="UNKNOWN_UNSUPPORTED_PLATFORM")
    if not database_path.is_absolute() or _is_remote_windows_path(database_path):
        return RightsDecisionReadResult(status="UNKNOWN_UNSAFE_PATH")
    if not _plain_directory(database_path.parent) or database_path.is_symlink():
        return RightsDecisionReadResult(status="UNKNOWN_UNSAFE_PATH")
    try:
        initial = database_path.stat()
    except FileNotFoundError:
        return RightsDecisionReadResult(status="UNKNOWN_DATABASE")
    except OSError:
        return RightsDecisionReadResult(status="UNKNOWN_UNSAFE_PATH")
    if not stat.S_ISREG(initial.st_mode) or initial.st_size <= 0:
        return RightsDecisionReadResult(status="UNKNOWN_DATABASE")
    if initial.st_size > MAX_DATABASE_BYTES:
        return RightsDecisionReadResult(status="UNKNOWN_READ_BUDGET")
    sidecars_ok, sidecars_before = _sidecar_state(database_path)
    if not sidecars_ok:
        return RightsDecisionReadResult(status="UNKNOWN_DATABASE_BUSY")

    deadline = time.monotonic() + MAX_READ_SECONDS
    try:
        with _open_local_source(database_path) as stream:
            opened = os.fstat(stream.fileno())
            if (
                opened.st_dev != initial.st_dev
                or opened.st_ino != initial.st_ino
                or opened.st_size != initial.st_size
                or opened.st_mtime_ns != initial.st_mtime_ns
            ):
                return RightsDecisionReadResult(status="UNKNOWN_DATABASE_CHANGED")
            before_hash, before_bytes = _hash_stream(
                stream,
                maximum=MAX_DATABASE_BYTES,
                deadline=deadline,
            )
            if before_bytes != opened.st_size:
                return RightsDecisionReadResult(status="UNKNOWN_DATABASE_CHANGED")
            try:
                result = _read_database(
                    database_path,
                    project_id,
                    asset_id,
                    version_id,
                    expected_revision,
                    expected_decision_id,
                    expected_content_hash,
                )
            except sqlite3.Error:
                return RightsDecisionReadResult(status="UNKNOWN_DATABASE")
            stream.seek(0)
            after_hash, after_bytes = _hash_stream(
                stream,
                maximum=MAX_DATABASE_BYTES,
                deadline=deadline,
            )
            closed = os.fstat(stream.fileno())
            try:
                path_after = database_path.stat()
            except OSError:
                return RightsDecisionReadResult(status="UNKNOWN_DATABASE_CHANGED")
            sidecars_ok, sidecars_after = _sidecar_state(database_path)
            if (
                not sidecars_ok
                or sidecars_after != sidecars_before
                or after_hash != before_hash
                or after_bytes != opened.st_size
                or closed.st_dev != opened.st_dev
                or closed.st_ino != opened.st_ino
                or closed.st_size != opened.st_size
                or closed.st_mtime_ns != opened.st_mtime_ns
                or path_after.st_dev != opened.st_dev
                or path_after.st_ino != opened.st_ino
                or path_after.st_size != opened.st_size
                or path_after.st_mtime_ns != opened.st_mtime_ns
            ):
                return RightsDecisionReadResult(status="UNKNOWN_DATABASE_CHANGED")
            return result
    except _ReadBudgetExceeded:
        return RightsDecisionReadResult(status="UNKNOWN_READ_BUDGET")
    except OSError:
        return RightsDecisionReadResult(status="UNKNOWN_DATABASE_BUSY")
