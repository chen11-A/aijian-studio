import hashlib
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import pytest
from aijian_api.agent_proposal_validator import (
    ProposalSchemaRegistration,
    ProposalSchemaRegistry,
    ProposalValidationError,
    ResolvedProposalSchema,
    accept_proposal_as_draft,
)
from aijian_api.agent_skill_contracts import (
    AgentRunV1,
    AgentSkillFixtureBundleV1,
    ArtifactProposalV1,
    ProposalDependencyV1,
    ProposalQcV1,
    ProposalSourceSpanV1,
    SkillRunV1,
    canonical_sha256,
)
from aijian_api.agent_skill_registry import (
    AgentRegistration,
    AgentSkillRegistry,
    ResolvedDelegation,
    SkillRegistration,
)
from aijian_api.domain import (
    ArtifactDependencyDraft,
    ArtifactVersionRecord,
    Project,
    SourceDocument,
    TrustedReviewActor,
)
from aijian_api.ingestion import ingest_text_file
from aijian_api.repository import (
    AcceptedArtifactDependencyRequirement,
    ArtifactConflictError,
    ArtifactDependencyInvalidError,
    StudioRepository,
)
from pydantic import BaseModel, ConfigDict

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"
LOCAL_ACTOR = TrustedReviewActor(subject_id="local-user", roles=("writer", "producer"))


class SummaryPayloadV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    summary: str


class AlternatePayloadV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    title: str


class LoosePayloadV1(BaseModel):
    summary: str


def deterministic_id_factory() -> Callable[[str], str]:
    counters: defaultdict[str, int] = defaultdict(int)

    def create_id(prefix: str) -> str:
        counters[prefix] += 1
        return f"{prefix}_{counters[prefix]:032x}"

    return create_id


def repository_at(database: Path) -> StudioRepository:
    return StudioRepository(
        database,
        id_factory=deterministic_id_factory(),
        clock=lambda: datetime(2026, 8, 10, 9, 0, tzinfo=UTC),
    )


def fixture_bundle() -> AgentSkillFixtureBundleV1:
    return AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))


def setup_proposal(
    repository: StudioRepository,
) -> tuple[
    AgentSkillFixtureBundleV1,
    Project,
    SourceDocument,
    ArtifactProposalV1,
    AgentRunV1,
    SkillRunV1,
    ResolvedDelegation,
]:
    bundle = fixture_bundle()
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    source = repository.import_source(
        project.id,
        ingest_text_file(filename="story.txt", content="林见收到未署名的信。".encode()),
    )
    block = source.blocks[0]
    quote = source.normalized_text.encode()[block.normalized_start_byte : block.normalized_end_byte]
    span = ProposalSourceSpanV1(
        source_span_id=f"spn_{'4' * 32}",
        source_document_id=source.id,
        source_block_id=block.id,
        start_byte=block.normalized_start_byte,
        end_byte=block.normalized_end_byte,
        claim="林见收到未署名的信",
        quote_hash=f"sha256:{hashlib.sha256(quote).hexdigest()}",
    )
    proposal = bundle.artifact_proposal.model_copy(
        update={
            "project_id": project.id,
            "source_spans": (span,),
            "dependencies": (),
        }
    )
    agent_run = bundle.agent_run.model_copy(update={"project_id": project.id})
    skill_run = bundle.skill_run.model_copy(update={"project_id": project.id})
    registry = AgentSkillRegistry(
        agents=(AgentRegistration(bundle.agent_definition),),
        skills=(SkillRegistration(bundle.skill_definition),),
    )
    delegation = registry.resolve_delegation(
        agent_run.agent_definition,
        skill_run.skill_definition,
    )
    return bundle, project, source, proposal, agent_run, skill_run, delegation


def proposal_schema_registry(bundle: AgentSkillFixtureBundleV1) -> ProposalSchemaRegistry:
    return ProposalSchemaRegistry(
        (
            ProposalSchemaRegistration(
                schema_ref=bundle.skill_definition.output_schema_ref,
                payload_model=SummaryPayloadV1,
            ),
            ProposalSchemaRegistration(
                schema_ref="schema://aijian/AlternateProposal/1.0.0",
                payload_model=AlternatePayloadV1,
            ),
        )
    )


def resolved_proposal_schema(bundle: AgentSkillFixtureBundleV1) -> ResolvedProposalSchema:
    return proposal_schema_registry(bundle).resolve(bundle.skill_definition.output_schema_ref)


