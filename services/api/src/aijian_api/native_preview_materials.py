"""Private source preparation, consumed by the registered parent-pipe owner.

No new HTTP route, probe or encoder; the compiled native release policy is empty.

Caller must supply its protected private process session, and retain this lease until
its Windows Job proves zero active processes. Never release on UNKNOWN/timeout.
"""

from __future__ import annotations

import secrets
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from threading import RLock

from aijian_api.draft_export_runtime import _snapshot
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_execution_plan_contracts import MediaExecutionPlanReceiptV1
from aijian_api.media_preview_plan_routes import derive_native_preview_plan
from aijian_api.repository import StudioRepository


class NativePreviewMaterialError(ValueError):
    """Private material differs from the frozen source or ownership is unconfirmed."""


@dataclass(frozen=True, slots=True)
class NativePreviewOwnedSource:
    asset_id: str
    asset_version_id: str
    sha256: str
    byte_size: int
    path: Path


class NativePreviewSourceLease:
    def __init__(
        self,
        repository: StudioRepository,
        receipt: MediaExecutionPlanReceiptV1,
        directory: Path,
        sources: tuple[NativePreviewOwnedSource, ...],
    ) -> None:
        self.repository = repository
        self.receipt = receipt
        self.directory = directory
        self.sources = sources
        self._launch_started = False
        self._released = False
        self._lock = RLock()

    def recheck_before_launch(self) -> None:
        if self._released or self._launch_started:
            raise NativePreviewMaterialError("Source lease is no longer pending launch")
        source = self.receipt.plan.source
        if source.assembly_version_id is None:
            raise NativePreviewMaterialError("Native source must have an exact assembly version")
        fresh = derive_native_preview_plan(
            self.repository, source.project_id, source.episode_id, source.assembly_version_id
        )
        if fresh != self.receipt:
            raise NativePreviewMaterialError("Exact fresh native plan changed before launch")
        workspace = self.repository.database_path.parent.absolute()
        for item in self.sources:
            original = workspace / "media-assets" / "blobs" / item.sha256[:2] / item.sha256
            _snapshot(original, None, item.sha256, item.byte_size, lambda: False)
            _snapshot(item.path, None, item.sha256, item.byte_size, lambda: False)

    def dispatch_under_admission[T](self, dispatch: Callable[[], T]) -> T:
        """Serialize final rights/G5 admission with synchronous native dispatch.

        Hashing may be slow, so do it before the database writer gate. Then derive
        again while BEGIN IMMEDIATE excludes *all* concurrent database writers.
        The callback must synchronously settle the owner's start path (including
        a partial start) before returning or raising. It must not schedule a later
        dispatch, wait on a writer, or release the owned source lease.
        """
        with self._lock:
            self.recheck_before_launch()
            source = self.receipt.plan.source
            assert source.assembly_version_id is not None
            with self.repository._connection() as gate:
                gate.execute("BEGIN IMMEDIATE")
                fresh = derive_native_preview_plan(
                    self.repository,
                    source.project_id,
                    source.episode_id,
                    source.assembly_version_id,
                )
                if fresh != self.receipt:
                    raise NativePreviewMaterialError("Exact fresh native plan changed at dispatch")
                # Mark before dispatch: a callback failure can have created a
                # process, so failure never authorizes unsealing its source.
                self._launch_started = True
                try:
                    return dispatch()
                finally:
                    # No writes: rollback also releases the writer exclusion
                    # after partial ownership is recorded by the native owner.
                    gate.rollback()

    def release(self, *, owned_processes_stopped: bool = False) -> None:
        with self._lock:
            if self._released:
                return
            if self._launch_started and not owned_processes_stopped:
                raise NativePreviewMaterialError("Owned native termination has not been proved")
            # Delete only this lease's generated names. Original workspace files are never removed.
            for path in {item.path for item in self.sources}:
                managed_local_io_path(self.directory, path).unlink(missing_ok=True)
            self.directory.rmdir()
            self._released = True


def prepare_native_preview_sources(
    repository: StudioRepository,
    expected: MediaExecutionPlanReceiptV1,
    *,
    private_session: Path,
) -> NativePreviewSourceLease:
    """Derive exact fresh source again, snapshot selected originals, then recheck.

    ``private_session`` is an internally owned protected session, never renderer input.
    The registered private owner consumes this helper only after compiled reviewed
    release admission. Its current release list is empty; Windows proof is absent.
    """
    receipt = MediaExecutionPlanReceiptV1.model_validate(expected.model_dump(mode="json"))
    source = receipt.plan.source
    if (
        receipt.plan.scope != "DRAFT_PREVIEW"
        or source.origin != "EPISODE_ASSEMBLY"
        or source.assembly_version_id is None
    ):
        raise NativePreviewMaterialError("Engineering TEST cannot enter native product preparation")
    fresh = derive_native_preview_plan(
        repository, source.project_id, source.episode_id, source.assembly_version_id
    )
    if fresh != receipt:
        raise NativePreviewMaterialError("Frozen native plan does not match fresh exact saved data")
    directory = private_session / ("native-sources-" + secrets.token_hex(16))
    managed_local_io_path(private_session, directory).mkdir(mode=0o700)
    sources: list[NativePreviewOwnedSource] = []
    created: set[Path] = set()
    selected: set[tuple[str, str]] = set()
    total = 0
    try:
        workspace = repository.database_path.parent.absolute()
        for track in receipt.plan.video_tracks:
            for clip in track.clips:
                media = clip.media
                key = media.asset_id, media.asset_version_id
                if key in selected:
                    continue
                selected.add(key)
                original = workspace / "media-assets" / "blobs" / media.sha256[:2] / media.sha256
                # Separate names preserve the exact asset/version identity even if bytes match.
                destination = directory / (media.asset_version_id + ".source")
                created.add(destination)
                total += _snapshot(
                    original, destination, media.sha256, media.byte_size, lambda: False
                )
                if total > 2 * 1024 * 1024 * 1024:
                    raise NativePreviewMaterialError("Native selected sources exceed 2 GiB")
                sources.append(
                    NativePreviewOwnedSource(
                        media.asset_id,
                        media.asset_version_id,
                        media.sha256,
                        media.byte_size,
                        destination,
                    )
                )
        lease = NativePreviewSourceLease(repository, receipt, directory, tuple(sources))
        lease.recheck_before_launch()
        return lease
    except BaseException:
        for path in created:
            managed_local_io_path(directory, path).unlink(missing_ok=True)
        directory.rmdir()
        raise
