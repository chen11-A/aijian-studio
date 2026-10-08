"""Closed contracts for project-shared, manually authored creative draft text."""

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
from aijian_api.episode_contracts import PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN

MAX_CREATIVE_LIBRARY_BYTES = 2_000_000
LongText = Annotated[StrictStr, Field(max_length=20_000)]
ShortText = Annotated[StrictStr, Field(max_length=240)]


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


class ProjectCharacterV1(_Closed):
    character_id: StrictStr = Field(pattern=r"^chr_[0-9a-f]{32}$")
    ordinal: StrictInt = Field(ge=1, le=500)
    name: StrictStr = Field(min_length=1, max_length=120)
    role: ShortText
    description: LongText
    appearance: LongText
    personality: LongText

    @field_validator("name")
    @classmethod
    def require_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Character name cannot be blank")
        return value


class ProjectWorldV1(_Closed):
    premise: LongText
    rules: LongText
    era: ShortText
    visual_style: LongText
    palette: LongText
    materials: LongText


class ProjectSceneV1(_Closed):
    scene_id: StrictStr = Field(pattern=r"^loc_[0-9a-f]{32}$")
    ordinal: StrictInt = Field(ge=1, le=500)
    name: StrictStr = Field(min_length=1, max_length=120)
    description: LongText
    location: ShortText
    time_of_day: ShortText
    weather: ShortText
    continuity: LongText

    @field_validator("name")
    @classmethod
    def require_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Scene name cannot be blank")
        return value


class ProjectCreativeLibraryContentV1(_Closed):
    schema_version: Literal["1.0.0"]
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: None
    characters: tuple[ProjectCharacterV1, ...] = Field(max_length=500)
    world: ProjectWorldV1
    scenes: tuple[ProjectSceneV1, ...] = Field(max_length=500)

    @field_validator("characters", "scenes", mode="before")
    @classmethod
    def accept_json_arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def validate_identity_and_order(self) -> Self:
        for entries in (self.characters, self.scenes):
            if [item.ordinal for item in entries] != list(range(1, len(entries) + 1)):
                raise ValueError("Creative library ordinals must be contiguous")
        if len({item.character_id for item in self.characters}) != len(self.characters):
            raise ValueError("Character IDs must be unique")
        if len({item.scene_id for item in self.scenes}) != len(self.scenes):
            raise ValueError("Scene IDs must be unique")
        return self


class CreateProjectCreativeLibraryVersionRequest(_Closed):
    content: ProjectCreativeLibraryContentV1
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


class ProjectCreativeLibraryVersionData(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: None
    version_number: StrictInt = Field(ge=1)
    head_revision: StrictInt = Field(ge=1)
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    content: ProjectCreativeLibraryContentV1
    stored_content: dict[str, object] = Field(exclude=True, repr=False)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    author_actor_id: StrictStr = Field(min_length=1, max_length=240)
    change_summary: StrictStr = Field(min_length=1, max_length=240)
    created_at: datetime

    @model_validator(mode="after")
    def validate_stored_content(self) -> Self:
        if (
            canonical_content_hash(self.stored_content) != self.content_hash
            or ProjectCreativeLibraryContentV1.model_validate(self.stored_content) != self.content
        ):
            raise ValueError("Creative library response differs from its stored version")
        return self


class ProjectCreativeLibraryVersionResponse(_Closed):
    data: ProjectCreativeLibraryVersionData
    request_id: UUID


class ProjectCreativeLibraryVersionCreatedData(_Closed):
    version: ProjectCreativeLibraryVersionData
    replayed: bool


class ProjectCreativeLibraryVersionCreatedResponse(_Closed):
    data: ProjectCreativeLibraryVersionCreatedData
    request_id: UUID
