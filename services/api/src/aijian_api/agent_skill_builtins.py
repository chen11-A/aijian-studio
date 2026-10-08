"""Version-pinned, provider-free Agent/Skill definitions shipped by Aijian."""

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.agent_proposal_validator import (
    ProposalSchemaRegistration,
    ProposalSchemaRegistry,
)
from aijian_api.agent_skill_contracts import (
    AgentDefinitionV1,
    BudgetPolicyV1,
    ContractCompatibilityV1,
    DefinitionRefV1,
    SkillDefinitionV1,
    SkillDefinitionV2,
)
from aijian_api.agent_skill_registry import (
    AgentRegistration,
    AgentSkillRegistry,
    SkillRegistration,
)
from aijian_api.shot_outline_contracts import ShotOutlinePayloadV1

SOURCE_ANALYST_REF = DefinitionRefV1(
    definition_id="writer.source-analyst",
    version="1.0.0",
)
SOURCE_EXTRACT_REF = DefinitionRefV1(
    definition_id="source.extract",
    version="1.0.0",
)
SOURCE_ANALYST_REMOTE_REF = DefinitionRefV1(
    definition_id="writer.source-analyst",
    version="1.1.0",
)
SOURCE_EXTRACT_REMOTE_REF = DefinitionRefV1(
    definition_id="source.extract",
    version="1.1.0",
)
SOURCE_ANALYST_SUB2API_REF = DefinitionRefV1(
    definition_id="writer.source-analyst-sub2api",
    version="1.0.0",
)
SOURCE_EXTRACT_SUB2API_REF = DefinitionRefV1(
    definition_id="source.extract-sub2api",
    version="1.0.0",
)
SHOT_PLANNER_REF = DefinitionRefV1(
    definition_id="director.shot-planner",
    version="1.0.0",
)
SHOT_OUTLINE_REF = DefinitionRefV1(
    definition_id="shot.outline",
    version="1.0.0",
)


class SourceExtractionPayloadV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    summary: str = Field(min_length=1, max_length=10_000)


SOURCE_ANALYST = AgentDefinitionV1(
    agent_definition_id=SOURCE_ANALYST_REF.definition_id,
    version=SOURCE_ANALYST_REF.version,
    display_name="编剧 Agent · 来源分析",
    role="writer",
    layer="EXECUTION",
    responsibilities=("提取来源事实", "提交带证据的结构化提案"),
    forbidden_actions=(
        "直接写入 ArtifactVersion",
        "代替具名人类审批",
        "直接调用 Provider 或读取凭据",
    ),
    skill_refs=(SOURCE_EXTRACT_REF,),
    default_policy_version="policy.local-safe@1.0.0",
    context_policy_version="context.progressive-five-layer@1.0.0",
    compatibility=ContractCompatibilityV1(
        minimum_schema_version="1.0.0",
        maximum_schema_version="1.0.0",
    ),
)

SOURCE_EXTRACT = SkillDefinitionV1(
    skill_definition_id=SOURCE_EXTRACT_REF.definition_id,
    version=SOURCE_EXTRACT_REF.version,
    display_name="来源提取",
    input_schema_ref="schema://aijian/SourceExtractInput/1.0.0",
    output_schema_ref="schema://aijian/SourceExtractionProposal/1.0.0",
    readable_artifact_types=("SourceManifest",),
    allowed_tools=("source.read",),
    allowed_provider_capabilities=("LOCAL_FAKE_TEXT",),
    budget=BudgetPolicyV1(
        soft_limit_micros=0,
        hard_limit_micros=0,
        retry_increment_limit_micros=0,
    ),
    timeout_seconds=30,
    max_attempts=2,
    required_gate="G1",
    invalidation_edges=("SourceManifest->SourceExtraction",),
    ui_renderer="proposal.source-extraction",
    fixture_refs=("fixture://agent-skill/contracts-v1",),
    compatibility=ContractCompatibilityV1(
        minimum_schema_version="1.0.0",
        maximum_schema_version="1.0.0",
    ),
)

# Kept out of the public built-in catalog until the authorized remote worker is wired.
SOURCE_ANALYST_REMOTE = AgentDefinitionV1.model_validate(
    {
        **SOURCE_ANALYST.model_dump(mode="json"),
        "version": SOURCE_ANALYST_REMOTE_REF.version,
        "skill_refs": [SOURCE_EXTRACT_REMOTE_REF.model_dump(mode="json")],
        "default_policy_version": "policy.cpa-loopback-text@1.0.0",
    }
)
SOURCE_EXTRACT_REMOTE = SkillDefinitionV1.model_validate(
    {
        **SOURCE_EXTRACT.model_dump(mode="json"),
        "version": SOURCE_EXTRACT_REMOTE_REF.version,
        "allowed_provider_capabilities": ["TEXT"],
        "max_attempts": 1,
    }
)

