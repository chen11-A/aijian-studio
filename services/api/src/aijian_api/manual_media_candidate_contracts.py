"""Exact local-import associations, never Provider fulfillment or approval."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import Field, StrictInt, StrictStr, model_validator

from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN
from aijian_api.episode_storyboard_contracts import _Closed
from aijian_api.media_asset_contracts import ASSET_ID_PATTERN, ASSET_VERSION_ID_PATTERN

MAX_CANDIDATE_BYTES = 256 * 1024
MAX_ASSET_METADATA_BYTES = 32 * 1024


class ManualMediaCandidateInputV1(_Closed):
    schema_version: Literal["1.0.0"]
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    preparation_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    preparation_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    asset_id: StrictStr = Field(pattern=ASSET_ID_PATTERN)
    asset_version_id: StrictStr = Field(pattern=ASSET_VERSION_ID_PATTERN)
    asset_sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    association_note: StrictStr = Field(min_length=1, max_length=20_000)

    @model_validator(mode="after")
    def manual_intent(self) -> Self:
        if not self.association_note.strip():
            raise ValueError("An explicit full manual association note is required")
        return self


class CreateManualMediaCandidateRequest(_Closed):
    input: ManualMediaCandidateInputV1
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    expected_revision: StrictInt | None = Field(ge=1, le=9_007_199_254_740_991)

    @model_validator(mode="after")
    def paired_revision(self) -> Self:
        if (self.parent_version_id is None) != (self.expected_revision is None):
            raise ValueError("Parent and revision must be supplied together")
        return self


class ManualMediaAssetSnapshotV1(_Closed):
    filename: StrictStr = Field(min_length=1, max_length=255)
    kind: Literal["image", "video"]
    mime_type: StrictStr = Field(min_length=1, max_length=255)
    byte_size: StrictInt = Field(ge=1)
    sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    technical_metadata: dict[StrictStr, StrictStr | StrictInt]


class ManualMediaCandidateContentV1(_Closed):
    schema_version: Literal["1.0.0"]
    input: ManualMediaCandidateInputV1
    asset_snapshot: ManualMediaAssetSnapshotV1
    origin: Literal["LOCAL_IMPORT"]
    association: Literal["MANUAL_ASSOCIATION"]
    cost_status: Literal["UNKNOWN"]

    @model_validator(mode="after")
    def exact_asset(self) -> Self:
        if self.input.asset_sha256 != self.asset_snapshot.sha256:
            raise ValueError("Candidate original SHA differs from the selected asset")
        return self


class ManualMediaCandidateVersionData(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    version_number: StrictInt = Field(ge=1)
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    author_actor_id: Literal["local-user"]
    content: ManualMediaCandidateContentV1
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    created_at: datetime


class ManualMediaCandidateResponse(_Closed):
    data: ManualMediaCandidateVersionData
    request_id: UUID


class ManualMediaCandidatePageData(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    head_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    head_revision: StrictInt | None = Field(ge=1)
    items: tuple[ManualMediaCandidateVersionData, ...] = Field(max_length=20)
    next_cursor: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)


class ManualMediaCandidatePageResponse(_Closed):
    data: ManualMediaCandidatePageData
    request_id: UUID


class ManualMediaCandidateOperationData(_Closed):
    operation_id: StrictStr = Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
    )
    payload: CreateManualMediaCandidateRequest
    version: ManualMediaCandidateVersionData


class ManualMediaCandidateOperationResponse(_Closed):
    data: ManualMediaCandidateOperationData
    request_id: UUID
