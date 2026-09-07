"""Public Episode metadata API contracts with canonical decimal wire values."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictStr, ValidationInfo, field_validator

PROJECT_ID_PATTERN = r"^prj_[0-9a-f]{32}$"
EPISODE_ID_PATTERN = r"^ep_(?:prj_)?[0-9a-f]{32}$"
INT64_MAX = 2**63 - 1


def parse_canonical_decimal(value: object, *, minimum: int, field_name: str) -> int:
    """Parse an API decimal string without accepting alternate numeric spellings."""

    if not isinstance(value, str) or not value or not value.isascii() or not value.isdecimal():
        raise ValueError(f"{field_name} must be a canonical decimal string")
    if len(value) > 1 and value.startswith("0"):
        raise ValueError(f"{field_name} must be a canonical decimal string")
    parsed = int(value)
    if not minimum <= parsed <= INT64_MAX:
        raise ValueError(f"{field_name} is outside the supported int64 range")
    return parsed


CanonicalDecimal = Annotated[StrictStr, Field(pattern=r"^(?:0|[1-9][0-9]*)$")]
PositiveCanonicalDecimal = Annotated[StrictStr, Field(pattern=r"^[1-9][0-9]*$")]


class CreateEpisodeRequest(BaseModel):
    """The small, write-once Episode metadata input surface."""

    model_config = ConfigDict(extra="forbid")

    title: StrictStr = Field(min_length=1, max_length=80)
    target_duration_seconds: PositiveCanonicalDecimal | None = None

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("title")
    @classmethod
    def reject_title_controls(cls, value: str) -> str:
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Episode title contains unsupported control characters")
        return value

    @field_validator("target_duration_seconds")
    @classmethod
    def validate_duration(cls, value: str | None) -> str | None:
        if value is not None:
            parse_canonical_decimal(value, minimum=1, field_name="target_duration_seconds")
        return value


class EpisodeData(BaseModel):
    """Episode organization metadata; it does not partition creative artifacts."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=EPISODE_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    position: PositiveCanonicalDecimal
    title: str
    is_default: bool
    target_duration_seconds: PositiveCanonicalDecimal | None
    revision: PositiveCanonicalDecimal
    created_at: datetime
    updated_at: datetime

    @field_validator("position", "revision", "target_duration_seconds", mode="before")
    @classmethod
    def serialize_server_decimal(cls, value: object, info: ValidationInfo) -> str | None:
        if value is None and info.field_name == "target_duration_seconds":
            return None
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{info.field_name} must be an integer in persisted Episode data")
        return str(
            parse_canonical_decimal(
                str(value), minimum=1, field_name=info.field_name or "Episode numeric field"
            )
        )


class EpisodeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: EpisodeData
    request_id: UUID


class EpisodeListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[EpisodeData]
    request_id: UUID
