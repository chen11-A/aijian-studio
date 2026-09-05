"""Closed dispatcher for the two enabled provider-free proposal run slices."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from aijian_api.agent_skill_builtins import SHOT_OUTLINE_REF, SHOT_PLANNER_REF
from aijian_api.agent_skill_registry import AgentSkillRegistry
from aijian_api.contracts import CreateProposalRunRequest
from aijian_api.repository import StudioRepository
from aijian_api.shot_outline_run_factory import CreatedShotOutlineRun, ShotOutlineRunFactory
from aijian_api.source_extract_run_factory import CreatedProposalRun, SourceExtractRunFactory


class ProposalRunFactory:
    """Dispatch only the explicitly enabled source and ShotOutline pairs."""

    def __init__(
        self,
        repository: StudioRepository,
        registry: AgentSkillRegistry,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._source = SourceExtractRunFactory(repository, registry, clock=clock)
        self._shot = ShotOutlineRunFactory(repository, registry, clock=clock)

    def create(
        self,
        *,
        project_id: str,
        payload: CreateProposalRunRequest,
        idempotency_key: str,
    ) -> CreatedProposalRun | CreatedShotOutlineRun:
        if (
            payload.agent_definition == SHOT_PLANNER_REF
            and payload.skill_definition == SHOT_OUTLINE_REF
        ):
            return self._shot.create(
                project_id=project_id,
                payload=payload,
                idempotency_key=idempotency_key,
            )
        return self._source.create(
            project_id=project_id,
            payload=payload,
            idempotency_key=idempotency_key,
        )
