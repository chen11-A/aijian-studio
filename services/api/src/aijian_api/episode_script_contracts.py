"""Closed contracts for editable, versioned Episode script drafts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StrictStr,
    field_serializer,
    field_validator,
    model_validator,
)

from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN

VERSION_ID_PATTERN = r"^ver_[0-9a-f]{32}$"
SCENE_ID_PATTERN = r"^scn_[0-9a-f]{32}$"
BLOCK_ID_PATTERN = r"^sblk_[0-9a-f]{32}$"
CONTENT_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"
PROPOSAL_ACCEPTANCE_ID_PATTERN = r"^pda_[0-9a-f]{32}$"
MAX_SCRIPT_BYTES = 2_000_000


class _Closed(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, strict=True, revalidate_instances="always"
    )


class EpisodeScriptBlockV1(_Closed):
    block_id: StrictStr = Field(pattern=BLOCK_ID_PATTERN)
    ordinal: StrictInt = Field(ge=1, le=500)
    kind: Literal["ACTION", "DIALOGUE"]
    text: StrictStr = Field(min_length=1, max_length=20_000)
    speaker: StrictStr | None = Field(default=None, min_length=1, max_length=120)
    delivery: Literal["ON_SCREEN", "OFF_SCREEN"] | None = None

    @model_validator(mode="after")
    def validate_kind(self) -> Self:
        if not self.text.strip():
            raise ValueError("Script block text cannot be blank")
        if self.kind == "DIALOGUE" and (self.speaker is None or not self.speaker.strip()):
            raise ValueError("Dialogue requires a speaker")
        if self.kind == "ACTION" and (self.speaker is not None or self.delivery is not None):
            raise ValueError("Action cannot have a speaker or dialogue delivery")
        return self


class EpisodeScriptSceneV1(_Closed):
    scene_id: StrictStr = Field(pattern=SCENE_ID_PATTERN)
    ordinal: StrictInt = Field(ge=1, le=1_000)
    heading: StrictStr = Field(min_length=1, max_length=240)
    blocks: tuple[EpisodeScriptBlockV1, ...] = Field(default=(), max_length=500)

    @field_validator("blocks", mode="before")
    @classmethod
    def accept_json_blocks(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def validate_order(self) -> Self:
        if not self.heading.strip():
            raise ValueError("Scene heading cannot be blank")
        if [block.ordinal for block in self.blocks] != list(range(1, len(self.blocks) + 1)):
            raise ValueError("Script block ordinals must be contiguous")
        if len({block.block_id for block in self.blocks}) != len(self.blocks):
            raise ValueError("Script block IDs must be unique within a scene")
        return self


class EpisodeScriptContentV1(_Closed):
    """A draft may be empty; downstream confirmation is a separate gate."""

    schema_version: Literal["1.0.0"] = "1.0.0"
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    production_brief_version_id: StrictStr | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    story_bible_version_id: StrictStr | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    source_extraction_version_id: StrictStr | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    source_proposal_acceptance_id: StrictStr | None = Field(
        default=None, pattern=PROPOSAL_ACCEPTANCE_ID_PATTERN
    )
    scenes: tuple[EpisodeScriptSceneV1, ...] = Field(default=(), max_length=1_000)

    @field_validator("scenes", mode="before")
    @classmethod
    def accept_json_scenes(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def validate_order(self) -> Self:
        if (self.source_extraction_version_id is None) != (
            self.source_proposal_acceptance_id is None
        ):
            raise ValueError("Accepted source proposal and its draft version must be paired")
        if [scene.ordinal for scene in self.scenes] != list(range(1, len(self.scenes) + 1)):
            raise ValueError("Script scene ordinals must be contiguous")
        if len({scene.scene_id for scene in self.scenes}) != len(self.scenes):
            raise ValueError("Script scene IDs must be unique")
        block_ids = [block.block_id for scene in self.scenes for block in scene.blocks]
        if len(set(block_ids)) != len(block_ids):
            raise ValueError("Script block IDs must be unique across the Episode")
        return self


class CreateEpisodeScriptVersionRequest(_Closed):
    content: EpisodeScriptContentV1
    parent_version_id: StrictStr | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    expected_revision: StrictInt | None = Field(default=None, ge=1)
    change_summary: StrictStr = Field(min_length=1, max_length=240)

    @model_validator(mode="after")
    def validate_revision_pair(self) -> Self:
        if (self.parent_version_id is None) != (self.expected_revision is None):
            raise ValueError("Parent version and expected revision must be supplied together")
        if not self.change_summary.strip():
            raise ValueError("Change summary cannot be blank")
        return self


class EpisodeScriptVersionData(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    version_number: StrictInt = Field(ge=1)
    head_revision: StrictInt = Field(ge=1)
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    content: EpisodeScriptContentV1
    stored_content: dict[str, object] = Field(exclude=True, repr=False)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    author_actor_id: StrictStr = Field(min_length=1, max_length=240)
    change_summary: StrictStr = Field(min_length=1, max_length=240)
    created_at: datetime

    @model_validator(mode="after")
    def validate_stored_content(self) -> Self:
        if (
            canonical_content_hash(self.stored_content) != self.content_hash
            or EpisodeScriptContentV1.model_validate(self.stored_content) != self.content
        ):
            raise ValueError("Script response content differs from its stored version")
        return self

    @field_serializer("content")
    def serialize_content(self, content: EpisodeScriptContentV1) -> dict[str, object]:
        # Historical versions did not carry delivery or later optional source fields.
        # Preserve their exact stored JSON shape in version readback.
        if canonical_content_hash(self.stored_content) != self.content_hash:
            raise ValueError("Script response content changed before serialization")
        return self.stored_content


class EpisodeScriptVersionResponse(_Closed):
    data: EpisodeScriptVersionData
    request_id: UUID


class EpisodeScriptVersionCreatedData(_Closed):
    version: EpisodeScriptVersionData
    replayed: bool


class EpisodeScriptVersionCreatedResponse(_Closed):
    data: EpisodeScriptVersionCreatedData
    request_id: UUID