def approve_source_manifest(
    repository: StudioRepository,
    project: Project,
    artifact: ArtifactVersionRecord,
) -> None:
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=artifact.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        expected_revision=artifact.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        action="signoff",
        action_payload={"roles": ["writer", "producer"]},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        roles=("writer", "producer"),
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    rationale = "来源清单已由具名制片批准"
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": rationale,
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        decision="approved",
        rationale=rationale,
        expected_revision=signed.head.revision,
        challenge_id=prepared_decision.challenge.id,
        confirmation_token=prepared_decision.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )


def accept(
    repository: StudioRepository,
    *,
    proposal_schema: ResolvedProposalSchema | None = None,
    proposal_updates: dict[str, object] | None = None,
) -> tuple[
    ArtifactVersionRecord,
    AgentSkillFixtureBundleV1,
    Project,
    SourceDocument,
    ArtifactProposalV1,
]:
    bundle, project, source, proposal, agent_run, skill_run, delegation = setup_proposal(repository)
    proposal = proposal.model_copy(update=proposal_updates or {})
    return (
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal,
            agent_run=agent_run,
            skill_run=skill_run,
            delegation=delegation,
            proposal_schema=proposal_schema or resolved_proposal_schema(bundle),
        ),
        bundle,
        project,
        source,
        proposal,
    )


def test_accepts_valid_proposal_as_immutable_unapproved_draft(tmp_path: Path) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    result, bundle, project, _source, proposal = accept(repository)

    assert result.version.content == proposal.payload
    assert result.version.author_actor_type == "agent"
    assert result.version.author_actor_id == proposal.producer_skill_run_id
    assert result.version.schema_version == "1.0.0"
    assert result.head.latest_version_id == result.version.id
    assert result.head.review_version_id is None
    assert result.head.accepted_version_id is None
    assert result.source_spans[0].quote_hash == proposal.source_spans[0].quote_hash
    assert result.source_spans[0].fact_id == proposal.source_spans[0].source_span_id

    with pytest.raises(ArtifactConflictError):
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal,
            agent_run=fixture_bundle().agent_run.model_copy(update={"project_id": project.id}),
            skill_run=fixture_bundle().skill_run.model_copy(update={"project_id": project.id}),
            delegation=AgentSkillRegistry(
                agents=(AgentRegistration(fixture_bundle().agent_definition),),
                skills=(SkillRegistration(fixture_bundle().skill_definition),),
            ).resolve_delegation(
                fixture_bundle().agent_run.agent_definition,
                fixture_bundle().skill_run.skill_definition,
            ),
            proposal_schema=resolved_proposal_schema(bundle),
        )
    restored = repository.get_artifact_version(
        project.id,
        "source_extraction",
        result.version.id,
    )
    assert restored.version.content_hash == result.version.content_hash


def test_schema_failure_creates_no_draft(tmp_path: Path) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    invalid_payload = {"title": "wrong output shape"}

    with pytest.raises(ProposalValidationError, match="output schema"):
        accept(
            repository,
            proposal_updates={
                "payload": invalid_payload,
                "payload_hash": canonical_sha256(invalid_payload),
            },
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(repository.list_projects()[0].id, "source_extraction")


def test_schema_registry_rejects_loose_models_and_unvalidated_fields(tmp_path: Path) -> None:
    bundle = fixture_bundle()
    with pytest.raises(ValueError, match="extra='forbid'.*strict=True"):
        ProposalSchemaRegistry(
            (
                ProposalSchemaRegistration(
                    schema_ref=bundle.skill_definition.output_schema_ref,
                    payload_model=LoosePayloadV1,
                ),
            )
        )

    repository = repository_at(tmp_path / "workspace.db")
    invalid_payload = {"summary": "looks valid", "provider_backdoor": "must not persist"}
    with pytest.raises(ProposalValidationError, match="output schema"):
        accept(
            repository,
            proposal_updates={
                "payload": invalid_payload,
                "payload_hash": canonical_sha256(invalid_payload),
            },
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(repository.list_projects()[0].id, "source_extraction")


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        (
            {
                "cost": fixture_bundle().artifact_proposal.cost.model_copy(
                    update={"actual_micros": 1}
                )
            },
            "budget",
        ),
        (
            {"qc": (ProposalQcV1(check_id="source-span.required", status="FAIL", details="bad"),)},
            "QC",
        ),
    ],
)
def test_budget_or_qc_failure_creates_no_draft(
    tmp_path: Path,
    updates: dict[str, object],
    message: str,
) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    with pytest.raises(ProposalValidationError, match=message):
        accept(repository, proposal_updates=updates)
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(repository.list_projects()[0].id, "source_extraction")


