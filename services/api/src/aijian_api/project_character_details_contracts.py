"""Closed manual relationships and costume descriptions, never visual approvals."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator

CharacterId = Annotated[StrictStr, Field(pattern=r"^chr_[0-9a-f]{32}$")]


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

    @field_validator("name", "label", check_fields=False)
    @classmethod
    def require_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Relationship label or costume name cannot be blank")
        return value


class ProjectCharacterRelationshipV1(_Closed):
    relationship_id: StrictStr = Field(pattern=r"^rel_[0-9a-f]{32}$")
    ordinal: StrictInt = Field(ge=1, le=2_000)
    from_character_id: CharacterId
    to_character_id: CharacterId
    label: StrictStr = Field(min_length=1, max_length=120)
    description: StrictStr = Field(max_length=20_000)


class ProjectCostumeV1(_Closed):
    costume_id: StrictStr = Field(pattern=r"^cst_[0-9a-f]{32}$")
    ordinal: StrictInt = Field(ge=1, le=2_000)
    character_id: CharacterId
    name: StrictStr = Field(min_length=1, max_length=120)
    description: StrictStr = Field(max_length=20_000)


class ProjectCharacterReferenceV1(_Closed):
    reference_id: StrictStr = Field(pattern=r"^crf_[0-9a-f]{32}$")
    ordinal: StrictInt = Field(ge=1, le=2_000)
    character_id: CharacterId
    costume_id: StrictStr | None = Field(pattern=r"^cst_[0-9a-f]{32}$")
    asset_id: StrictStr = Field(pattern=r"^asset_[0-9a-f]{32}$")
    asset_version_id: StrictStr = Field(pattern=r"^asv_[0-9a-f]{32}$")
    asset_sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    label: StrictStr = Field(min_length=1, max_length=120)
