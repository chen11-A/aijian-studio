"""Exact manual environment states/references, not visual approval or execution."""

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator


class _Closed(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, strict=True, revalidate_instances="always"
    )

    @field_validator("*", mode="after")
    @classmethod
    def valid_unicode(cls, value: object) -> object:
        if isinstance(value, str):
            value.encode("utf-8")
        return value

    @field_validator("name", "label", check_fields=False)
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Environment state/reference name cannot be blank")
        return value


class ProjectSceneVariantV1(_Closed):
    variant_id: StrictStr = Field(pattern=r"^scv_[0-9a-f]{32}$")
    ordinal: StrictInt = Field(ge=1, le=2_000)
    scene_id: StrictStr = Field(pattern=r"^loc_[0-9a-f]{32}$")
    name: StrictStr = Field(min_length=1, max_length=120)
    view: StrictStr = Field(max_length=240)
    time_of_day: StrictStr = Field(max_length=240)
    weather: StrictStr = Field(max_length=240)
    state: StrictStr = Field(max_length=20_000)
    continuity: StrictStr = Field(max_length=20_000)


class ProjectEnvironmentReferenceV1(_Closed):
    reference_id: StrictStr = Field(pattern=r"^erf_[0-9a-f]{32}$")
    ordinal: StrictInt = Field(ge=1, le=2_000)
    scene_id: StrictStr | None = Field(pattern=r"^loc_[0-9a-f]{32}$")
    variant_id: StrictStr | None = Field(pattern=r"^scv_[0-9a-f]{32}$")
    asset_id: StrictStr = Field(pattern=r"^asset_[0-9a-f]{32}$")
    asset_version_id: StrictStr = Field(pattern=r"^asv_[0-9a-f]{32}$")
    asset_sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    label: StrictStr = Field(min_length=1, max_length=120)