def test_quote_hash_mismatch_rolls_back_draft(tmp_path: Path) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    bundle, project, _source, proposal, agent_run, skill_run, delegation = setup_proposal(
        repository
    )
    bad_span = proposal.source_spans[0].model_copy(update={"quote_hash": f"sha256:{'f' * 64}"})
    proposal = proposal.model_copy(update={"source_spans": (bad_span,)})

    with pytest.raises(ProposalValidationError, match="quote hash"):
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal,
            agent_run=agent_run,
            skill_run=skill_run,
            delegation=delegation,
            proposal_schema=resolved_proposal_schema(bundle),
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "source_extraction")


def test_utf8_mid_codepoint_source_span_rolls_back_draft(tmp_path: Path) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    bundle, project, _source, proposal, agent_run, skill_run, delegation = setup_proposal(
        repository
    )
    span = proposal.source_spans[0]
    invalid_span = span.model_copy(
        update={
            "start_byte": span.start_byte + 1,
            "quote_hash": f"sha256:{'0' * 64}",
        }
    )

    with pytest.raises(ProposalValidationError, match="SourceSpan"):
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal.model_copy(update={"source_spans": (invalid_span,)}),
            agent_run=agent_run,
            skill_run=skill_run,
            delegation=delegation,
            proposal_schema=resolved_proposal_schema(bundle),
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "source_extraction")


def test_cross_project_source_span_rolls_back_draft(tmp_path: Path) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    bundle, project, _source, proposal, agent_run, skill_run, delegation = setup_proposal(
        repository
    )
    other_project = repository.create_project(
        name="另一项目",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    other_source = repository.import_source(
        other_project.id,
        ingest_text_file(filename="other.txt", content="不属于目标项目的原文。".encode()),
    )
    other_block = other_source.blocks[0]
    other_quote = other_source.normalized_text.encode()[
        other_block.normalized_start_byte : other_block.normalized_end_byte
    ]
    foreign_span = proposal.source_spans[0].model_copy(
        update={
            "source_document_id": other_source.id,
            "source_block_id": other_block.id,
            "start_byte": other_block.normalized_start_byte,
            "end_byte": other_block.normalized_end_byte,
            "quote_hash": f"sha256:{hashlib.sha256(other_quote).hexdigest()}",
        }
    )

    with pytest.raises(ProposalValidationError, match="SourceSpan"):
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal.model_copy(update={"source_spans": (foreign_span,)}),
            agent_run=agent_run,
            skill_run=skill_run,
            delegation=delegation,
            proposal_schema=resolved_proposal_schema(bundle),
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "source_extraction")


def test_cross_project_dependency_creates_no_draft(tmp_path: Path) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    bundle, project, _source, proposal, agent_run, skill_run, delegation = setup_proposal(
        repository
    )
    other_project = repository.create_project(
        name="另一项目",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    repository.import_source(
        other_project.id,
        ingest_text_file(filename="other.txt", content="另一份原文。".encode()),
    )
    foreign_head = repository.get_artifact_head(other_project.id, "source_manifest")
    dependency = ProposalDependencyV1(
        artifact_type="SourceManifest",
        version_id=foreign_head.latest_version_id,
        approval_required=True,
    )

    with pytest.raises(ProposalValidationError, match="belong to the project"):
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal.model_copy(update={"dependencies": (dependency,)}),
            agent_run=agent_run,
            skill_run=skill_run,
            delegation=delegation,
            proposal_schema=resolved_proposal_schema(bundle),
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "source_extraction")


def test_accepted_dependency_creates_draft_with_exact_version(tmp_path: Path) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    bundle, project, _source, proposal, agent_run, skill_run, delegation = setup_proposal(
        repository
    )
    manifest_head = repository.get_artifact_head(project.id, "source_manifest")
    upstream = repository.get_artifact_version(
        project.id,
        "source_manifest",
        manifest_head.latest_version_id,
    )
    approve_source_manifest(repository, project, upstream)
    dependency = ProposalDependencyV1(
        artifact_type="SourceManifest",
        version_id=upstream.version.id,
        approval_required=True,
    )

    result = accept_proposal_as_draft(
        repository=repository,
        proposal=proposal.model_copy(update={"dependencies": (dependency,)}),
        agent_run=agent_run,
        skill_run=skill_run,
        delegation=delegation,
        proposal_schema=resolved_proposal_schema(bundle),
    )

    assert result.dependencies[0].upstream_version_id == upstream.version.id
    assert result.head.accepted_version_id is None


