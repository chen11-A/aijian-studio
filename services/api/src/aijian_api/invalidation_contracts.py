"""Typed HTTP contracts for invalidation ledger detail reads."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from aijian_api.contracts import (
    ARTIFACT_ID_PATTERN,
    PROJECT_ID_PATTERN,
    VERSION_ID_PATTERN,
)

OPERATION_ID_PATTERN = r"^ivo_[0-9a-f]{32}$"
PATH_ID_PATTERN = r"^ivp_[0-9a-f]{32}$"
GATE_DECISION_ID_PATTERN = r"^dec_[0-9a-f]{32}$"
ASSESSMENT_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"
IMPACT = Literal["blocking", "advisory", "render_only"]
CLASSIFICATION = Literal["STALE", "INVALIDATE"]
DEPENDENCY_ID = Annotated[str, Field(pattern=r"^dep_[0-9a-f]{32}$")]


class InvalidationReasonPathData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path_id: str = Field(pattern=PATH_ID_PATTERN)
    operation_id: str = Field(pattern=OPERATION_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    affected_artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    affected_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    classification: CLASSIFICATION
    aggregate_impact: IMPACT
    dependency_ids: list[DEPENDENCY_ID] = Field(min_length=1)
    relationships: list[str] = Field(min_length=1)
    edge_impacts: list[IMPACT] = Field(min_length=1)
    effective_impact: IMPACT
    ordinal: int = Field(ge=0)
    created_at: AwareDatetime

    @model_validator(mode="after")
    def validate_arrays_and_ids(self) -> InvalidationReasonPathData:
        if not (len(self.dependency_ids) == len(self.relationships) == len(self.edge_impacts)):
            raise ValueError("path arrays must have equal lengths")
        if any(not value for value in self.relationships):
            raise ValueError("relationships must not be empty")
        return self


class InvalidationOperationData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: str = Field(pattern=OPERATION_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    changed_artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    old_accepted_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    new_accepted_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    gate_decision_id: str = Field(pattern=GATE_DECISION_ID_PATTERN)
    assessment_hash: str = Field(pattern=ASSESSMENT_HASH_PATTERN)
    created_at: AwareDatetime
    paths: list[InvalidationReasonPathData] = Field(max_length=10000)

    @model_validator(mode="after")
    def validate_paths(self) -> InvalidationOperationData:
        for path in self.paths:
            if path.operation_id != self.operation_id or path.project_id != self.project_id:
                raise ValueError("nested path ownership is invalid")
        if [path.ordinal for path in self.paths] != list(range(len(self.paths))):
            raise ValueError("path ordinals are not contiguous")
        return self


class InvalidationOperationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: InvalidationOperationData
    request_id: UUID
