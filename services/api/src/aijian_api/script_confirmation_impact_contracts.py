"""Confirmation impacts are immutable source facts, separate from accepted Gates."""

from __future__ import annotations

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StrictStr,
    model_validator,
)

from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_media_assembly_contracts import (
    AssemblyAudioSegmentV1,
    AssemblyConfirmedScriptProvenanceV1,
    AssemblyDraftScriptProvenanceV1,
    AssemblySubtitleSegmentV1,
    AssemblyTextSubtitleSegmentV1,
)
from aijian_api.episode_script_confirmation_contracts import (
    ARTIFACT_ID_PATTERN,
    CONFIRMATION_ID_PATTERN,
    CreateEpisodeScriptConfirmationRequest,
    EpisodeScriptConfirmationData,
)
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN
from aijian_api.episode_storyboard_contracts import SHOT_ID_PATTERN
from aijian_api.media_contracts import SequenceTimebaseData

REPORT_ID_PATTERN = r"^sci_[0-9a-f]{32}$"
MAX_ASSESSMENT_BYTES = 12 * 1024 * 1024
ALGORITHM: Literal["script-confirmation-exact-dependencies-v1"] = (
    "script-confirmation-exact-dependencies-v1"
)
Impact = Literal["blocking", "render_only", "advisory"]
EventKind = Literal["BASELINE", "SAME_SOURCE", "SOURCE_REPLACED"]


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ScriptImpactDependencyV1(_Closed):
    dependency_id: StrictStr = Field(pattern=r"^dep_[0-9a-f]{32}$")
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    upstream_artifact_id: StrictStr = Field(pattern=ARTIFACT_ID_PATTERN)
    upstream_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    downstream_artifact_id: StrictStr = Field(pattern=ARTIFACT_ID_PATTERN)
    downstream_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    relationship: StrictStr = Field(min_length=1, max_length=240)
    impact: Impact


class ScriptImpactReasonV1(_Closed):
    origin: Literal["EXACT_DEPENDENCY_PATH", "LEGACY_CONTENT_REFERENCE"]
    effective_impact: Impact
    edges: tuple[ScriptImpactDependencyV1, ...] = Field(max_length=64)

    @model_validator(mode="after")
    def origin_matches_edges(self) -> Self:
        if (self.origin == "EXACT_DEPENDENCY_PATH") != bool(self.edges):
            raise ValueError("Only real dependency paths contain dependency edges")
        if self.origin == "LEGACY_CONTENT_REFERENCE" and self.effective_impact != "advisory":
            raise ValueError("Legacy references are advisory review facts")
        return self


class ScriptImpactAudioV1(_Closed):
    kind: Literal["DIALOGUE_AUDIO"]
    script_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    segment: AssemblyAudioSegmentV1

    @model_validator(mode="after")
    def dialogue(self) -> Self:
        if self.segment.track_kind != "DIALOGUE":
            raise ValueError("Impact audio must be an exact dialogue reference")
        return self


class ScriptImpactReferenceSubtitleV1(_Closed):
    kind: Literal["REFERENCE_SUBTITLE"]
    script_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    segment: AssemblySubtitleSegmentV1


class ScriptImpactTextSubtitleV1(_Closed):
    kind: Literal["TEXT_SUBTITLE"]
    script_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    segment: AssemblyTextSubtitleSegmentV1

    @model_validator(mode="after")
    def reference(self) -> Self:
        if self.segment.script_ref is None:
            raise ValueError("Impacted literal subtitle needs an exact script reference")
        if self.segment.script_ref.script_content_hash != self.script_content_hash:
            raise ValueError("Subtitle source hash differs from impact evidence")
        return self


ScriptImpactSegmentV1 = Annotated[
    ScriptImpactAudioV1 | ScriptImpactReferenceSubtitleV1 | ScriptImpactTextSubtitleV1,
    Field(discriminator="kind"),
]


class ScriptImpactShotV1(_Closed):
    shot_id: StrictStr = Field(pattern=SHOT_ID_PATTERN)
    ordinal: StrictInt = Field(ge=1, le=1000)
    title: StrictStr = Field(min_length=1, max_length=240)
    duration_frames: StrictInt = Field(ge=1, le=864_000)
    script_scene_id: StrictStr | None = Field(pattern=r"^scn_[0-9a-f]{32}$")


class ScriptImpactStoryboardReferenceV1(_Closed):
    segment_id: StrictStr = Field(pattern=r"^seg_[a-z0-9._-]{1,80}$")
    start_frame: StrictInt = Field(ge=0)
    end_frame: StrictInt = Field(gt=0)
    storyboard_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    storyboard_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    shot: ScriptImpactShotV1


class ScriptImpactAssemblyContextV1(_Closed):
    kind: Literal["ASSEMBLY"]
    sequence_timebase: SequenceTimebaseData
    script_provenance: AssemblyDraftScriptProvenanceV1 | AssemblyConfirmedScriptProvenanceV1 | None
    segments: tuple[ScriptImpactSegmentV1, ...] = Field(max_length=2000)
    storyboard_references: tuple[ScriptImpactStoryboardReferenceV1, ...] = Field(max_length=1000)


