"""Closed visual versions for real human G5 review, never an approval boolean."""

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

from aijian_api.contracts import ArtifactHeadData
from aijian_api.episode_contracts import PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN

MAX_VISUAL_BIBLE_BYTES = 2_000_000
VISUAL_BIBLE_ARTIFACT = "visual_bible"
REFERENCE_ID = r"^crf_[0-9a-f]{32}$"


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


class VisualAssetReferenceV1(_Closed):
    asset_id: StrictStr = Field(pattern=r"^asset_[0-9a-f]{32}$")
    asset_version_id: StrictStr = Field(pattern=r"^asv_[0-9a-f]{32}$")
    sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")


class VisualSafeAreaV1(_Closed):
    canvas_width: StrictInt = Field(ge=9, le=32768)
    canvas_height: StrictInt = Field(ge=16, le=32768)
    x: StrictInt = Field(ge=0)
    y: StrictInt = Field(ge=0)
    width: StrictInt = Field(ge=1)
    height: StrictInt = Field(ge=1)

    @model_validator(mode="after")
    def portrait_bounds(self) -> Self:
        if self.canvas_width * 16 != self.canvas_height * 9:
            raise ValueError("G5 portrait safety reference must be 9:16")
        if self.x + self.width > self.canvas_width or self.y + self.height > self.canvas_height:
            raise ValueError("Safety area must fit inside the declared canvas")
        return self


class VisualSceneReferenceV1(_Closed):
    scene_id: StrictStr = Field(pattern=r"^loc_[0-9a-f]{32}$")
    assets: tuple[VisualAssetReferenceV1, ...] = Field(max_length=2000)

    @field_validator("assets", mode="before")
    @classmethod
    def arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value


