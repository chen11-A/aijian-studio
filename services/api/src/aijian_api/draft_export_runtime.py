"""Owner-lock-scoped, local-only DRAFT jobs over saved EpisodeMediaAssembly bytes.

No release claims, reviews, rights decisions, or asset versions are changed here.
Unknown/interrupted operations never restart automatically.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import stat
import threading
import time
import unicodedata
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

from aijian_api.artifacts import canonical_content_hash
from aijian_api.draft_export_contracts import CreateDraftExportRequest, DraftExportJob
from aijian_api.draft_subtitles import DraftSubtitleError, validate_draft_subtitles
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyVersionData
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore, _media_refs
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_probe import _is_remote_windows_path, _open_local_source
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_output_verify import _guarded_file_hash
from aijian_api.product_export_windows_job import ProductExportJobManager
from aijian_api.repository import StudioRepository

ACTIVE = {"QUEUED", "RUNNING", "VERIFYING"}
MAX_SOURCE_BYTES = 1024 * 1024 * 1024
MAX_JOB_BYTES = 2 * MAX_SOURCE_BYTES


class DraftExportError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


def _target(value: str) -> Path:
    path = Path(value)
    if (
        not path.is_absolute()
        or _is_remote_windows_path(path)
        or path.suffix.lower() != ".mp4"
        or len(path.name) > 180
        or any(ord(char) < 32 or char in '<>:"|?*' for char in path.name)
        or path.name.endswith((" ", "."))
    ):
        raise DraftExportError(
            "OUTPUT_PATH_UNSAFE", "Choose a local MP4 filename in an existing folder"
        )
    try:
        managed_local_io_path(path.parent, path)
        parent = managed_local_io_path(path.parent, path.parent)
        if not parent.is_dir():
            raise ValueError("parent")
    except (OSError, ValueError):
        raise DraftExportError(
            "OUTPUT_PATH_UNSAFE", "Output folder is unavailable or contains a link"
        ) from None
    return path


def _reservation(target: Path) -> Path:
    return target.parent / f".{target.name}.aivora-draft-reservation"


def _temporary(target: Path, operation_id: str) -> Path:
    return target.parent / f".{operation_id}.partial.mp4"


def _snapshot(
    source: Path,
    destination: Path | None,
    expected: str,
    expected_size: int,
    stopped: Callable[[], bool],
) -> int:
    """Copy/hash an immutable original with bounded bytes/time and identity checks."""
    start = time.monotonic()
    try:
        source_io = managed_local_io_path(source.parent, source)
        with _open_local_source(source_io) as stream:
            first = os.fstat(stream.fileno())
            if (
                not stat.S_ISREG(first.st_mode)
                or not 0 < first.st_size == expected_size <= MAX_SOURCE_BYTES
            ):
                raise DraftExportError(
                    "SOURCE_SIZE", "A selected original exceeds the 1 GiB draft limit"
                )
            digest = hashlib.sha256()
            total = 0
            output = (
                None
                if destination is None
                else managed_local_io_path(
                    destination.parent,
                    destination,
                ).open("xb")
            )
            try:
                while chunk := stream.read(1024 * 1024):
                    if stopped():
                        raise DraftExportError("CANCELLED", "Draft export was cancelled")
                    total += len(chunk)
                    if total > expected_size or time.monotonic() - start > 120:
                        raise DraftExportError(
                            "SOURCE_LIMIT", "Original verification exceeded its limit"
                        )
                    digest.update(chunk)
                    if output is not None:
                        output.write(chunk)
                if output is not None:
                    output.flush()
                    os.fsync(output.fileno())
            finally:
                if output is not None:
                    output.close()
            last = os.fstat(stream.fileno())
            named = source_io.stat()

            def identity(item: os.stat_result) -> tuple[int, int, int, int]:
                return (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns)

            if identity(first) != identity(last) or identity(first) != identity(named):
                raise DraftExportError(
                    "SOURCE_CHANGED", "Selected original changed during verification"
                )
            if total != expected_size or digest.hexdigest() != expected:
                raise DraftExportError(
                    "SOURCE_CHANGED", "Selected original differs from its saved hash"
                )
            return total
    except DraftExportError:
        raise
    except (OSError, ValueError):
        raise DraftExportError(
            "SOURCE_UNAVAILABLE", "Selected original is missing or unsafe"
        ) from None


class DraftExportRuntime:
    def __init__(
        self,
        repository: StudioRepository,
        toolchain_provider: Callable[[], MediaToolchain],
        job_manager: ProductExportJobManager | None = None,
    ) -> None:
        self.repository = repository
        self._tools = toolchain_provider
        self._jobs = job_manager
        self._lock = threading.RLock()
        self._closing = False
        self._workers: dict[str, threading.Thread] = {}
        self._cancel: dict[str, threading.Event] = {}
        # The caller holds the exclusive workspace owner lock before constructing.
        with repository._connection() as connection:
            connection.execute(
                "UPDATE draft_export_jobs SET status='INTERRUPTED', updated_at=?, "
                "error_code='PROCESS_INTERRUPTED', error_message=? "
                "WHERE status IN ('QUEUED','RUNNING','VERIFYING')",
                (_now(), "The previous process stopped; no successful output is claimed"),
            )
            connection.commit()

    def _read_assembly(
        self, project: str, episode: str, request: CreateDraftExportRequest
    ) -> EpisodeMediaAssemblyVersionData:
        assembly = EpisodeMediaAssemblyStore(self.repository).read_version(
            project,
            episode,
            version_id=request.assembly_version_id,
        )
        content = assembly.content
        if (
            assembly.content_hash != request.assembly_content_hash
            or canonical_content_hash(
                content.model_dump(mode="json"),
            )
            != assembly.content_hash
        ):
            raise DraftExportError("ASSEMBLY_CHANGED", "Saved assembly version/hash does not match")
        rate = content.sequence_timebase.frame_rate
        if (
            len(content.visual_segments) > 32
            or len(content.audio_segments) > 32
            or content.total_frames * rate.den > 1800 * rate.num
            or max(content.canvas_width, content.canvas_height) > 1920
            or content.canvas_width % 2
            or content.canvas_height % 2
        ):
            raise DraftExportError(
                "DRAFT_LIMIT",
                "Draft supports 32 visual/32 audio clips, 30 minutes, even dimensions up to 1920",
            )
        try:
            validate_draft_subtitles(content)
        except DraftSubtitleError as error:
            raise DraftExportError(error.code, str(error)) from None
        if any(check.rights_status == "RESTRICTED" for check in assembly.media_checks):
            raise DraftExportError(
                "RIGHTS_RESTRICTED", "Restricted media cannot be exported as a draft"
            )
        if any(
            check.availability not in {"VERIFIED", "UNVERIFIED_SIZE_LIMIT"}
            for check in assembly.media_checks
        ):
            raise DraftExportError(
                "SOURCE_UNAVAILABLE", "Selected original bytes are missing, changed or unsafe"
            )
        return assembly

    def _row(self, project: str, episode: str, operation: str) -> sqlite3.Row:
        # A timed-out POST may still be hashing before its INSERT. Readback
        # must wait for that submit decision before returning a definitive 404.
        with self._lock, self.repository._connection() as connection:
            row = connection.execute(
                "SELECT * FROM draft_export_jobs "
                "WHERE project_id=? AND episode_id=? AND operation_id=?",
                (project, episode, operation),
            ).fetchone()
        if row is None:
            raise DraftExportError("NOT_FOUND", "Draft export was not found in this episode")
        return cast(sqlite3.Row, row)

    def _data(self, row: sqlite3.Row) -> DraftExportJob:
        succeeded = row["status"] == "SUCCEEDED"
        return DraftExportJob(
            operation_id=row["operation_id"],
            project_id=row["project_id"],
            episode_id=row["episode_id"],
            assembly_version_id=row["assembly_version_id"],
            assembly_content_hash=row["assembly_content_hash"],
            status=row["status"],
            progress_frames=row["progress_frames"],
            total_frames=row["total_frames"],
            output_filename=Path(row["output_path"]).name,
            output_path=row["output_path"] if succeeded else None,
            output_sha256=row["output_sha256"] if succeeded else None,
            output_bytes=row["output_bytes"] if succeeded else None,
            error_code=row["error_code"],
            error_message=row["error_message"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            toolchain_profile_id=row["toolchain_profile_id"],
        )

    def get(self, project: str, episode: str, operation: str) -> DraftExportJob:
        row = self._row(project, episode, operation)
        if row["status"] == "SUCCEEDED":
            try:
                digest, size = _guarded_file_hash(Path(row["output_path"]))
                if digest != row["output_sha256"] or size != row["output_bytes"]:
                    raise ValueError("changed")
            except (OSError, ValueError):
                self._update(
                    operation,
                    status="FAILED",
                    error_code="OUTPUT_CHANGED",
                    error_message="The completed draft file is now missing or changed",
                )
                row = self._row(project, episode, operation)
        return self._data(row)

    def list(self, project: str, episode: str) -> list[DraftExportJob]:
        with self._lock, self.repository._connection() as connection:
            rows = connection.execute(
                "SELECT operation_id FROM draft_export_jobs WHERE project_id=? AND episode_id=? "
                "ORDER BY created_at DESC LIMIT 20",
                (project, episode),
            ).fetchall()
        return [self.get(project, episode, row["operation_id"]) for row in rows]

    def _update(self, operation: str, **changes: object) -> None:
        allowed = {
            "status",
            "progress_frames",
            "cancel_requested",
            "output_sha256",
            "output_bytes",
            "verification_json",
            "error_code",
            "error_message",
        }
        if not changes or not set(changes) <= allowed:
            raise ValueError("invalid receipt update")
        with self.repository._connection() as connection:
            connection.execute(
                "UPDATE draft_export_jobs SET "
                + ", ".join(f"{key}=?" for key in changes)
                + ", updated_at=? WHERE operation_id=?",
                (*changes.values(), _now(), operation),
            )
            connection.commit()

    def submit(
        self, project: str, episode: str, request: CreateDraftExportRequest
    ) -> DraftExportJob:
        with self._lock:
            if self._closing:
                raise DraftExportError("SHUTTING_DOWN", "Draft export is shutting down")
            request_hash = canonical_content_hash(
                {"project": project, "episode": episode, **request.model_dump(mode="json")}
            )
            with self.repository._connection() as connection:
                existing = connection.execute(
                    "SELECT * FROM draft_export_jobs WHERE operation_id=?", (request.operation_id,)
                ).fetchone()
            if existing is not None:
                if existing["request_hash"] != request_hash:
                    raise DraftExportError(
                        "OPERATION_CONFLICT", "Operation ID belongs to a different request"
                    )
                return self.get(project, episode, request.operation_id)
            if any(worker.is_alive() for worker in self._workers.values()):
                raise DraftExportError(
                    "EXPORT_BUSY", "Wait for or cancel the current local draft export"
                )
            assembly = self._read_assembly(project, episode, request)
            toolchain = self._tools()
            target = _target(request.output_path)
            target_io = managed_local_io_path(target.parent, target)
            if target_io.exists():
                raise DraftExportError(
                    "OUTPUT_EXISTS", "Choose a new filename; draft export never overwrites files"
                )
            reservation = managed_local_io_path(target.parent, _reservation(target))
            try:
                with reservation.open("xb") as stream:
                    stream.write(request.operation_id.encode("ascii"))
                    stream.flush()
                    os.fsync(stream.fileno())
            except FileExistsError:
                raise DraftExportError(
                    "OUTPUT_RESERVED", "Output filename is already reserved; choose a new name"
                ) from None
            now = _now()
            provenance = {
                "draft": True,
                "rights_declaration": request.rights_declaration,
                "declaration_actor": "local-native-user",
                "declared_at": now,
                "assembly": assembly.model_dump(mode="json"),
                "toolchain": {
                    "profile_id": toolchain.profile_id,
                    "version": toolchain.version,
                    "ffmpeg_sha256": toolchain.ffmpeg_sha256,
                    "ffprobe_sha256": toolchain.ffprobe_sha256,
                    "distribution_status": toolchain.distribution_status,
                },
            }
            target_key = canonical_content_hash(
                unicodedata.normalize("NFC", str(target)).casefold()
            )
            try:
                with self.repository._connection() as connection:
                    connection.execute(
                        "INSERT INTO draft_export_jobs (operation_id, project_id, episode_id, "
                        "assembly_version_id, assembly_content_hash, request_hash, request_json, "
                        "provenance_json, target_key, output_path, status, total_frames, "
                        "toolchain_profile_id, created_at, updated_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            request.operation_id,
                            project,
                            episode,
                            request.assembly_version_id,
                            request.assembly_content_hash,
                            request_hash,
                            request.model_dump_json(),
                            json.dumps(provenance, sort_keys=True),
                            target_key,
                            str(target),
                            "QUEUED",
                            assembly.content.total_frames,
                            toolchain.profile_id,
                            now,
                            now,
                        ),
                    )
                    connection.commit()
            except sqlite3.IntegrityError:
                self._remove_reservation(target, request.operation_id)
                raise DraftExportError(
                    "OUTPUT_RESERVED",
                    "This output name already has a receipt; choose a new filename",
                ) from None
            except BaseException:
                self._remove_reservation(target, request.operation_id)
                raise
            event = threading.Event()
            worker = threading.Thread(
                target=self._run,
                args=(project, episode, request, assembly, toolchain, event),
                name=f"draft-export-{request.operation_id}",
                daemon=False,
            )
            self._cancel[request.operation_id] = event
            self._workers[request.operation_id] = worker
            queued = self._data(self._row(project, episode, request.operation_id))
            try:
                worker.start()
            except BaseException:
                self._workers.pop(request.operation_id, None)
                self._cancel.pop(request.operation_id, None)
                self._update(
                    request.operation_id,
                    status="FAILED",
                    error_code="WORKER_START_FAILED",
                    error_message="Draft worker could not start; no output was created",
                )
                self._remove_reservation(target, request.operation_id)
                raise
            return queued

    def cancel(self, project: str, episode: str, operation: str) -> DraftExportJob:
        with self._lock:
            row = self._row(project, episode, operation)
            if row["status"] in ACTIVE:
                self._update(operation, cancel_requested=1)
                event = self._cancel.get(operation)
                if event is not None:
                    event.set()
            return self.get(project, episode, operation)

    @staticmethod
    def _remove_reservation(target: Path, operation: str) -> None:
        try:
            path = managed_local_io_path(target.parent, _reservation(target))
            with _open_local_source(path) as stream:
                if stream.read(100) != operation.encode("ascii"):
                    return
            path.unlink()
        except (OSError, ValueError):
            pass

    def _run(
        self,
        project: str,
        episode: str,
        request: CreateDraftExportRequest,
        assembly: EpisodeMediaAssemblyVersionData,
        tools: MediaToolchain,
        event: threading.Event,
    ) -> None:
        from aijian_api.draft_export_encoder import encode_draft

        operation = request.operation_id
        target = Path(request.output_path)
        temporary = _temporary(target, operation)
        created: list[Path] = []
        work: Path | None = None
        published = False

        def stopped() -> bool:
            return event.is_set() or self._closing

        try:
            self._update(operation, status="RUNNING")
            workspace = self.repository.database_path.parent.absolute()
            root = workspace / "draft-export-work"
            root_io = managed_local_io_path(workspace, root)
            root_io.mkdir(exist_ok=True, mode=0o700)
            work = root / operation
            managed_local_io_path(workspace, work).mkdir(mode=0o700)
            sources: dict[str, Path] = {}
            originals: dict[str, tuple[Path, int]] = {}
            total = 0
            for media, _kind in _media_refs(assembly.content):
                with self.repository._connection() as connection:
                    row = connection.execute(
                        "SELECT byte_size FROM media_asset_versions "
                        "WHERE project_id=? AND asset_id=? AND id=? AND sha256=?",
                        (project, media.asset_id, media.asset_version_id, media.sha256),
                    ).fetchone()
                if row is None:
                    raise DraftExportError(
                        "SOURCE_UNAVAILABLE", "Selected media version no longer exists"
                    )
                digest = media.sha256
                if digest in sources:
                    continue
                source = workspace / "media-assets" / "blobs" / digest[:2] / digest
                snapshot = work / digest
                created.append(snapshot)
                total += _snapshot(source, snapshot, digest, int(row["byte_size"]), stopped)
                if total > MAX_JOB_BYTES:
                    raise DraftExportError(
                        "SOURCE_LIMIT", "Draft originals exceed the 2 GiB total limit"
                    )
                sources[digest] = snapshot
                originals[digest] = (source, int(row["byte_size"]))
            if stopped():
                raise DraftExportError("CANCELLED", "Draft export was cancelled")
            verified = encode_draft(
                assembly,
                sources,
                temporary,
                tools,
                on_progress=lambda frame: self._update(
                    operation, progress_frames=max(0, min(frame, assembly.content.total_frames))
                ),
                stop_requested=stopped,
                job_manager=self._jobs,
            )
            self._update(operation, status="VERIFYING")
            for digest, (source, size) in originals.items():
                _snapshot(source, None, digest, size, stopped)
            # Serialize cancellation against final publish + receipt. Cancellation
            # arriving after the successful receipt cannot erase a completed file.
            with self._lock, self.repository._connection() as connection:
                if stopped():
                    raise DraftExportError(
                        "CANCELLED", "Draft export was cancelled before publishing"
                    )
                # Exclude concurrent rights/asset writes between the final
                # check and receipt. The read uses a separate read-only connection.
                connection.execute("BEGIN IMMEDIATE")
                self._read_assembly(project, episode, request)
                temp_io = managed_local_io_path(target.parent, temporary)
                target_io = managed_local_io_path(target.parent, target)
                if _guarded_file_hash(temporary) != (verified.sha256, verified.byte_size):
                    raise DraftExportError("OUTPUT_CHANGED", "Verified temporary output changed")
                # Atomic create-if-absent; unlike rename on POSIX this never replaces a file.
                os.link(temp_io, target_io)
                published = True
                # Completed-file access rejects hard-link aliases. Remove the
                # operation's temporary alias before committing success, so a
                # crash after the receipt cannot leave a valid output unplayable.
                temp_io.unlink()
                if _guarded_file_hash(target) != (verified.sha256, verified.byte_size):
                    raise DraftExportError(
                        "OUTPUT_CHANGED", "Published output changed before receipt"
                    )
                connection.execute(
                    "UPDATE draft_export_jobs SET status='SUCCEEDED', progress_frames=?, "
                    "output_sha256=?, output_bytes=?, verification_json=?, updated_at=? "
                    "WHERE operation_id=?",
                    (
                        assembly.content.total_frames,
                        verified.sha256,
                        verified.byte_size,
                        verified.probe_json,
                        _now(),
                        operation,
                    ),
                )
                connection.commit()
        except Exception as error:
            code = str(getattr(error, "code", "DRAFT_EXPORT_FAILED"))
            interrupted = self._closing or published
            status = (
                "INTERRUPTED"
                if interrupted
                else "CANCELLED"
                if event.is_set() or code == "CANCELLED"
                else "FAILED"
            )
            message = (
                "The draft operation stopped without a successful verified receipt"
                if interrupted
                else str(error)
                if hasattr(error, "code")
                else "Draft export failed; inspect the local log and choose a new filename"
            )
            try:
                self._update(operation, status=status, error_code=code, error_message=message)
            except Exception:
                logging.getLogger(__name__).exception(
                    "Cannot persist draft export failure %s", operation
                )
            logging.getLogger(__name__).warning("Draft export %s ended: %s", operation, code)
        finally:
            # Remove only our unique temporary/snapshot names; never delete the final file.
            for path in [temporary, *created]:
                try:
                    managed_local_io_path(path.parent, path).unlink(missing_ok=True)
                except (OSError, ValueError):
                    pass
            if work is not None:
                try:
                    managed_local_io_path(work.parent, work).rmdir()
                except (OSError, ValueError):
                    pass
            self._remove_reservation(target, operation)

    def stop_accepting(self) -> None:
        with self._lock:
            self._closing = True
            for event in self._cancel.values():
                event.set()

    def join_workers(self, timeout_seconds: float = 15.0) -> None:
        self.stop_accepting()
        deadline = time.monotonic() + timeout_seconds
        for worker in tuple(self._workers.values()):
            worker.join(max(0, deadline - time.monotonic()))
        if any(worker.is_alive() for worker in self._workers.values()):
            raise RuntimeError("Draft export workers did not stop before workspace release")
