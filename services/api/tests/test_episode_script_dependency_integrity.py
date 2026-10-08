"""Dependency UUID ordering has no semantics; exact script lineage remains closed."""

import sqlite3
from dataclasses import replace
from uuid import uuid4

import pytest
from aijian_api.agent_skill_builtins import (
    built_in_agent_skill_registry,
    built_in_proposal_schema_registry,
)
from aijian_api.artifact_proposal_acceptance import ArtifactProposalAcceptanceService
from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_script_confirmation_contracts import CreateEpisodeScriptConfirmationRequest
from aijian_api.episode_script_confirmation_store import EpisodeScriptConfirmationStore
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStorageError, EpisodeScriptStore
from aijian_api.repository import StudioRepository
from test_production_brief import original_payload
from test_proposal_run_create_api import reviewable_proposal


def script_with_dependency_order(tmp_path, reverse):
    _, repository, project, proposal, _ = reviewable_proposal(tmp_path, key="source")
    accepted = ArtifactProposalAcceptanceService(
        repository,
        built_in_agent_skill_registry(),
        built_in_proposal_schema_registry(),
    ).accept_as_draft(
        project_id=project,
        proposal_id=proposal,
        idempotency_key="accept-source",
        actor=TrustedReviewActor("local-user", ("writer", "producer")),
        parent_version_id=None,
        expected_head_revision=None,
    )
    brief = repository.create_artifact_version(
        project_id=project,
        artifact_type="production_brief",
        schema_version="1.0.0",
        content=original_payload(),
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="Exact brief",
    )
    dependency_ids = iter(
        ("dep_" + "f" * 32, "dep_" + "0" * 32)
        if reverse
        else ("dep_" + "0" * 32, "dep_" + "f" * 32)
    )

    def ids(prefix):
        return next(dependency_ids) if prefix == "dep" else f"{prefix}_{uuid4().hex}"

    # Generate actual persisted dependency UUIDs in both possible orderings.
    repository = StudioRepository(repository.database_path, id_factory=ids)
    episode = repository.list_episodes(project)[0].id
    script, _ = EpisodeScriptStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(
            {
                "content": {
                    "project_id": project,
                    "episode_id": episode,
                    "production_brief_version_id": brief.version.id,
                    "source_extraction_version_id": accepted.draft_version_id,
                    "source_proposal_acceptance_id": accepted.acceptance_id,
                    "scenes": [
                        {
                            "scene_id": "scn_" + "a" * 32,
                            "ordinal": 1,
                            "heading": "场景",
                            "blocks": [
                                {
                                    "block_id": "sblk_" + "b" * 32,
                                    "ordinal": 1,
                                    "kind": "ACTION",
                                    "text": "角色回望。",
                                }
                            ],
                        }
                    ],
                },
                "change_summary": "Exact two-upstream script",
            }
        ),
        idempotency_key="script",
        actor_id="local-user",
    )
    return repository, project, episode, script, brief.version.id, accepted.draft_version_id


@pytest.mark.parametrize("reverse", [False, True])
def test_both_generated_uuid_orders_read_and_explicitly_confirm_after_restart(tmp_path, reverse):
    repository, project, episode, script, brief, source = script_with_dependency_order(
        tmp_path, reverse
    )
    reopened = StudioRepository(repository.database_path)
    record = reopened.get_artifact_version(
        project, "episode_script", script.version_id, episode_id=episode
    )
    expected_order = [source, brief] if reverse else [brief, source]
    assert [edge.upstream_version_id for edge in record.dependencies] == expected_order
    read = EpisodeScriptStore(reopened).get_latest(project_id=project, episode_id=episode)
    assert read.content_hash == script.content_hash and read.content == script.content
    confirmed, replayed = EpisodeScriptConfirmationStore(reopened).confirm(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptConfirmationRequest(
            version_id=read.version_id,
            expected_content_hash=read.content_hash,
            expected_head_revision=read.head_revision,
            confirm=True,
        ),
        idempotency_key="confirm",
        actor_id="local-user",
    )
    assert not replayed and confirmed.current
    assert confirmed.confirmation.version_id == script.version_id


@pytest.mark.parametrize("corruption", ["missing", "extra", "duplicate", "relationship", "impact"])
def test_unordered_comparison_keeps_missing_extra_duplicate_and_role_edges_rejected(
    tmp_path, corruption
):
    repository, project, episode, script, _, _ = script_with_dependency_order(tmp_path, True)
    record = repository.get_artifact_version(
        project, "episode_script", script.version_id, episode_id=episode
    )
    edge = record.dependencies[0]
    if corruption == "missing":
        edges = record.dependencies[1:]
    elif corruption == "extra":
        edges = (
            *record.dependencies,
            replace(edge, id="dep_" + "1" * 32, upstream_version_id="ver_" + "1" * 32),
        )
    elif corruption == "duplicate":
        edges = (*record.dependencies, replace(edge, id="dep_" + "1" * 32))
    elif corruption == "relationship":
        edges = (replace(edge, relationship="references"), *record.dependencies[1:])
    else:
        edges = (replace(edge, impact="advisory"), *record.dependencies[1:])
    with pytest.raises(EpisodeScriptStorageError, match="readback"):
        EpisodeScriptStore._version_data(
            replace(record, dependencies=edges), project_id=project, episode_id=episode
        )
    # This failure is validation-only; no approval receipt or artifact changes.
    with sqlite3.connect(repository.database_path) as connection:
        assert (
            connection.execute("SELECT count(*) FROM episode_script_confirmations").fetchone()[0]
            == 0
        )
    assert (
        EpisodeScriptStore(repository)
        .get_latest(project_id=project, episode_id=episode)
        .content_hash
        == script.content_hash
    )
