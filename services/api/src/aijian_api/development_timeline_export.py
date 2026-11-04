"""Development-only timeline MP4 export service and API models."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from re import fullmatch
from typing import Annotated, Literal

from pydantic import UUID4, BaseModel, ConfigDict, Field

from aijian_api.artifacts import canonical_content_hash
from aijian_api.fake_media_package import FakeMediaPackageV1
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.timeline import TimelineVersionV1
from aijian_api.timeline_export import (
    TimelineExportError,
    TimelineExportPurpose,
    TimelineMediaBinding,
    export_timeline_mp4,
)

PROJECT_ID_PATTERN = r"^prj_[0-9a-f]{32}$"
VERSION_ID_PATTERN = r"^ver_[0-9a-f]{32}$"
EXPORT_ID_PATTERN = r"^dex_[0-9a-f]{32}$"
CONTENT_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"
EXPORT_RELATIVE_PATH_PATTERN = (
    r"^exports/development-timeline/prj_[0-9a-f]{32}/dex_[0-9a-f]{32}\.mp4$"
)


class DevelopmentTimelineExportInvalidError(ValueError):
    """The export request or selected timeline cannot be exported."""


class DevelopmentTimelineExportPreflightRejectedError(DevelopmentTimelineExportInvalidError):
    """This request was rejected before claiming a development export operation."""

    def __init__(
        self,
        project_id: str,
        operation_id: str,
        timeline_version_id: str,
        expected_revision: int,
    ) -> None:
        super().__init__("Development export request rejected before export claim")
        self.project_id = project_id
        self.operation_id = operation_id
        self.timeline_version_id = timeline_version_id
        self.expected_revision = expected_revision


class DevelopmentTimelineExportConflictError(RuntimeError):
    """The operation identity conflicts with a durable export receipt."""


class DevelopmentTimelineExportNotFoundError(LookupError):
    """The requested development export receipt does not exist."""


class DevelopmentTimelineExportUnknownError(RuntimeError):
    """The export started but its final result cannot be confirmed."""

    def __init__(self, project_id: str, operation_id: str) -> None:
        super().__init__(
            "Development export result is unknown; query this operation before retrying"
        )
        self.project_id = project_id
        self.operation_id = operation_id


class CreateDevelopmentTimelineExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    operation_id: UUID4
    timeline_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    expected_revision: int = Field(strict=True, ge=1)
    purpose: Literal["DEVELOPMENT_EVIDENCE"]


class DevelopmentTimelineExportOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    workspace_scope: Literal["SIDECAR_WORKSPACE"]
    relative_path: str = Field(pattern=EXPORT_RELATIVE_PATH_PATTERN)
    mime_type: Literal["video/mp4"]
    sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    byte_length: int = Field(strict=True, gt=0)
    width: Literal[1080]
    height: Literal[1920]
    frame_rate_num: int = Field(strict=True, gt=0)
    frame_rate_den: int = Field(strict=True, gt=0)
    duration_frames: int = Field(strict=True, gt=0)
    duration_seconds: float = Field(strict=True, gt=0)
    has_audio: bool


class DevelopmentTimelineExportSucceededData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["SUCCEEDED"]
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    export_id: str = Field(pattern=EXPORT_ID_PATTERN)
    operation_id: UUID4
    timeline_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    timeline_content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    timeline_revision: int = Field(strict=True, ge=1)
    purpose: Literal["DEVELOPMENT_EVIDENCE"]
    output: DevelopmentTimelineExportOutput


class DevelopmentTimelineExportUnknownData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["UNKNOWN"]
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    export_id: str = Field(pattern=EXPORT_ID_PATTERN)
    operation_id: UUID4
    timeline_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    timeline_content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    timeline_revision: int = Field(strict=True, ge=1)
    purpose: Literal["DEVELOPMENT_EVIDENCE"]
    error_code: Literal["REMOTE_UNKNOWN"]
    message: str = Field(min_length=1, max_length=500)


DevelopmentTimelineExportData = Annotated[
    DevelopmentTimelineExportSucceededData | DevelopmentTimelineExportUnknownData,
    Field(discriminator="status"),
]


class DevelopmentTimelineExportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: DevelopmentTimelineExportData
    request_id: uuid.UUID


class _StoredExport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: str
    operation_id: str
    request_hash: str
    export_id: str
    timeline_version_id: str
    expected_revision: int
    purpose: str
    status: Literal["PENDING", "SUCCEEDED", "UNKNOWN"]
    timeline_content_hash: str
    timeline_revision: int
    relative_path: str | None
    output_sha256: str | None
    byte_length: int | None
    width: int | None
    height: int | None
    frame_rate_num: int | None
    frame_rate_den: int | None
    duration_frames: int | None
    duration_seconds: float | None
    has_audio: bool | None
    message: str | None
    created_at: str
    updated_at: str


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _request_hash(project_id: str, payload: CreateDevelopmentTimelineExportRequest) -> str:
    return canonical_content_hash(
        {
            "project_id": project_id,
            "timeline_version_id": payload.timeline_version_id,
            "expected_revision": payload.expected_revision,
            "purpose": payload.purpose,
        }
    )


def _safe_workspace_root(path: Path) -> Path:
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        raise DevelopmentTimelineExportInvalidError("sidecar workspace is unavailable") from None
    if not resolved.is_dir() or not resolved.is_absolute():
        raise DevelopmentTimelineExportInvalidError("sidecar workspace is invalid")
    return resolved


def _require_project_id(project_id: str) -> None:
    if fullmatch(PROJECT_ID_PATTERN, project_id) is None:
        raise DevelopmentTimelineExportInvalidError("project id is invalid")


def _contained_file(path: Path, root: Path, *, label: str) -> Path:
    try:
        metadata = path.lstat()
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        raise DevelopmentTimelineExportInvalidError(f"{label} is unavailable") from None
    if path.is_symlink() or not resolved.is_file() or not resolved.is_relative_to(root):
        raise DevelopmentTimelineExportInvalidError(f"{label} is outside the workspace")
    if bool(getattr(metadata, "st_file_attributes", 0) & 0x400):
        raise DevelopmentTimelineExportInvalidError(f"{label} is a reparse point")
    return resolved


def _contained_directory(path: Path, root: Path, *, label: str) -> Path:
    try:
        metadata = path.lstat()
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        raise DevelopmentTimelineExportInvalidError(f"{label} is unavailable") from None
    if path.is_symlink() or not resolved.is_dir() or not resolved.is_relative_to(root):
        raise DevelopmentTimelineExportInvalidError(f"{label} is outside the workspace")
    if bool(getattr(metadata, "st_file_attributes", 0) & 0x400):
        raise DevelopmentTimelineExportInvalidError(f"{label} is a reparse point")
    return resolved


def _media_bindings(
    workspace_root: Path,
    project_id: str,
    timeline: TimelineVersionV1,
) -> tuple[TimelineMediaBinding, ...]:
    package_binding = timeline.media_package
    if package_binding is None:
        raise DevelopmentTimelineExportInvalidError("timeline has no development media package")
    package_root = _contained_directory(
        workspace_root / "fake-media" / "v1" / project_id / package_binding.media_package_id,
        workspace_root,
        label="timeline media package",
    )
    manifest_path = _contained_file(
        package_root / package_binding.manifest_relative_path,
        package_root,
        label="timeline media manifest",
    )
    try:
        manifest = FakeMediaPackageV1.model_validate_json(manifest_path.read_bytes())
    except (OSError, ValueError):
        raise DevelopmentTimelineExportInvalidError("timeline media manifest is invalid") from None
    if (
        manifest.project_id != project_id
        or manifest.package_id != package_binding.media_package_id
        or manifest.purpose != "DEVELOPMENT_EVIDENCE"
        or canonical_content_hash(manifest.model_dump(mode="python"))
        != package_binding.manifest_sha256
    ):
        raise DevelopmentTimelineExportInvalidError("timeline media manifest identity changed")
    manifest_previews = {
        shot.preview_video.relative_path: shot.preview_video for shot in manifest.shots
    }
    bindings: list[TimelineMediaBinding] = []
    for binding in package_binding.assets:
        preview = manifest_previews.get(binding.preview_relative_path)
        if (
            preview is None
            or preview.sha256 != binding.preview_sha256
            or preview.byte_size != binding.preview_byte_length
        ):
            raise DevelopmentTimelineExportInvalidError("timeline media input binding changed")
        path = _contained_file(
            package_root / binding.preview_relative_path,
            package_root,
            label="timeline media input",
        )
        try:
            actual_size = path.stat().st_size
        except OSError:
            raise DevelopmentTimelineExportInvalidError(
                "timeline media input is unavailable"
            ) from None
        if actual_size != binding.preview_byte_length:
            raise DevelopmentTimelineExportInvalidError("timeline media input size changed")
        bindings.append(
            TimelineMediaBinding(editing_asset_sha256=binding.editing_asset_sha256, path=path)
        )
    return tuple(bindings)


class DevelopmentTimelineExportService:
    def __init__(
        self, repository: StudioRepository, workspace_root: Path, toolchain: MediaToolchain
    ):
        self._repository = repository
        self._workspace_root = _safe_workspace_root(workspace_root)
        self._toolchain = toolchain
        self._database_path = repository.database_path
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with sqlite3.connect(self._database_path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS development_timeline_exports (
                    project_id TEXT NOT NULL,
                    operation_id TEXT NOT NULL,
                    request_hash TEXT NOT NULL,
                    export_id TEXT NOT NULL UNIQUE,
                    timeline_version_id TEXT NOT NULL,
                    expected_revision INTEGER NOT NULL,
                    purpose TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'UNKNOWN')),
                    timeline_content_hash TEXT NOT NULL,
                    timeline_revision INTEGER NOT NULL,
                    relative_path TEXT,
                    output_sha256 TEXT,
                    byte_length INTEGER,
                    width INTEGER,
                    height INTEGER,
                    frame_rate_num INTEGER,
                    frame_rate_den INTEGER,
                    duration_frames INTEGER,
                    duration_seconds REAL,
                    has_audio INTEGER,
                    message TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (project_id, operation_id)
                )
                """
            )

    def _load(self, project_id: str, operation_id: str) -> _StoredExport | None:
        with sqlite3.connect(self._database_path) as connection:
            connection.row_factory = sqlite3.Row
            row = connection.execute(
                """
                SELECT * FROM development_timeline_exports
                WHERE project_id = ? AND operation_id = ?
                """,
                (project_id, operation_id),
            ).fetchone()
        return _StoredExport.model_validate(dict(row)) if row is not None else None

    def _insert_pending(
        self,
        project_id: str,
        payload: CreateDevelopmentTimelineExportRequest,
        timeline_content_hash: str,
    ) -> tuple[_StoredExport, bool]:
        operation_id = str(payload.operation_id)
        export_id = f"dex_{uuid.uuid4().hex}"
        request_hash = _request_hash(project_id, payload)
        timestamp = _now()
        try:
            with sqlite3.connect(self._database_path) as connection:
                connection.execute(
                    """
                    INSERT INTO development_timeline_exports (
                        project_id, operation_id, request_hash, export_id,
                        timeline_version_id, expected_revision, purpose, status,
                        timeline_content_hash, timeline_revision, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
                    """,
                    (
                        project_id,
                        operation_id,
                        request_hash,
                        export_id,
                        payload.timeline_version_id,
                        payload.expected_revision,
                        payload.purpose,
                        timeline_content_hash,
                        payload.expected_revision,
                        timestamp,
                        timestamp,
                    ),
                )
        except sqlite3.IntegrityError as error:
            existing = self._load(project_id, operation_id)
            if existing is None:
                raise DevelopmentTimelineExportConflictError(
                    "export operation identity is unavailable"
                ) from error
            if existing.request_hash != request_hash:
                raise DevelopmentTimelineExportConflictError(
                    "operation_id was reused with different export input"
                ) from error
            return existing, False
        stored = self._load(project_id, operation_id)
        if stored is None:
            raise DevelopmentTimelineExportConflictError(
                "export operation receipt was not persisted"
            )
        return stored, True

    def _mark_unknown(self, stored: _StoredExport, message: str) -> None:
        with sqlite3.connect(self._database_path) as connection:
            connection.execute(
                """
                UPDATE development_timeline_exports
                SET status = 'UNKNOWN', message = ?, updated_at = ?
                WHERE project_id = ? AND operation_id = ? AND status = 'PENDING'
                """,
                (message, _now(), stored.project_id, stored.operation_id),
            )

    def _mark_succeeded(
        self,
        stored: _StoredExport,
        output: DevelopmentTimelineExportOutput,
    ) -> _StoredExport:
        with sqlite3.connect(self._database_path) as connection:
            connection.execute(
                """
                UPDATE development_timeline_exports
                SET status = 'SUCCEEDED', relative_path = ?, output_sha256 = ?, byte_length = ?,
                    width = ?, height = ?, frame_rate_num = ?, frame_rate_den = ?,
                    duration_frames = ?, duration_seconds = ?, has_audio = ?, message = NULL,
                    updated_at = ?
                WHERE project_id = ? AND operation_id = ? AND status = 'PENDING'
                """,
                (
                    output.relative_path,
                    output.sha256,
                    output.byte_length,
                    output.width,
                    output.height,
                    output.frame_rate_num,
                    output.frame_rate_den,
                    output.duration_frames,
                    output.duration_seconds,
                    int(output.has_audio),
                    _now(),
                    stored.project_id,
                    stored.operation_id,
                ),
            )
        refreshed = self._load(stored.project_id, stored.operation_id)
        if refreshed is None:
            raise DevelopmentTimelineExportUnknownError(stored.project_id, stored.operation_id)
        return refreshed

    def _response_data(self, stored: _StoredExport) -> DevelopmentTimelineExportData:
        if stored.status == "SUCCEEDED":
            width = stored.width
            height = stored.height
            if (
                stored.relative_path is None
                or stored.output_sha256 is None
                or stored.byte_length is None
                or width is None
                or height is None
                or stored.frame_rate_num is None
                or stored.frame_rate_den is None
                or stored.duration_frames is None
                or stored.duration_seconds is None
                or stored.has_audio is None
            ):
                raise DevelopmentTimelineExportUnknownError(stored.project_id, stored.operation_id)
            if width != 1080 or height != 1920:
                raise DevelopmentTimelineExportUnknownError(stored.project_id, stored.operation_id)
            return DevelopmentTimelineExportSucceededData(
                status="SUCCEEDED",
                project_id=stored.project_id,
                export_id=stored.export_id,
                operation_id=uuid.UUID(stored.operation_id),
                timeline_version_id=stored.timeline_version_id,
                timeline_content_hash=stored.timeline_content_hash,
                timeline_revision=stored.timeline_revision,
                purpose="DEVELOPMENT_EVIDENCE",
                output=DevelopmentTimelineExportOutput(
                    workspace_scope="SIDECAR_WORKSPACE",
                    relative_path=stored.relative_path,
                    mime_type="video/mp4",
                    sha256=stored.output_sha256,
                    byte_length=stored.byte_length,
                    width=1080,
                    height=1920,
                    frame_rate_num=stored.frame_rate_num,
                    frame_rate_den=stored.frame_rate_den,
                    duration_frames=stored.duration_frames,
                    duration_seconds=stored.duration_seconds,
                    has_audio=bool(stored.has_audio),
                ),
            )
        return DevelopmentTimelineExportUnknownData(
            status="UNKNOWN",
            project_id=stored.project_id,
            export_id=stored.export_id,
            operation_id=uuid.UUID(stored.operation_id),
            timeline_version_id=stored.timeline_version_id,
            timeline_content_hash=stored.timeline_content_hash,
            timeline_revision=stored.timeline_revision,
            purpose="DEVELOPMENT_EVIDENCE",
            error_code="REMOTE_UNKNOWN",
            message=stored.message
            or "Development export result is unknown; query this operation before retrying.",
        )

    def get(self, project_id: str, operation_id: uuid.UUID) -> DevelopmentTimelineExportData:
        _require_project_id(project_id)
        stored = self._load(project_id, str(operation_id))
        if stored is None:
            raise DevelopmentTimelineExportNotFoundError("development export receipt was not found")
        return self._response_data(stored)

    def create(
        self,
        project_id: str,
        payload: CreateDevelopmentTimelineExportRequest,
    ) -> tuple[DevelopmentTimelineExportData, bool]:
        _require_project_id(project_id)
        operation_id = str(payload.operation_id)
        existing = self._load(project_id, operation_id)
        if existing is not None:
            if existing.request_hash != _request_hash(project_id, payload):
                raise DevelopmentTimelineExportConflictError(
                    "operation_id was reused with different export input"
                )
            if existing.status != "SUCCEEDED":
                raise DevelopmentTimelineExportUnknownError(project_id, operation_id)
            return self._response_data(existing), True
        try:
            try:
                self._repository.get_project(project_id)
                record = self._repository.get_artifact_version(
                    project_id, "timeline", payload.timeline_version_id
                )
            except ArtifactConflictError as error:
                raise DevelopmentTimelineExportInvalidError(
                    "project or timeline version was not found"
                ) from error
            timeline = TimelineVersionV1.model_validate(record.version.content)
            if (
                record.head.revision != payload.expected_revision
                or timeline.revision != payload.expected_revision
            ):
                raise DevelopmentTimelineExportConflictError("timeline revision changed")
            if (
                timeline.sequence_timebase.frame_rate.num,
                timeline.sequence_timebase.frame_rate.den,
            ) != (25, 1):
                raise DevelopmentTimelineExportInvalidError("timeline frame rate must be 25/1")
            if record.version.content_hash != canonical_content_hash(
                timeline.model_dump(mode="python", exclude_computed_fields=True)
            ):
                raise DevelopmentTimelineExportInvalidError("timeline content hash is invalid")
            # The encoder validates again because files can change after this preflight.
            bindings = _media_bindings(self._workspace_root, project_id, timeline)
            output_directory = (
                self._workspace_root / "exports" / "development-timeline" / project_id
            )
            try:
                output_directory.mkdir(parents=True, exist_ok=True)
            except OSError:
                raise DevelopmentTimelineExportInvalidError(
                    "export output directory is unavailable"
                ) from None
            _contained_directory(
                output_directory, self._workspace_root, label="export output directory"
            )
        except DevelopmentTimelineExportInvalidError:
            raise DevelopmentTimelineExportPreflightRejectedError(
                project_id, operation_id, payload.timeline_version_id, payload.expected_revision
            ) from None
        stored, claimed = self._insert_pending(project_id, payload, record.version.content_hash)
        if not claimed:
            if stored.status != "SUCCEEDED":
                raise DevelopmentTimelineExportUnknownError(project_id, stored.operation_id)
            return self._response_data(stored), True
        export_id = stored.export_id
        output_path = output_directory / f"{export_id}.mp4"
        try:
            generated = export_timeline_mp4(
                timeline,
                bindings,
                output_path,
                self._toolchain,
                purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
            )
            width = generated.probe.video.width
            height = generated.probe.video.height
            if width != 1080 or height != 1920:
                raise DevelopmentTimelineExportInvalidError(
                    "development export dimensions must be 1080x1920"
                )
            relative_path = (
                output_path.resolve(strict=True).relative_to(self._workspace_root).as_posix()
            )
            output = DevelopmentTimelineExportOutput(
                workspace_scope="SIDECAR_WORKSPACE",
                relative_path=relative_path,
                mime_type="video/mp4",
                sha256=generated.output_sha256,
                byte_length=generated.path.stat().st_size,
                width=1080,
                height=1920,
                frame_rate_num=generated.probe.video.average_frame_rate.num,
                frame_rate_den=generated.probe.video.average_frame_rate.den,
                duration_frames=generated.render_plan.total_duration_frames,
                duration_seconds=(
                    generated.render_plan.total_duration_frames
                    * generated.render_plan.sequence_timebase.frame_rate.den
                    / generated.render_plan.sequence_timebase.frame_rate.num
                ),
                has_audio=generated.probe.audio is not None,
            )
            return self._response_data(self._mark_succeeded(stored, output)), False
        except (
            TimelineExportError,
            DevelopmentTimelineExportInvalidError,
            OSError,
            ValueError,
        ) as error:
            if isinstance(error, TimelineExportError):
                failure_code = "EXPORT_PIPELINE_UNKNOWN"
            elif isinstance(error, DevelopmentTimelineExportInvalidError):
                failure_code = "OUTPUT_SPEC_UNKNOWN"
            elif isinstance(error, OSError):
                failure_code = "OUTPUT_IO_UNKNOWN"
            else:
                failure_code = "OUTPUT_METADATA_UNKNOWN"
            self._mark_unknown(
                stored,
                f"{failure_code}: Development export result is unknown; "
                "query this operation before retrying.",
            )
            raise DevelopmentTimelineExportUnknownError(project_id, stored.operation_id) from None
