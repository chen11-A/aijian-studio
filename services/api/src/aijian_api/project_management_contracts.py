"""Closed request contract for revision-guarded project management."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class UpdateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    status: Literal["active", "archived"] | None = None

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("name")
    @classmethod
    def reject_control_characters(cls, value: str | None) -> str | None:
        if value is not None and any(
            ord(character) < 32 or ord(character) == 127 for character in value
        ):
            raise ValueError("Project name contains unsupported control characters")
        return value

    @model_validator(mode="after")
    def require_change_fields(self) -> UpdateProjectRequest:
        fields = self.model_fields_set & {"name", "status"}
        if not fields or any(getattr(self, field) is None for field in fields):
            raise ValueError("At least one non-null project field is required")
        return self
