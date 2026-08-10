"""Version-pinned, provider-free Agent/Skill definitions shipped by Aijian."""

from aijian_api.agent_skill_contracts import (
    AgentDefinitionV1,
    BudgetPolicyV1,
    ContractCompatibilityV1,
    DefinitionRefV1,
    SkillDefinitionV1,
)
from aijian_api.agent_skill_registry import (
    AgentRegistration,
    AgentSkillRegistry,
    SkillRegistration,
)

SOURCE_ANALYST_REF = DefinitionRefV1(
    definition_id="writer.source-analyst",
    version="1.0.0",
)
SOURCE_EXTRACT_REF = DefinitionRefV1(
    definition_id="source.extract",
    version="1.0.0",
)

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


def built_in_agent_skill_registry() -> AgentSkillRegistry:
    return AgentSkillRegistry(
        agents=(AgentRegistration(SOURCE_ANALYST),),
        skills=(SkillRegistration(SOURCE_EXTRACT),),
    )
