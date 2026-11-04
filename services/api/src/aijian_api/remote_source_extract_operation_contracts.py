"""Read-only status contract for one queued remote SourceExtraction run."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.contracts import (
    AGENT_RUN_ID_PATTERN,
    ATTEMPT_ID_PATTERN,
    CONTENT_HASH_PATTERN,
    NODE_RUN_ID_PATTERN,
    PROJECT_ID_PATTERN,
    PROPOSAL_ID_PATTERN,
    SOURCE_BLOCK_ID_PATTERN,
    SOURCE_ID_PATTERN,
    TASK_ID_PATTERN,
    VERSION_ID_PATTERN,
    WORKFLOW_RUN_ID_PATTERN,
)
from aijian_api.provider_contracts import PROVIDER_CONNECTION_ID_PATTERN
from aijian_api.remote_call_accounting import RemoteCallAccountingData


class RemoteSourceExtractOperationSourceData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_manifest_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    source_document_id: str = Field(pattern=SOURCE_ID_PATTERN)
    source_block_id: str = Field(pattern=SOURCE_BLOCK_ID_PATTERN)
    start_byte: int = Field(ge=0)
    end_byte: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self) -> RemoteSourceExtractOperationSourceData:
        if self.end_byte <= self.start_byte:
            raise ValueError("source byte range is empty")
        return self


class RemoteSourceExtractOperationSelectionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_id: str = Field(pattern=PROVIDER_CONNECTION_ID_PATTERN)
    connection_revision: int = Field(ge=1)
    model_id: str = Field(min_length=1, max_length=200)


class RemoteSourceExtractOperationTaskData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_run_id: str = Field(pattern=WORKFLOW_RUN_ID_PATTERN)
    workflow_status: str
    node_run_id: str = Field(pattern=NODE_RUN_ID_PATTERN)
    node_status: str
    attempt_id: str = Field(pattern=ATTEMPT_ID_PATTERN)
    attempt_status: str
    task_id: str = Field(pattern=TASK_ID_PATTERN)
    task_status: str
    provider_response_id: str | None


class RemoteSourceExtractOperationData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    run_id: str = Field(pattern=AGENT_RUN_ID_PATTERN)
    operation_status: Literal["PENDING_ENQUEUE", "TRACKED"]
    intent_request_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    intent_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    execution_idempotency_key_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    source: RemoteSourceExtractOperationSourceData
    selection: RemoteSourceExtractOperationSelectionData
    task: RemoteSourceExtractOperationTaskData | None
    proposal_id: str | None = Field(default=None, pattern=PROPOSAL_ID_PATTERN)
    raw_response_body_status: Literal["NOT_PERSISTED"] = "NOT_PERSISTED"
    accounting: RemoteCallAccountingData | None


class RemoteSourceExtractOperationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: RemoteSourceExtractOperationData
    request_id: UUID
