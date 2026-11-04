"""Read-only readiness contract for a future product timeline export."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

PROJECT_ID_PATTERN = r"^prj_[0-9a-f]{32}$"
EPISODE_ID_PATTERN = r"^ep_(?:prj_)?[0-9a-f]{32}$"
VERSION_ID_PATTERN = r"^ver_[0-9a-f]{32}$"
CONTENT_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"
ASSET_ID_PATTERN = r"^asset_[0-9a-f]{32}$"
ASSET_VERSION_ID_PATTERN = r"^asv_[0-9a-f]{32}$"
SHA256_HEX_PATTERN = r"^[0-9a-f]{64}$"
ProductExportIssueScope = Literal[
    "PROJECT",
    "EPISODE",
    "TIMELINE",
    "PICTURE_LOCK",
    "MEDIA",
    "VIDEO",
    "DIALOGUE",
    "BGM",
    "SFX",
    "SUBTITLE",
    "RIGHTS",
    "SPEC",
    "OUTPUT",
    "TOOLCHAIN",
    "EXECUTION",
]


class ProductExportVersionRef(BaseModel):
    """Reference to an immutable artifact version in the project repository."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)


class ProductExportAssetRef(BaseModel):
    """Reference to an immutable imported media version, using its native hash shape."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    asset_id: str = Field(pattern=ASSET_ID_PATTERN)
    version_id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    sha256: str = Field(pattern=SHA256_HEX_PATTERN)


ProductExportMediaRef = ProductExportVersionRef | ProductExportAssetRef


class ProductExportSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    container: Literal["MP4"]
    width: int = Field(strict=True, ge=16, le=7680)
    height: int = Field(strict=True, ge=16, le=7680)
    frame_rate_num: int = Field(strict=True, ge=1, le=240_000)
    frame_rate_den: int = Field(strict=True, ge=1, le=100_000)
    video_codec: Literal["H264", "H265"]
    audio_codec: Literal["AAC"]


class ProductExportPreflightRequest(BaseModel):
    """Client-selected versions are assertions, never proof of approval or file availability."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    timeline: ProductExportVersionRef
    expected_revision: int = Field(strict=True, ge=1)
    picture_lock: ProductExportVersionRef | None = None
    media_manifest: ProductExportVersionRef | None = None
    video_master: ProductExportMediaRef | None = None
    dialogue_mix: ProductExportMediaRef | None = None
    bgm_mix: ProductExportMediaRef | None = None
    sfx_mix: ProductExportMediaRef | None = None
    subtitle_track: ProductExportVersionRef | None = None
    rights_clearance: ProductExportVersionRef | None = None
    spec: ProductExportSpec


class ProductExportPreflightIssue(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,79}$")
    scope: ProductExportIssueScope
    message: str = Field(min_length=1, max_length=240)


class ProductExportPreflightData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["BLOCKED"]
    request_effect: Literal["NO_EXPORT_CLAIM"]
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    timeline: ProductExportVersionRef
    expected_revision: int = Field(strict=True, ge=1)
    request_fingerprint: str = Field(pattern=CONTENT_HASH_PATTERN)
    issues: tuple[ProductExportPreflightIssue, ...] = Field(min_length=1)


class ProductExportPreflightResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: ProductExportPreflightData
    request_id: UUID
