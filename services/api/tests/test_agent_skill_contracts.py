import json
from copy import deepcopy
from pathlib import Path

import pytest
from aijian_api.agent_skill_contracts import (
    MAX_SAFE_JSON_INTEGER,
    AgentDefinitionV1,
    AgentSkillFixtureBundleV1,
    ArtifactProposalV1,
    AttemptSnapshotV1,
    ContextManifestV1,
    SkillDefinitionV1,
    canonical_sha256,
)
from pydantic import ValidationError

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"
ATTEMPT_FINGERPRINT_FIELDS = (
    "project_id",
    "agent_run_id",
    "skill_run_id",
    "output_artifact_type",
    "agent_definition_id",
    "agent_version",
    "skill_definition_id",
    "skill_version",
    "prompt_version",
    "policy_version",
    "provider_connection_id",
    "model_id",
    "capability_snapshot_hash",
    "input_hash",
    "output_schema_version",
    "idempotency_key",
)


def fixture_data() -> dict[str, object]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_versioned_agent_skill_fixture_validates_as_one_closed_bundle() -> None:
    bundle = AgentSkillFixtureBundleV1.model_validate(fixture_data())

    assert bundle.schema_version == "1.0.0"
    assert bundle.agent_definition.layer == "EXECUTION"
    assert bundle.skill_definition.skill_definition_id == "source.extract"
    assert bundle.context_manifest.entries[-1].kind == "TASK_OUTPUT_SCHEMA"
    assert bundle.artifact_proposal.source_spans
    assert bundle.attempt.attempt_fingerprint.startswith("sha256:")


@pytest.mark.parametrize(
    "model",
    [
        AgentSkillFixtureBundleV1,
        SkillDefinitionV1,
        ContextManifestV1,
        ArtifactProposalV1,
        AttemptSnapshotV1,
    ],
)
def test_public_json_schemas_are_closed(model: type[object]) -> None:
    schema = model.model_json_schema()  # type: ignore[attr-defined]

    def assert_closed(value: object) -> None:
        if isinstance(value, dict):
            if value.get("type") == "object" and value.get("title") != "Payload":
                assert value.get("additionalProperties") is False
            for child in value.values():
                assert_closed(child)
        elif isinstance(value, list):
            for child in value:
                assert_closed(child)

    assert_closed(schema)


def test_context_manifest_rejects_out_of_order_or_promoted_untrusted_content() -> None:
    raw = fixture_data()["context_manifest"]
    assert isinstance(raw, dict)

    out_of_order = deepcopy(raw)
    entries = out_of_order["entries"]
    assert isinstance(entries, list)
    entries[0], entries[-1] = entries[-1], entries[0]
    with pytest.raises(ValidationError, match="fixed progressive order"):
        ContextManifestV1.model_validate(out_of_order)

    promoted = deepcopy(raw)
    promoted_entries = promoted["entries"]
    assert isinstance(promoted_entries, list)
    source_entry = next(entry for entry in promoted_entries if entry["kind"] == "SOURCE_SPAN")
    source_entry["trust_level"] = "SYSTEM_INSTRUCTION"
    with pytest.raises(ValidationError, match="UNTRUSTED_CONTENT"):
        ContextManifestV1.model_validate(promoted)

    relabeled_agent = deepcopy(raw)
    relabeled_agent["agent_definition"] = {
        "definition_id": "writer.execution",
        "version": "1.0.0",
    }
    with pytest.raises(ValidationError, match="manifest_hash"):
        ContextManifestV1.model_validate(relabeled_agent)

    whole_novel = deepcopy(raw)
    whole_novel_entries = whole_novel["entries"]
    assert isinstance(whole_novel_entries, list)
    source_entry = next(entry for entry in whole_novel_entries if entry["kind"] == "SOURCE_SPAN")
    source_entry["byte_count"] = 3 * 1024 * 1024
    whole_novel["total_byte_count"] = sum(entry["byte_count"] for entry in whole_novel_entries)
    with pytest.raises(ValidationError):
        ContextManifestV1.model_validate(whole_novel)


def test_proposal_requires_source_evidence_and_exact_payload_hash() -> None:
    raw = fixture_data()["artifact_proposal"]
    assert isinstance(raw, dict)

    missing_evidence = deepcopy(raw)
    missing_evidence["source_spans"] = []
    with pytest.raises(ValidationError):
        ArtifactProposalV1.model_validate(missing_evidence)

    tampered_payload = deepcopy(raw)
    payload = tampered_payload["payload"]
    assert isinstance(payload, dict)
    payload["summary"] = "tampered"
    with pytest.raises(ValidationError, match="payload_hash"):
        ArtifactProposalV1.model_validate(tampered_payload)


def test_skill_contract_fails_closed_for_undeclared_capabilities_and_retry_budget() -> None:
    raw = fixture_data()["skill_definition"]
    assert isinstance(raw, dict)

    undeclared = deepcopy(raw)
    undeclared["runtime_script"] = "provider.execute(arbitrary_code)"
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        SkillDefinitionV1.model_validate(undeclared)

    unlimited_retry = deepcopy(raw)
    unlimited_retry["max_attempts"] = 3
    with pytest.raises(ValidationError):
        SkillDefinitionV1.model_validate(unlimited_retry)

    for field, invalid_value in {
        "readable_artifact_types": ["not an artifact type"],
        "allowed_tools": ["*"],
        "allowed_provider_capabilities": [""],
    }.items():
        invalid_allowlist = deepcopy(raw)
        invalid_allowlist[field] = invalid_value
        with pytest.raises(ValidationError):
            SkillDefinitionV1.model_validate(invalid_allowlist)