# Unknown external charges are represented by a distinct definition contract.
# This pair is not included in the general public built-in catalog.
SOURCE_ANALYST_SUB2API = AgentDefinitionV1.model_validate(
    {
        **SOURCE_ANALYST.model_dump(mode="json"),
        "agent_definition_id": SOURCE_ANALYST_SUB2API_REF.definition_id,
        "version": SOURCE_ANALYST_SUB2API_REF.version,
        "skill_refs": [SOURCE_EXTRACT_SUB2API_REF.model_dump(mode="json")],
        "default_policy_version": "policy.sub2api-one-call-unknown-cost@1.0.0",
        "compatibility": {
            "minimum_schema_version": "1.0.0",
            "maximum_schema_version": "2.0.0",
        },
    }
)
SOURCE_EXTRACT_SUB2API = SkillDefinitionV2.model_validate(
    {
        **SOURCE_EXTRACT.model_dump(mode="json"),
        "schema_version": "2.0.0",
        "skill_definition_id": SOURCE_EXTRACT_SUB2API_REF.definition_id,
        "version": SOURCE_EXTRACT_SUB2API_REF.version,
        "allowed_provider_capabilities": ["TEXT"],
        "budget": {
            "cost_status": "UNKNOWN",
            "currency": None,
            "soft_limit_micros": None,
            "hard_limit_micros": None,
            "retry_increment_limit_micros": None,
            "budget_enforcement": "UNENFORCED",
            "allowed_calls": 1,
            "automatic_retry_allowed": False,
        },
        "max_attempts": 1,
        "compatibility": {
            "minimum_schema_version": "2.0.0",
            "maximum_schema_version": "2.0.0",
        },
    }
)

SHOT_PLANNER = AgentDefinitionV1(
    agent_definition_id=SHOT_PLANNER_REF.definition_id,
    version=SHOT_PLANNER_REF.version,
    display_name="导演 Agent · 分镜规划",
    role="director",
    layer="EXECUTION",
    responsibilities=("生成八镜头开发提案", "保持镜头建议与来源证据关联"),
    forbidden_actions=(
        "直接写入 ArtifactVersion",
        "代替具名人类审批",
        "直接调用 Provider 或读取凭据",
    ),
    skill_refs=(SHOT_OUTLINE_REF,),
    default_policy_version="policy.local-safe@1.0.0",
    context_policy_version="context.progressive-five-layer@1.0.0",
    compatibility=ContractCompatibilityV1(
        minimum_schema_version="1.0.0",
        maximum_schema_version="1.0.0",
    ),
)

SHOT_OUTLINE = SkillDefinitionV1(
    skill_definition_id=SHOT_OUTLINE_REF.definition_id,
    version=SHOT_OUTLINE_REF.version,
    display_name="八镜头提纲",
    input_schema_ref="schema://aijian/ShotOutlineInput/1.0.0",
    output_schema_ref="schema://aijian/ShotOutlineProposal/1.0.0",
    readable_artifact_types=("SourceManifest",),
    allowed_tools=("source.read",),
    allowed_provider_capabilities=("LOCAL_FAKE_TEXT",),
    budget=BudgetPolicyV1(
        soft_limit_micros=0,
        hard_limit_micros=0,
        retry_increment_limit_micros=0,
    ),
    timeout_seconds=30,
    max_attempts=2,
    required_gate="G1A",
    invalidation_edges=("SourceManifest->ShotOutline",),
    ui_renderer="proposal.shot-outline",
    fixture_refs=("fixture://agent-skill/contracts-v1",),
    compatibility=ContractCompatibilityV1(
        minimum_schema_version="1.0.0",
        maximum_schema_version="1.0.0",
    ),
)


def built_in_agent_skill_registry() -> AgentSkillRegistry:
    return AgentSkillRegistry(
        agents=(AgentRegistration(SOURCE_ANALYST), AgentRegistration(SHOT_PLANNER)),
        skills=(SkillRegistration(SOURCE_EXTRACT), SkillRegistration(SHOT_OUTLINE)),
    )


def remote_source_extract_registry() -> AgentSkillRegistry:
    """Resolve only the versioned, text-only remote source extraction pair."""

    return AgentSkillRegistry(
        agents=(AgentRegistration(SOURCE_ANALYST_REMOTE),),
        skills=(SkillRegistration(SOURCE_EXTRACT_REMOTE),),
    )


def sub2api_source_extract_registry() -> AgentSkillRegistry:
    """Resolve only the external, one-call text pair with unknown cost."""

    return AgentSkillRegistry(
        agents=(AgentRegistration(SOURCE_ANALYST_SUB2API),),
        skills=(SkillRegistration(SOURCE_EXTRACT_SUB2API),),
    )


def proposal_acceptance_agent_skill_registry() -> AgentSkillRegistry:
    """Resolve local and Sub2API proposals without exposing the remote pair in the catalog."""

    return AgentSkillRegistry(
        agents=(
            AgentRegistration(SOURCE_ANALYST),
            AgentRegistration(SHOT_PLANNER),
            AgentRegistration(SOURCE_ANALYST_SUB2API),
        ),
        skills=(
            SkillRegistration(SOURCE_EXTRACT),
            SkillRegistration(SHOT_OUTLINE),
            SkillRegistration(SOURCE_EXTRACT_SUB2API),
        ),
    )


def built_in_proposal_schema_registry() -> ProposalSchemaRegistry:
    return ProposalSchemaRegistry(
        (
            ProposalSchemaRegistration(
                schema_ref=SOURCE_EXTRACT.output_schema_ref,
                payload_model=SourceExtractionPayloadV1,
            ),
            ProposalSchemaRegistration(
                schema_ref=SHOT_OUTLINE.output_schema_ref,
                payload_model=ShotOutlinePayloadV1,
            ),
        )
    )
