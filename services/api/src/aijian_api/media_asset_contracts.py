"""Public project media-library shapes. IDs can also be used by TimelineAssetV1."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.contracts import PROJECT_ID_PATTERN

ASSET_ID_PATTERN = r"^asset_[0-9a-f]{32}$"
ASSET_VERSION_ID_PATTERN = r"^asv_[0-9a-f]{32}$"
EPISODE_ID_PATTERN = r"^ep_[a-z0-9._-]{1,80}$"

type AssetKind = Literal["image", "video", "audio"]
type RightsStatus = Literal["PENDING_REVIEW", "CLEARED", "RESTRICTED"]
type AssetAvailability = Literal["PRESENT_UNVERIFIED", "VERIFIED", "MISSING", "CORRUPT"]


class AssetEpisodeReferenceData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    version_id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    role: str = Field(min_length=1, max_length=80)
    created_at: str


class AssetVersionData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    ordinal: int = Field(strict=True, ge=1)
    filename: str = Field(min_length=1, max_length=255)
    kind: AssetKind
    mime_type: str
    byte_size: int = Field(strict=True, gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    rights_status: RightsStatus
    source_kind: Literal["LOCAL_IMPORT"] = "LOCAL_IMPORT"
    technical_metadata: dict[str, str | int]
    created_at: str
    availability: AssetAvailability


class MediaAssetData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=ASSET_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    created_at: str
    latest_version: AssetVersionData
    versions: tuple[AssetVersionData, ...] = ()
    episode_references: tuple[AssetEpisodeReferenceData, ...] = ()


class MediaAssetResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: MediaAssetData
    request_id: UUID


class MediaAssetListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: tuple[MediaAssetData, ...]
    request_id: UUID


class AddAssetEpisodeReferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    version_id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    role: str = Field(min_length=1, max_length=80)
