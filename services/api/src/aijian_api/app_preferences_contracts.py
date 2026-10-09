"""Closed API contracts for local, non-sensitive application preferences."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class SaveAppPreferencesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    expected_revision: int = Field(ge=0, le=9223372036854775806)
    user_name: str = Field(min_length=1, max_length=80)
    display_bio: str = Field(max_length=1000)
    ui_language: Literal["zh-CN"]
    ui_theme: Literal["dark-cinematic"]

    @field_validator("user_name", mode="before")
    @classmethod
    def trim_user_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("user_name")
    @classmethod
    def reject_user_name_controls(cls, value: str) -> str:
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("User name contains unsupported control characters")
        return value

    @field_validator("display_bio")
    @classmethod
    def reject_bio_controls(cls, value: str) -> str:
        if any((ord(char) < 32 and char != "\n") or ord(char) == 127 for char in value):
            raise ValueError("Bio contains unsupported control characters")
        return value


class AppPreferencesData(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    saved: bool
    revision: int = Field(ge=0)
    user_name: str = Field(max_length=80)
    display_bio: str = Field(max_length=1000)
    ui_language: Literal["zh-CN"]
    ui_theme: Literal["dark-cinematic"]
    created_at: datetime | None
    updated_at: datetime | None

    @model_validator(mode="after")
    def validate_saved_state(self) -> AppPreferencesData:
        if self.saved:
            if self.revision < 1 or self.created_at is None or self.updated_at is None:
                raise ValueError("Saved preferences require revision and timestamps")
        elif self.revision != 0 or self.created_at is not None or self.updated_at is not None:
            raise ValueError("Unsaved preferences cannot claim persisted truth")
        for value in (self.created_at, self.updated_at):
            if value is not None and (value.tzinfo is None or value.utcoffset() is None):
                raise ValueError("Preferences timestamps require timezone")
        if self.saved and (
            not self.user_name
            or self.user_name != self.user_name.strip()
            or any(ord(char) < 32 or ord(char) == 127 for char in self.user_name)
        ):
            raise ValueError("Saved user name is invalid")
        if any((ord(char) < 32 and char != "\n") or ord(char) == 127 for char in self.display_bio):
            raise ValueError("Saved bio is invalid")
        if self.saved and self.created_at is not None and self.updated_at is not None:
            if self.updated_at < self.created_at:
                raise ValueError("Preferences timestamps are reversed")
        return self


class AppPreferencesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: AppPreferencesData
    request_id: UUID
