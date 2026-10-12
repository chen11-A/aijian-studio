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
    TypeAdapter,
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


class EpisodeStoryboardCharacterBindingV1(_Closed):
    character_id: CharacterId
    costume_id: StrictStr | None = Field(pattern=r"^cst_[0-9a-f]{32}$")
    reference_ids: tuple[Annotated[StrictStr, Field(pattern=r"^crf_[0-9a-f]{32}$")], ...] = Field(
        max_length=2_000
    )

    @field_validator("reference_ids", mode="before")
    @classmethod
    def accept_reference_ids(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def unique_references(self) -> Self:
        if len(set(self.reference_ids)) != len(self.reference_ids):
            raise ValueError("Character reference IDs must be unique")
        return self


class EpisodeStoryboardShotV2(EpisodeStoryboardShotV1):
    character_bindings: tuple[EpisodeStoryboardCharacterBindingV1, ...] = Field(max_length=500)

    @field_validator("character_bindings", mode="before")
    @classmethod
    def accept_bindings(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def validate_binding_membership(self) -> Self:
        ids = [item.character_id for item in self.character_bindings]
        if len(set(ids)) != len(ids) or not set(ids).issubset(self.character_ids):
            raise ValueError("Bindings must uniquely belong to characters in this shot")
        return self


class EpisodeStoryboardShotV3(EpisodeStoryboardShotV2):
    """Manual shot planning intent, distinct from review findings or approval."""

    coverage_notes: LongText
    continuity_notes: LongText
    transition_notes: LongText


class EpisodeStoryboardEnvironmentBindingV1(_Closed):
    variant_id: StrictStr | None = Field(pattern=r"^scv_[0-9a-f]{32}$")
    reference_ids: tuple[Annotated[StrictStr, Field(pattern=r"^erf_[0-9a-f]{32}$")], ...] = Field(
        max_length=2_000
    )

    @field_validator("reference_ids", mode="before")
    @classmethod
    def accept_reference_ids(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        if len(set(self.reference_ids)) != len(self.reference_ids):
            raise ValueError("Environment references must be unique")
        return self


class EpisodeStoryboardShotV4(EpisodeStoryboardShotV3):
    environment_binding: EpisodeStoryboardEnvironmentBindingV1

    @model_validator(mode="after")
    def state_requires_location(self) -> Self:
        if self.environment_binding.variant_id is not None and self.location_id is None:
            raise ValueError("A selected environment state needs a location")
        return self


class _EpisodeStoryboardContent(_Closed):
    """An empty manual draft is valid; this is not an accepted ShotOutline."""

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


class EpisodeStoryboardContentV1(_EpisodeStoryboardContent):
    """An empty manual draft is valid; this is not an accepted ShotOutline."""

    schema_version: Literal["1.0.0"]


class EpisodeStoryboardContentV2(_EpisodeStoryboardContent):
    schema_version: Literal["1.1.0"]
    shots: tuple[EpisodeStoryboardShotV2, ...] = Field(max_length=1_000)


class StoryboardVisualBiblePinV1(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)


class EpisodeStoryboardContentV3(_EpisodeStoryboardContent):
    schema_version: Literal["1.2.0"]
    shots: tuple[EpisodeStoryboardShotV2, ...] = Field(max_length=1_000)
    visual_bible_pin: StoryboardVisualBiblePinV1 | None

    @model_validator(mode="after")
    def visual_basis(self) -> Self:
        if self.visual_bible_pin is not None and self.creative_library_version_id is None:
            raise ValueError("An approved visual pin needs its exact creative-library basis")
        return self


class EpisodeStoryboardContentV4(_EpisodeStoryboardContent):
    schema_version: Literal["1.3.0"]
    shots: tuple[EpisodeStoryboardShotV3, ...] = Field(max_length=1_000)
    visual_bible_pin: StoryboardVisualBiblePinV1 | None

    @model_validator(mode="after")
    def visual_basis(self) -> Self:
        if self.visual_bible_pin is not None and self.creative_library_version_id is None:
            raise ValueError("An approved visual pin needs its exact creative-library basis")
        return self


class EpisodeStoryboardContentV5(_EpisodeStoryboardContent):
    schema_version: Literal["1.4.0"]
    shots: tuple[EpisodeStoryboardShotV4, ...] = Field(max_length=1_000)
    visual_bible_pin: StoryboardVisualBiblePinV1 | None

    @model_validator(mode="after")
    def exact_manual_environment_basis(self) -> Self:
        chosen = any(
            shot.environment_binding.variant_id is not None
            or shot.environment_binding.reference_ids
            for shot in self.shots
        )
        if (
            chosen or self.visual_bible_pin is not None
        ) and self.creative_library_version_id is None:
            raise ValueError("Environment/G5 choices require an exact creative-library basis")
        if chosen and self.visual_bible_pin is not None:
            raise ValueError(
                "The existing G5 scope does not approve independent environment choices"
            )
        return self


class EpisodeStoryboardContentV6(_EpisodeStoryboardContent):
    schema_version: Literal["1.5.0"]
    shots: tuple[EpisodeStoryboardShotV4, ...] = Field(max_length=1_000)
    visual_bible_pin: StoryboardVisualBiblePinV1 | None

    @model_validator(mode="after")
    def environment_basis(self) -> Self:
        chosen = any(
            shot.environment_binding.variant_id is not None
            or shot.environment_binding.reference_ids
            for shot in self.shots
        )
        if (
            chosen or self.visual_bible_pin is not None
        ) and self.creative_library_version_id is None:
            raise ValueError("Environment/G5 choices require an exact creative-library basis")
        return self


type EpisodeStoryboardContent = Annotated[
    EpisodeStoryboardContentV1
    | EpisodeStoryboardContentV2
    | EpisodeStoryboardContentV3
    | EpisodeStoryboardContentV4
    | EpisodeStoryboardContentV5
    | EpisodeStoryboardContentV6,
    Field(discriminator="schema_version"),
]
STORYBOARD_CONTENT: TypeAdapter[EpisodeStoryboardContent] = TypeAdapter(EpisodeStoryboardContent)


class CreateEpisodeStoryboardVersionRequest(_Closed):
    content: EpisodeStoryboardContent
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
    content: EpisodeStoryboardContent
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
