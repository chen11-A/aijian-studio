"""Immutable local media inputs; no provider, permission, task or cost authority."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import Field, StrictInt, StrictStr, field_validator, model_validator

from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN
from aijian_api.episode_storyboard_contracts import (
    SHOT_ID_PATTERN,
    EpisodeStoryboardShotV1,
    EpisodeStoryboardShotV2,
    EpisodeStoryboardShotV3,
    EpisodeStoryboardShotV4,
    _Closed,
)
from aijian_api.project_character_details_contracts import ProjectCharacterReferenceV1
from aijian_api.project_environment_contracts import ProjectEnvironmentReferenceV1

MAX_PREPARATION_BYTES = 256 * 1024


class MediaPreparationInputV1(_Closed):
    schema_version: Literal["1.0.0"]
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    capability_intent: Literal["IMAGE", "VIDEO"]
    storyboard_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    storyboard_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    shot_id: StrictStr = Field(pattern=SHOT_ID_PATTERN)
    prompt: StrictStr = Field(min_length=1, max_length=20_000)
    negative_prompt: StrictStr = Field(max_length=20_000)
    width: StrictInt = Field(ge=16, le=8192)
    height: StrictInt = Field(ge=16, le=8192)
    requested_frames: StrictInt = Field(ge=1, le=864_000)

    @model_validator(mode="after")
    def coherent_input(self) -> Self:
        if (
            not self.prompt.strip()
            or self.capability_intent == "IMAGE"
            and self.requested_frames != 1
        ):
            raise ValueError("Preparation needs full prompt and coherent frame intent")
        return self


class CreateMediaPreparationRequest(_Closed):
    input: MediaPreparationInputV1
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    expected_revision: StrictInt | None = Field(ge=1, le=9_007_199_254_740_991)

    @model_validator(mode="after")
    def paired_revision(self) -> Self:
        if (self.parent_version_id is None) != (self.expected_revision is None):
            raise ValueError("Parent and revision are supplied together")
        return self


class MediaPreparationSnapshotV1(_Closed):
    storyboard_schema_version: Literal["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"]
    fps: StrictInt = Field(ge=1, le=120)
    shot: (
        EpisodeStoryboardShotV1
        | EpisodeStoryboardShotV2
        | EpisodeStoryboardShotV3
        | EpisodeStoryboardShotV4
    )
    script_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    creative_library_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    visual_bible_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    selected_references: tuple[ProjectCharacterReferenceV1 | ProjectEnvironmentReferenceV1, ...] = (
        Field(max_length=2000)
    )

    @field_validator("selected_references", mode="before")
    @classmethod
    def references_from_json(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def closed_source_semantics(self) -> Self:
        shot = self.shot
        if shot.script_scene_id is not None and self.script_version_id is None:
            raise ValueError("Script scene needs its exact script source")
        if (
            shot.character_ids
            or shot.location_id is not None
            or self.selected_references
            or self.visual_bible_version_id is not None
        ) and self.creative_library_version_id is None:
            raise ValueError("Creative selections need their exact library source")
        schema = self.storyboard_schema_version
        expected = {
            "1.0.0": EpisodeStoryboardShotV1,
            "1.1.0": EpisodeStoryboardShotV2,
            "1.2.0": EpisodeStoryboardShotV2,
            "1.3.0": EpisodeStoryboardShotV3,
            "1.4.0": EpisodeStoryboardShotV4,
            "1.5.0": EpisodeStoryboardShotV4,
        }[schema]
        if (
            type(shot) is not expected
            or schema in ("1.0.0", "1.1.0")
            and self.visual_bible_version_id is not None
        ):
            raise ValueError("Snapshot schema differs from exact storyboard schema")
        refs = {r.reference_id: r for r in self.selected_references}
        if len(refs) != len(self.selected_references):
            raise ValueError("Snapshot references duplicate")
        selected = set()
        if isinstance(shot, EpisodeStoryboardShotV2):
            for binding in shot.character_bindings:
                for id in binding.reference_ids:
                    r = refs.get(id)
                    if (
                        not isinstance(r, ProjectCharacterReferenceV1)
                        or r.character_id != binding.character_id
                        or r.costume_id not in (None, binding.costume_id)
                    ):
                        raise ValueError("Character reference scope differs")
                    selected.add(id)
        if isinstance(shot, EpisodeStoryboardShotV4):
            for id in shot.environment_binding.reference_ids:
                r = refs.get(id)
                if (
                    not isinstance(r, ProjectEnvironmentReferenceV1)
                    or r.scene_id not in (None, shot.location_id)
                    or r.variant_id not in (None, shot.environment_binding.variant_id)
                ):
                    raise ValueError("Environment reference scope differs")
                selected.add(id)
        if selected != set(refs):
            raise ValueError("Snapshot selected references differ from full bindings")
        return self


class MediaPreparationContentV1(_Closed):
    schema_version: Literal["1.0.0"]
    input: MediaPreparationInputV1
    snapshot: MediaPreparationSnapshotV1


class MediaPreparationVersionData(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    version_number: StrictInt = Field(ge=1)
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    author_actor_id: Literal["local-user"]
    content: MediaPreparationContentV1
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    created_at: datetime


class MediaPreparationResponse(_Closed):
    data: MediaPreparationVersionData
    request_id: UUID


class MediaPreparationPageData(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    head_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    head_revision: StrictInt | None = Field(ge=1)
    items: tuple[MediaPreparationVersionData, ...] = Field(max_length=20)
    next_cursor: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)


class MediaPreparationPageResponse(_Closed):
    data: MediaPreparationPageData
    request_id: UUID


class MediaPreparationOperationData(_Closed):
    operation_id: StrictStr = Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
    )
    payload: CreateMediaPreparationRequest
    version: MediaPreparationVersionData


class MediaPreparationOperationResponse(_Closed):
    data: MediaPreparationOperationData
    request_id: UUID
