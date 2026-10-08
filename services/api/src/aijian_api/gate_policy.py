"""Server-owned Gate policies and deterministic readiness evaluation."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from aijian_api.artifacts import canonical_content_hash

type ReadinessEvaluator = Callable[[dict[str, object]], dict[str, object]]


@dataclass(frozen=True, slots=True)
class GatePolicy:
    artifact_type: str
    gate: str
    policy_code: str
    policy_version: str
    readiness_contract_hash: str
    required_roles: tuple[str, ...]
    decision_roles: tuple[str, ...]
    submit_roles: tuple[str, ...]
    allow_self_review: bool
    allow_multi_role_signoff: bool
    evaluator: ReadinessEvaluator

    @property
    def snapshot_hash(self) -> str:
        return canonical_content_hash(
            {
                "artifact_type": self.artifact_type,
                "gate": self.gate,
                "policy_code": self.policy_code,
                "policy_version": self.policy_version,
                "readiness_contract_hash": self.readiness_contract_hash,
                "required_roles": list(self.required_roles),
                "decision_roles": list(self.decision_roles),
                "submit_roles": list(self.submit_roles),
                "allow_self_review": self.allow_self_review,
                "allow_multi_role_signoff": self.allow_multi_role_signoff,
            }
        )

    def evaluate(self, content: dict[str, object]) -> dict[str, object]:
        report = self.evaluator(content)
        return {
            **report,
            "policy_code": self.policy_code,
            "policy_version": self.policy_version,
            "policy_snapshot_hash": self.snapshot_hash,
        }


def _story_bible_readiness(content: dict[str, object]) -> dict[str, object]:
    blocking: list[str] = []
    if not isinstance(content.get("title"), str) or not str(content["title"]).strip():
        blocking.append("missing_title")
    if not isinstance(content.get("logline"), str) or not str(content["logline"]).strip():
        blocking.append("missing_logline")
    entities = content.get("entities")
    if not isinstance(entities, list) or not any(
        isinstance(entity, dict) and entity.get("kind") == "character" for entity in entities
    ):
        blocking.append("missing_core_character")
    facts = content.get("facts")
    if not isinstance(facts, list) or not any(
        isinstance(fact, dict)
        and fact.get("importance") == "core"
        and fact.get("canon_status") == "confirmed"
        for fact in facts
    ):
        blocking.append("missing_confirmed_core_fact")
    return {"ready": not blocking, "blocking": blocking}


def _source_manifest_readiness(content: dict[str, object]) -> dict[str, object]:
    documents = content.get("documents")
    blocking = [] if isinstance(documents, list) and documents else ["missing_source_document"]
    return {"ready": not blocking, "blocking": blocking}


DEFAULT_GATE_POLICIES: Mapping[str, GatePolicy] = {
    "source_manifest": GatePolicy(
        artifact_type="source_manifest",
        gate="G1",
        policy_code="g1.source-manifest",
        policy_version="1",
        readiness_contract_hash=canonical_content_hash(
            {"contract": "source-manifest-readiness-v1"}
        ),
        required_roles=("writer", "producer"),
        decision_roles=("producer",),
        submit_roles=("writer", "producer"),
        allow_self_review=True,
        allow_multi_role_signoff=True,
        evaluator=_source_manifest_readiness,
    ),
    "story_bible": GatePolicy(
        artifact_type="story_bible",
        gate="G2",
        policy_code="g2.story-bible",
        policy_version="1",
        readiness_contract_hash=canonical_content_hash({"contract": "story-bible-readiness-v1"}),
        required_roles=("writer", "continuity_reviewer", "producer"),
        decision_roles=("producer",),
        submit_roles=("writer", "producer"),
        allow_self_review=True,
        allow_multi_role_signoff=True,
        evaluator=_story_bible_readiness,
    ),
}