class ScriptImpactStoryboardContextV1(_Closed):
    kind: Literal["STORYBOARD"]
    script_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    shots: tuple[ScriptImpactShotV1, ...] = Field(max_length=1000)


class ScriptImpactOtherContextV1(_Closed):
    kind: Literal["OTHER"]


ScriptImpactContextV1 = Annotated[
    ScriptImpactAssemblyContextV1 | ScriptImpactStoryboardContextV1 | ScriptImpactOtherContextV1,
    Field(discriminator="kind"),
]


class ScriptImpactTargetV1(_Closed):
    artifact_id: StrictStr = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    artifact_type: StrictStr = Field(min_length=1, max_length=100)
    episode_id: StrictStr | None = Field(pattern=EPISODE_ID_PATTERN)
    classification: Literal["SOURCE_SUPERSEDED", "REVIEW_REQUIRED", "ADVISORY_LEGACY_REVIEW"]
    aggregate_impact: Impact
    reasons: tuple[ScriptImpactReasonV1, ...] = Field(min_length=1, max_length=10000)
    context: ScriptImpactContextV1


class ScriptConfirmationImpactAssessmentV1(_Closed):
    schema_version: Literal["1.0.0"]
    algorithm_version: Literal["script-confirmation-exact-dependencies-v1"]
    source_kind: Literal["EPISODE_SCRIPT_CONFIRMATION"]
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    event_kind: EventKind
    old_confirmation: EpisodeScriptConfirmationData | None
    new_confirmation: EpisodeScriptConfirmationData
    targets: tuple[ScriptImpactTargetV1, ...] = Field(max_length=1000)

    @model_validator(mode="after")
    def consistent_sources(self) -> Self:
        new, old = self.new_confirmation, self.old_confirmation
        if new.project_id != self.project_id or new.episode_id != self.episode_id:
            raise ValueError("Confirmation impact has foreign new source")
        if old is not None and (
            old.project_id != self.project_id
            or old.episode_id != self.episode_id
            or old.artifact_id != new.artifact_id
            or old.confirmation_id == new.confirmation_id
        ):
            raise ValueError("Confirmation impact has foreign old source")
        expected = (
            "BASELINE"
            if old is None
            else "SAME_SOURCE"
            if (old.version_id, old.content_hash) == (new.version_id, new.content_hash)
            else "SOURCE_REPLACED"
        )
        if self.event_kind != expected or (expected != "SOURCE_REPLACED" and self.targets):
            raise ValueError("Confirmation event does not match actual source replacement")
        identities = [(t.artifact_id, t.version_id) for t in self.targets]
        if identities != sorted(set(identities)):
            raise ValueError("Affected versions must be distinct and canonically ordered")
        return self


class ScriptConfirmationImpactReportV1(_Closed):
    report_id: StrictStr = Field(pattern=REPORT_ID_PATTERN)
    assessment_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    created_at: AwareDatetime
    assessment: ScriptConfirmationImpactAssessmentV1


class ScriptConfirmationImpactResponse(_Closed):
    data: ScriptConfirmationImpactReportV1
    request_id: UUID


class ScriptConfirmationImpactSummaryV1(_Closed):
    report_id: StrictStr = Field(pattern=REPORT_ID_PATTERN)
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    new_confirmation_id: StrictStr = Field(pattern=CONFIRMATION_ID_PATTERN)
    old_confirmation_id: StrictStr | None = Field(pattern=CONFIRMATION_ID_PATTERN)
    new_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    old_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    event_kind: EventKind
    assessment_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    target_count: StrictInt = Field(ge=0, le=1000)
    reason_path_count: StrictInt = Field(ge=0, le=10000)
    segment_count: StrictInt = Field(ge=0)
    created_at: AwareDatetime


class ScriptConfirmationImpactPageData(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    items: tuple[ScriptConfirmationImpactSummaryV1, ...] = Field(max_length=50)
    next_cursor: StrictStr | None = Field(pattern=REPORT_ID_PATTERN)
    preexisting_confirmation_count: StrictInt = Field(ge=0)


class ScriptConfirmationImpactPageResponse(_Closed):
    data: ScriptConfirmationImpactPageData
    request_id: UUID


class ScriptConfirmationImpactLookupData(_Closed):
    coverage: Literal["RECORDED", "UNCOVERED_LEGACY"]
    confirmation: EpisodeScriptConfirmationData
    report: ScriptConfirmationImpactReportV1 | None

    @model_validator(mode="after")
    def covered_report(self) -> Self:
        if (self.coverage == "RECORDED") != (self.report is not None):
            raise ValueError("Covered confirmation requires its exact report")
        if self.report is not None and self.report.assessment.new_confirmation != self.confirmation:
            raise ValueError("Report does not bind this exact confirmation")
        return self


class ScriptConfirmationImpactLookupResponse(_Closed):
    data: ScriptConfirmationImpactLookupData
    request_id: UUID


class ScriptConfirmationOperationData(_Closed):
    # Preserve the existing journal/key bytes; UUID normalization changes its hash.
    operation_id: StrictStr = Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
    )
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    payload: CreateEpisodeScriptConfirmationRequest
    lookup: ScriptConfirmationImpactLookupData


class ScriptConfirmationOperationResponse(_Closed):
    data: ScriptConfirmationOperationData
    request_id: UUID
