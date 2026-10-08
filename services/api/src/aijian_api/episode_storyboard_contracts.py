"""Closed contracts for manually authored, episode-scoped storyboard drafts."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)

from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import (
    CONTENT_HASH_PATTERN,
    SCENE_ID_PATTERN,
    VERSION_ID_PATTERN,
)

MAX_STORYBOARD_BYTES = 2_000_000
SHOT_ID_PATTERN = r"^shp_[0-9a-f]{32}$"
CHARACTER_ID_PATTERN = r"^chr_[0-9a-f]{32}$"
LOCATION_ID_PATTERN = r"^loc_[0-9a-f]{32}$"
LongText = Annotated[StrictStr, Field(max_length=20_000)]
CharacterId = Annotated[StrictStr, Field(pattern=CHARACTER_ID_PATTERN)]


class _Closed(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, strict=True, revalidate_instances="always"
    )

    @field_validator("*", mode="after")
    @classmethod
    def require_valid_unicode(cls, value: object) -> object:
        if isinstance(value, str):
            value.encode("utf-8")
        return value


class EpisodeStoryboardShotV1(_Closed):
    shot_id: StrictStr = Field(pattern=SHOT_ID_PATTERN)
    ordinal: StrictInt = Field(ge=1, le=1_000)
    duration_frames: StrictInt = Field(ge=1, le=864_000)
    title: StrictStr = Field(min_length=1, max_length=240)
    description: LongText
    action: LongText
    dialogue: LongText
    camera: StrictStr = Field(max_length=240)
    script_scene_id: StrictStr | None = Field(pattern=SCENE_ID_PATTERN)
    character_ids: tuple[CharacterId, ...] = Field(max_length=500)
    location_id: StrictStr | None = Field(pattern=LOCATION_ID_PATTERN)

    @field_validator("character_ids", mode="before")
    @classmethod
    def accept_json_arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def validate_shot(self) -> Self:
        if not self.title.strip():
            raise ValueError("Shot title cannot be blank")
        if len(set(self.character_ids)) != len(self.character_ids):
            raise ValueError("Shot character IDs must be unique")
        return self


class EpisodeStoryboardContentV1(_Closed):
    """An empty manual draft is valid; this is not an accepted ShotOutline."""

    schema_version: Literal["1.0.0"]
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    fps: StrictInt = Field(ge=1, le=120)
    script_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    creative_library_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    shots: tuple[EpisodeStoryboardShotV1, ...] = Field(max_length=1_000)

    @field_validator("shots", mode="before")
    @classmethod
    def accept_json_arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def validate_identity_order_and_pins(self) -> Self:
        if [shot.ordinal for shot in self.shots] != list(range(1, len(self.shots) + 1)):
            raise ValueError("Storyboard shot ordinals must be contiguous")
        if len({shot.shot_id for shot in self.shots}) != len(self.shots):
            raise ValueError("Storyboard shot IDs must be unique")
        if self.script_version_id is None and any(
            shot.script_scene_id is not None for shot in self.shots
        ):
            raise ValueError("Script scene references require an exact script version")
        if self.creative_library_version_id is None and any(
            shot.character_ids or shot.location_id is not None for shot in self.shots
        ):
            raise ValueError("Character and location references require an exact library version")
        return self


class CreateEpisodeStoryboardVersionRequest(_Closed):
    content: EpisodeStoryboardContentV1
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    expected_revision: StrictInt | None = Field(ge=1, le=9_007_199_254_740_991)
    change_summary: StrictStr = Field(min_length=1, max_length=240)

    @model_validator(mode="after")
    def validate_revision_pair(self) -> Self:
        if (self.parent_version_id is None) != (self.expected_revision is None):
            raise ValueError("Parent version and expected revision must be supplied together")
        if not self.change_summary.strip():
            raise ValueError("Change summary cannot be blank")
        return self


class EpisodeStoryboardVersionData(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    version_number: StrictInt = Field(ge=1)
    head_revision: StrictInt = Field(ge=1)
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    content: EpisodeStoryboardContentV1
    stored_content: dict[str, object] = Field(exclude=True, repr=False)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    author_actor_id: StrictStr = Field(min_length=1, max_length=240)
    change_summary: StrictStr = Field(min_length=1, max_length=240)
    created_at: datetime

    @model_validator(mode="after")
    def validate_stored_content(self) -> Self:
        if (
            canonical_content_hash(self.stored_content) != self.content_hash
            or self.content.model_dump(mode="json") != self.stored_content
        ):
            raise ValueError("Storyboard response differs from its stored version")
        return self


class EpisodeStoryboardVersionResponse(_Closed):
    data: EpisodeStoryboardVersionData
    request_id: UUID


class EpisodeStoryboardVersionCreatedData(_Closed):
    version: EpisodeStoryboardVersionData
    replayed: bool


class EpisodeStoryboardVersionCreatedResponse(_Closed):
    data: EpisodeStoryboardVersionCreatedData
    request_id: UUID
