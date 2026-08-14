"""Server-owned Gate policies and deterministic readiness evaluation."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from pydantic import ValidationError

from aijian_api.artifacts import canonical_content_hash
from aijian_api.story_bible import StoryBibleContentV1, StoryFactV1

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


def _parse_story_bible(content: dict[str, object]) -> StoryBibleContentV1 | None:
    try:
        return StoryBibleContentV1.model_validate(content)
    except ValidationError:
        return None


def _story_bible_readiness(content: dict[str, object]) -> dict[str, object]:
    story = _parse_story_bible(content)
    if story is None:
        return {"ready": False, "blocking": ["invalid_story_bible_schema"]}
    return _typed_story_bible_readiness(story)


def _typed_story_bible_readiness(story: StoryBibleContentV1) -> dict[str, object]:
    blocking: list[str] = []
    if not story.title.strip():
        blocking.append("missing_title")
    if not story.logline.strip():
        blocking.append("missing_logline")
    if not any(entity.kind == "character" for entity in story.entities):
        blocking.append("missing_core_character")
    core_facts = [fact for fact in story.facts if fact.importance == "core"]
    if not any(fact.canon_status == "confirmed" for fact in core_facts):
        blocking.append("missing_confirmed_core_fact")
    if any(fact.canon_status not in {"confirmed", "rejected"} for fact in core_facts):
        blocking.append("undisposed_core_fact")
    if any(question.blocking and question.status == "open" for question in story.questions):
        blocking.append("unresolved_blocking_question")
    facts_by_id = {fact.fact_id: fact for fact in story.facts}
    if any(
        conflict.status == "unresolved"
        and _conflict_involves_core_fact(conflict.fact_ids, facts_by_id)
        for conflict in story.conflicts
    ):
        blocking.append("unresolved_core_conflict")
    if any(_unreviewed_core_or_supporting_inference(fact) for fact in story.facts):
        blocking.append("unreviewed_ai_inference")
    return {"ready": not blocking, "blocking": blocking}


def _conflict_involves_core_fact(
    fact_ids: list[str],
    facts_by_id: Mapping[str, StoryFactV1],
) -> bool:
    return any(
        fact_id in facts_by_id and facts_by_id[fact_id].importance == "core" for fact_id in fact_ids
    )


def _unreviewed_core_or_supporting_inference(fact: StoryFactV1) -> bool:
    return (
        fact.origin == "ai_inference"
        and fact.importance in {"core", "supporting"}
        and fact.canon_status not in {"confirmed", "rejected"}
    )


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
        policy_version="2",
        readiness_contract_hash=canonical_content_hash({"contract": "story-bible-readiness-v2"}),
        required_roles=("writer", "continuity_reviewer", "producer"),
        decision_roles=("producer",),
        submit_roles=("writer", "producer"),
        allow_self_review=True,
        allow_multi_role_signoff=True,
        evaluator=_story_bible_readiness,
    ),
}