class VisualPropV1(_Closed):
    prop_id: StrictStr = Field(pattern=r"^prop_[0-9a-f]{32}$")
    ordinal: StrictInt = Field(ge=1, le=2000)
    name: StrictStr = Field(min_length=1, max_length=120)
    description: StrictStr = Field(max_length=20000)
    assets: tuple[VisualAssetReferenceV1, ...] = Field(max_length=2000)

    @field_validator("assets", mode="before")
    @classmethod
    def arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @field_validator("name")
    @classmethod
    def named(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Prop must have a readable name")
        return value


class _VisualBibleContent(_Closed):
    schema_version: StrictStr
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    creative_library_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    creative_library_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    character_reference_ids: tuple[Annotated[StrictStr, Field(pattern=REFERENCE_ID)], ...] = Field(
        max_length=2000
    )
    scenes: tuple[VisualSceneReferenceV1, ...] = Field(max_length=500)
    props: tuple[VisualPropV1, ...] = Field(max_length=2000)
    safe_area: VisualSafeAreaV1
    effective_scope: Literal["PROJECT"]
    change_reason: StrictStr = Field(min_length=1, max_length=1000)

    @field_validator("character_reference_ids", "scenes", "props", mode="before")
    @classmethod
    def arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def identity(self) -> Self:
        if not self.change_reason.strip():
            raise ValueError("A shared visual change needs a human reason")
        if len(set(self.character_reference_ids)) != len(self.character_reference_ids):
            raise ValueError("Character reference IDs must be unique")
        if len({x.scene_id for x in self.scenes}) != len(self.scenes):
            raise ValueError("Scene identities must be unique")
        if len({x.prop_id for x in self.props}) != len(self.props) or [
            x.ordinal for x in self.props
        ] != list(range(1, len(self.props) + 1)):
            raise ValueError("Props must have unique IDs and contiguous order")
        for assets in [x.assets for x in self.scenes] + [x.assets for x in self.props]:
            if len({(x.asset_id, x.asset_version_id) for x in assets}) != len(assets):
                raise ValueError("A scene/prop cannot repeat an asset version")
        return self


class VisualBibleContentV1(_VisualBibleContent):
    schema_version: Literal["1.0.0"]


class VisualEnvironmentScopeV1(_Closed):
    world_included: Literal[True]
    scene_variant_ids: tuple[Annotated[StrictStr, Field(pattern=r"^scv_[0-9a-f]{32}$")], ...] = (
        Field(max_length=2000)
    )
    environment_reference_ids: tuple[
        Annotated[StrictStr, Field(pattern=r"^erf_[0-9a-f]{32}$")], ...
    ] = Field(max_length=2000)

    @field_validator("world_included", mode="before")
    @classmethod
    def explicit_world(cls, value: object) -> object:
        if value is not True:
            raise ValueError("World review requires the explicit true declaration")
        return value

    @field_validator("scene_variant_ids", "environment_reference_ids", mode="before")
    @classmethod
    def arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def unique(self) -> Self:
        if len(set(self.scene_variant_ids)) != len(self.scene_variant_ids) or len(
            set(self.environment_reference_ids)
        ) != len(self.environment_reference_ids):
            raise ValueError("Environment scope identities must be unique")
        return self


class VisualBibleContentV2(_VisualBibleContent):
    schema_version: Literal["1.1.0"]
    environment_scope: VisualEnvironmentScopeV1


type VisualBibleContent = Annotated[
    VisualBibleContentV1 | VisualBibleContentV2, Field(discriminator="schema_version")
]
VISUAL_BIBLE_CONTENT: TypeAdapter[VisualBibleContent] = TypeAdapter(VisualBibleContent)


class CreateVisualBibleVersionRequest(_Closed):
    content: VisualBibleContent
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    expected_revision: StrictInt | None = Field(ge=1, le=9007199254740991)
    change_summary: StrictStr = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def paired(self) -> Self:
        if (self.parent_version_id is None) != (self.expected_revision is None):
            raise ValueError("Parent and revision must be supplied together")
        if not self.change_summary.strip():
            raise ValueError("Summary cannot be blank")
        return self


class VisualBibleVersionData(_Closed):
    id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    artifact_id: StrictStr = Field(pattern=r"^art_[0-9a-f]{32}$")
    version_number: StrictInt = Field(ge=1)
    content: VisualBibleContent
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    author_actor_id: StrictStr = Field(min_length=1, max_length=240)
    change_summary: StrictStr = Field(min_length=1, max_length=1000)
    created_at: datetime


class VisualBibleReadData(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    head: ArtifactHeadData
    version: VisualBibleVersionData


class VisualBibleVersionResponse(_Closed):
    data: VisualBibleReadData
    request_id: UUID


class VisualBibleIndexData(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    head: ArtifactHeadData
    latest_version: VisualBibleVersionData
    review_version: VisualBibleVersionData | None
    accepted_version: VisualBibleVersionData | None


class VisualBibleIndexResponse(_Closed):
    data: VisualBibleIndexData
    request_id: UUID


class VisualBibleHistoryEntry(_Closed):
    id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    artifact_id: StrictStr = Field(pattern=r"^art_[0-9a-f]{32}$")
    version_number: StrictInt = Field(ge=1)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    creative_library_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    creative_library_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    author_actor_id: StrictStr = Field(min_length=1, max_length=240)
    change_summary: StrictStr = Field(min_length=1, max_length=1000)
    change_reason: StrictStr = Field(min_length=1, max_length=1000)
    created_at: datetime


class VisualBibleHistoryPage(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    head: ArtifactHeadData
    cursor: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    limit: StrictInt = Field(ge=1, le=20)
    items: tuple[VisualBibleHistoryEntry, ...] = Field(max_length=20)
    next_cursor: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)

    @field_validator("items", mode="before")
    @classmethod
    def array(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def page_identity(self) -> Self:
        if len(self.items) > self.limit or any(
            item.artifact_id != self.head.artifact_id or item.id == self.cursor
            for item in self.items
        ):
            raise ValueError("History page scope is inconsistent")
        if len({item.id for item in self.items}) != len(self.items) or any(
            first.version_number <= second.version_number
            for first, second in zip(self.items, self.items[1:], strict=False)
        ):
            raise ValueError("History order or identities are inconsistent")
        if self.cursor is None and (
            not self.items or self.items[0].id != self.head.latest_version_id
        ):
            raise ValueError("First history page must start at the exact latest version")
        if self.next_cursor is not None and (
            len(self.items) != self.limit or self.items[-1].id != self.next_cursor
        ):
            raise ValueError("History continuation must use the last returned version")
        return self


class VisualBibleHistoryResponse(_Closed):
    data: VisualBibleHistoryPage
    request_id: UUID


class VisualBibleDecisionInput(_Closed):
    decision: Literal["approved", "rejected"]
    rationale: StrictStr = Field(min_length=1, max_length=1000)
    readiness_report_id: StrictStr | None = Field(pattern=r"^rpt_[0-9a-f]{32}$")

    @field_validator("rationale")
    @classmethod
    def readable(cls, value: str) -> str:
        if value != value.strip() or not value:
            raise ValueError("Decision reason must be trimmed and readable")
        return value


class VisualBibleConfirmationInput(_Closed):
    challenge_id: StrictStr = Field(pattern=r"^chg_[0-9a-f]{32}$")
    confirmation_token: StrictStr = Field(min_length=20, max_length=256)


class VisualBibleDecisionConfirmInput(VisualBibleConfirmationInput):
    decision: Literal["approved", "rejected"]
    rationale: StrictStr = Field(min_length=1, max_length=1000)

    @field_validator("rationale")
    @classmethod
    def readable(cls, value: str) -> str:
        if value != value.strip() or not value:
            raise ValueError("Decision reason must be trimmed and readable")
        return value


class VisualImageInspectionInput(_Closed):
    operation_id: StrictStr = Field(pattern=r"^vinop_[0-9a-f]{32}$")
    asset_sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    byte_size: StrictInt = Field(ge=1, le=33554432)
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]
    width: StrictInt = Field(ge=1, le=32768)
    height: StrictInt = Field(ge=1, le=32768)
    pixel_sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    decoder: Literal["ELECTRON_NATIVE_IMAGE"]
    decoder_version: StrictStr = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def bounded_pixels(self) -> Self:
        if self.width * self.height > 16777216:
            raise ValueError("Native image inspection pixel budget exceeded")
        return self


class VisualImageInspectionData(_Closed):
    id: StrictStr = Field(pattern=r"^vin_[0-9a-f]{32}$")
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    asset_id: StrictStr = Field(pattern=r"^asset_[0-9a-f]{32}$")
    asset_version_id: StrictStr = Field(pattern=r"^asv_[0-9a-f]{32}$")
    actor_id: StrictStr = Field(min_length=1, max_length=240)
    evidence: VisualImageInspectionInput
    evidence_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    created_at: datetime


class VisualImageInspectionResponse(_Closed):
    data: VisualImageInspectionData
    request_id: UUID


class VisualBibleReadinessData(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    head: ArtifactHeadData
    report: dict[str, object]
    report_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)


class VisualBibleReadinessResponse(_Closed):
    data: VisualBibleReadinessData
    request_id: UUID


class VisualBibleAuthorityData(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    status: Literal["CURRENT", "SUPERSEDED", "UNAPPROVED", "EVIDENCE_CHANGED", "UNAVAILABLE"]
    gate_decision_id: StrictStr | None = Field(pattern=r"^dec_[0-9a-f]{32}$")
    blocking: tuple[StrictStr, ...]


class VisualBibleAuthorityResponse(_Closed):
    data: VisualBibleAuthorityData
    request_id: UUID


class VisualReviewActionInput(_Closed):
    action: Literal["submit", "signoff", "decision"]
    roles: tuple[Literal["continuity_reviewer", "producer"], ...] = ()
    decision: Literal["approved", "rejected"] | None = None
    rationale: StrictStr | None = Field(default=None, min_length=1, max_length=1000)
    readiness_report_id: StrictStr | None = Field(default=None, pattern=r"^rpt_[0-9a-f]{32}$")

    @field_validator("roles", mode="before")
    @classmethod
    def arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def intent(self) -> Self:
        if self.action == "submit":
            if (
                self.roles
                or self.decision is not None
                or self.rationale is not None
                or self.readiness_report_id is not None
            ):
                raise ValueError("Submit cannot contain signoff/decision input")
        elif self.action == "signoff":
            if (
                not self.roles
                or len(set(self.roles)) != len(self.roles)
                or self.decision is not None
                or self.rationale is not None
            ):
                raise ValueError("Signoff needs explicit unique authorized roles")
        elif (
            self.roles
            or self.decision is None
            or self.rationale is None
            or self.rationale != self.rationale.strip()
        ):
            raise ValueError("Decision needs an explicit readable reason")
        return self


class VisualReviewConfirmationInput(VisualReviewActionInput, VisualBibleConfirmationInput):
    pass


class VisualBibleSaveOperationData(_Closed):
    idempotency_key_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    request_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    result: VisualBibleReadData


class VisualBibleSaveOperationResponse(_Closed):
    data: VisualBibleSaveOperationData
    request_id: UUID