def test_budget_timeout_cost_and_claim_evidence_fail_closed() -> None:
    skill = fixture_data()["skill_definition"]
    proposal = fixture_data()["artifact_proposal"]
    assert isinstance(skill, dict)
    assert isinstance(proposal, dict)

    for mutation in (
        {
            "budget": {
                "currency": "USD",
                "soft_limit_micros": 1.5,
                "hard_limit_micros": 2,
                "retry_increment_limit_micros": 0,
            }
        },
        {
            "budget": {
                "currency": "USD",
                "soft_limit_micros": 2,
                "hard_limit_micros": 1,
                "retry_increment_limit_micros": 0,
            }
        },
        {
            "budget": {
                "currency": "USD",
                "soft_limit_micros": 0,
                "hard_limit_micros": 1,
                "retry_increment_limit_micros": 2,
            }
        },
        {
            "budget": {
                "currency": "USD",
                "soft_limit_micros": 0,
                "hard_limit_micros": MAX_SAFE_JSON_INTEGER + 1,
                "retry_increment_limit_micros": 0,
            }
        },
        {"timeout_seconds": 0},
        {"timeout_seconds": 86_401},
    ):
        invalid_skill = deepcopy(skill)
        invalid_skill.update(mutation)
        with pytest.raises(ValidationError):
            SkillDefinitionV1.model_validate(invalid_skill)

    for field in ("responsibilities", "forbidden_actions"):
        invalid_agent = deepcopy(fixture_data()["agent_definition"])
        invalid_agent[field] = [""]
        with pytest.raises(ValidationError):
            AgentDefinitionV1.model_validate(invalid_agent)

    invalid_fixture_ref = deepcopy(skill)
    invalid_fixture_ref["fixture_refs"] = [""]
    with pytest.raises(ValidationError):
        SkillDefinitionV1.model_validate(invalid_fixture_ref)

    unicode_agent = deepcopy(fixture_data()["agent_definition"])
    unicode_agent["display_name"] = "😀" * 80
    AgentDefinitionV1.model_validate(unicode_agent)
    unicode_agent["display_name"] += "😀"
    with pytest.raises(ValidationError):
        AgentDefinitionV1.model_validate(unicode_agent)

    float_cost = deepcopy(proposal)
    float_cost["cost"]["actual_micros"] = 0.5
    with pytest.raises(ValidationError):
        ArtifactProposalV1.model_validate(float_cost)

    for source_span_ids in ([], [f"spn_{'f' * 32}"]):
        invalid_claim = deepcopy(proposal)
        invalid_claim["claims"][0]["source_span_ids"] = source_span_ids
        with pytest.raises(ValidationError):
            ArtifactProposalV1.model_validate(invalid_claim)


def test_bundle_rejects_cross_project_or_broken_run_references() -> None:
    raw = fixture_data()

    mutations = (
        ("agent_run", "project_id", f"prj_{'b' * 32}"),
        ("skill_run", "agent_run_id", f"agr_{'b' * 32}"),
        ("skill_run", "context_manifest_id", f"ctx_{'b' * 32}"),
        ("artifact_proposal", "producer_agent_run_id", f"agr_{'c' * 32}"),
        ("attempt", "skill_run_id", f"skr_{'d' * 32}"),
        ("attempt", "output_artifact_type", "StoryBible"),
    )
    for section, field, replacement in mutations:
        inconsistent = deepcopy(raw)
        inconsistent[section][field] = replacement
        if section == "attempt":
            attempt = inconsistent["attempt"]
            attempt["attempt_fingerprint"] = canonical_sha256(
                {key: str(attempt[key]) for key in ATTEMPT_FINGERPRINT_FIELDS}
            )
        with pytest.raises(ValidationError, match="inconsistent|must belong|must reference"):
            AgentSkillFixtureBundleV1.model_validate(inconsistent)


def test_attempt_fingerprint_pins_every_execution_decision() -> None:
    raw = fixture_data()["attempt"]
    assert isinstance(raw, dict)
    attempt = AttemptSnapshotV1.model_validate(raw)

    for field, replacement in {
        "project_id": f"prj_{'b' * 32}",
        "agent_run_id": f"agr_{'b' * 32}",
        "skill_run_id": f"skr_{'b' * 32}",
        "output_artifact_type": "StoryBible",
        "agent_definition_id": "writer.execution",
        "agent_version": "1.0.1",
        "skill_definition_id": "story.bible.build",
        "skill_version": "1.0.1",
        "prompt_version": "prompt.source-extract@1.0.1",
        "policy_version": "policy.local-safe@1.0.1",
        "provider_connection_id": "provider:other-fake",
        "model_id": "fake-model-v2",
        "capability_snapshot_hash": f"sha256:{'b' * 64}",
        "input_hash": f"sha256:{'c' * 64}",
        "output_schema_version": "1.0.1",
        "idempotency_key": "idem:other",
    }.items():
        changed = attempt.model_dump(mode="json")
        changed[field] = replacement
        with pytest.raises(ValidationError, match="attempt_fingerprint"):
            AttemptSnapshotV1.model_validate(changed)