def test_repository_transaction_rejects_dependency_that_is_no_longer_accepted(
    tmp_path: Path,
) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    _bundle, project, _source, _proposal, _agent_run, _skill_run, _delegation = setup_proposal(
        repository
    )
    first_head = repository.get_artifact_head(project.id, "source_manifest")
    first = repository.get_artifact_version(
        project.id,
        "source_manifest",
        first_head.latest_version_id,
    )
    approve_source_manifest(repository, project, first)
    prechecked = repository.get_artifact_version(
        project.id,
        "source_manifest",
        first.version.id,
    )
    assert prechecked.head.accepted_version_id == first.version.id

    repository.import_source(
        project.id,
        ingest_text_file(filename="second.txt", content="第二份授权原文。".encode()),
    )
    second_head = repository.get_artifact_head(project.id, "source_manifest")
    second = repository.get_artifact_version(
        project.id,
        "source_manifest",
        second_head.latest_version_id,
    )
    approve_source_manifest(repository, project, second)

    dependency = ArtifactDependencyDraft(
        upstream_version_id=first.version.id,
        relationship="derived_from",
        impact="blocking",
    )
    with pytest.raises(ArtifactDependencyInvalidError, match="current accepted"):
        repository.create_artifact_version(
            project_id=project.id,
            artifact_type="source_extraction",
            schema_version="1.0.0",
            content={"summary": "must roll back"},
            author_actor_type="agent",
            author_actor_id="test-skill-run",
            change_summary="stale accepted dependency",
            dependencies=(dependency,),
            accepted_dependency_requirements=(
                AcceptedArtifactDependencyRequirement(
                    artifact_type="source_manifest",
                    version_id=first.version.id,
                ),
            ),
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "source_extraction")


def test_unaccepted_or_undeclared_dependency_creates_no_draft(tmp_path: Path) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    bundle, project, _source, proposal, agent_run, skill_run, delegation = setup_proposal(
        repository
    )
    manifest_head = repository.get_artifact_head(project.id, "source_manifest")
    upstream = repository.get_artifact_version(
        project.id,
        "source_manifest",
        manifest_head.latest_version_id,
    )
    dependency = ProposalDependencyV1(
        artifact_type="SourceManifest",
        version_id=upstream.version.id,
        approval_required=True,
    )
    proposal = proposal.model_copy(update={"dependencies": (dependency,)})
    with pytest.raises(ProposalValidationError, match="accepted"):
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal,
            agent_run=agent_run,
            skill_run=skill_run,
            delegation=delegation,
            proposal_schema=resolved_proposal_schema(bundle),
        )

    undeclared_skill = bundle.skill_definition.model_copy(update={"readable_artifact_types": ()})
    undeclared_registry = AgentSkillRegistry(
        agents=(AgentRegistration(bundle.agent_definition),),
        skills=(SkillRegistration(undeclared_skill),),
    )
    with pytest.raises(ProposalValidationError, match="cannot read"):
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal,
            agent_run=agent_run,
            skill_run=skill_run,
            delegation=undeclared_registry.resolve_delegation(
                agent_run.agent_definition,
                skill_run.skill_definition,
            ),
            proposal_schema=resolved_proposal_schema(bundle),
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "source_extraction")


def test_run_chain_or_target_schema_mismatch_fails_closed(tmp_path: Path) -> None:
    repository = repository_at(tmp_path / "workspace.db")
    bundle, project, _source, proposal, agent_run, skill_run, delegation = setup_proposal(
        repository
    )
    bad_skill_run = skill_run.model_copy(update={"proposal_id": None})

    with pytest.raises(ProposalValidationError, match="run chain"):
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal,
            agent_run=agent_run,
            skill_run=bad_skill_run,
            delegation=delegation,
            proposal_schema=resolved_proposal_schema(bundle),
        )
    alternate_schema = proposal_schema_registry(bundle).resolve(
        "schema://aijian/AlternateProposal/1.0.0"
    )
    with pytest.raises(ProposalValidationError, match="does not match"):
        accept_proposal_as_draft(
            repository=repository,
            proposal=proposal,
            agent_run=agent_run,
            skill_run=skill_run,
            delegation=delegation,
            proposal_schema=alternate_schema,
        )
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(project.id, "source_extraction")
