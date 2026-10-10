"""Official AI director authority, deterministic constraints and bounded history."""

import copy
import json
import sqlite3
from uuid import uuid4

import pytest
from aijian_api.artifacts import canonical_content_bytes
from aijian_api.episode_script_confirmation_contracts import CreateEpisodeScriptConfirmationRequest
from aijian_api.episode_script_confirmation_store import EpisodeScriptConfirmationStore
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.official_director_contracts import (
    CompleteOfficialDirectorRequest,
    PrepareOfficialDirectorRequest,
    ReserveOfficialDirectorRequest,
)
from aijian_api.official_director_store import OfficialDirectorError, OfficialDirectorStore
from aijian_api.shot_plan_proposal_store import ShotPlanProposalStore
from pydantic import ValidationError
from test_official_director_workflow import adoption_request, prepared_case
from test_production_brief import original_payload
from test_shot_plan_proposals import request


def adapted_case(tmp_path):
    from aijian_api.agent_skill_builtins import (
        built_in_agent_skill_registry,
        built_in_proposal_schema_registry,
    )
    from aijian_api.artifact_proposal_acceptance import ArtifactProposalAcceptanceService
    from aijian_api.domain import TrustedReviewActor
    from test_proposal_run_create_api import reviewable_proposal

    client, repository, project, source_proposal, _ = reviewable_proposal(tmp_path, key="source")
    acceptance = ArtifactProposalAcceptanceService(
        repository,
        built_in_agent_skill_registry(),
        built_in_proposal_schema_registry(),
    ).accept_as_draft(
        project_id=project,
        proposal_id=source_proposal,
        idempotency_key="accept-source",
        actor=TrustedReviewActor("local-user", ("writer", "producer")),
        parent_version_id=None,
        expected_head_revision=None,
    )
    source = repository.get_artifact_version(
        project, "source_extraction", acceptance.draft_version_id
    )
    brief_content = original_payload()
    brief_content["creative_entry"] = {
        "kind": "source_adaptation",
        "adaptation_statement": "Human adaptation",
        "source_manifest_version_id": source.dependencies[0].upstream_version_id,
        "source_document_id": source.source_spans[0].source_document_id,
        "source_block_ids": [source.source_spans[0].source_block_id],
    }
    brief = repository.create_artifact_version(
        project_id=project,
        artifact_type="production_brief",
        schema_version="1.0.0",
        content=brief_content,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="Adapted production brief",
    )
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
                    "source_extraction_version_id": acceptance.draft_version_id,
                    "source_proposal_acceptance_id": acceptance.acceptance_id,
                    "scenes": [
                        {
                            "scene_id": "scn_" + "a" * 32,
                            "ordinal": 1,
                            "heading": "Human adaptation",
                            "blocks": [
                                {
                                    "block_id": f"sblk_{number:032x}",
                                    "ordinal": number,
                                    "kind": "DIALOGUE" if number == 2 else "ACTION",
                                    "text": "Human scene text",
                                    "speaker": "林舟" if number == 2 else None,
                                    "delivery": "ON_SCREEN" if number == 2 else None,
                                }
                                for number in range(1, 4)
                            ],
                        }
                    ],
                },
                "change_summary": "Adapt",
            }
        ),
        idempotency_key="script",
        actor_id="local-user",
    )
    EpisodeScriptConfirmationStore(repository).confirm(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptConfirmationRequest(
            version_id=script.version_id,
            expected_content_hash=script.content_hash,
            expected_head_revision=script.head_revision,
            confirm=True,
        ),
        idempotency_key="confirm",
        actor_id="local-user",
    )
    return client, repository, project, episode, acceptance, source


def test_adapted_proposal_pins_real_acceptance_and_spans_and_stale_source_blocks_new_work(tmp_path):
    import base64

    from test_proposal_run_create_api import approve_manifest

    client, repository, project, episode, acceptance, source = adapted_case(tmp_path)
    human = request(ShotPlanProposalStore(repository), project, episode).content
    assert human.authority.mode == "ADAPTED"
    store = OfficialDirectorStore(repository)
    payload = PrepareOfficialDirectorRequest.model_validate(
        {
            "operation_id": str(uuid4()),
            "profile_id": str(uuid4()),
            "model": "offline-adapted",
            "authority": human.authority.model_dump(mode="json"),
            "storyboard_base": None,
            "intent": "保持人工确定的改编范围。",
            "options": {"target_shot_count": 7, "pacing": "BALANCED"},
        }
    )
    prepared = store.prepare(project, episode, payload)
    assert prepared.authority.source_proposal_acceptance_id == acceptance.acceptance_id
    assert set(prepared.authority.source_span_ids) == {span.fact_id for span in source.source_spans}
    forged = payload.model_dump(mode="json")
    forged["authority"]["source_span_ids"] = ["spn_" + "f" * 32]
    with pytest.raises(OfficialDirectorError, match="SOURCE_EVIDENCE_MISMATCH"):
        store.prepare(project, episode, PrepareOfficialDirectorRequest.model_validate(forged))
    reserve = ReserveOfficialDirectorRequest.model_validate(
        prepared.model_dump(mode="json", include=set(ReserveOfficialDirectorRequest.model_fields))
    )
    store.reserve(project, episode, reserve)
    content = human.model_dump(mode="json")
    content["provenance"] = "AI"
    completion = CompleteOfficialDirectorRequest(
        operation_id=payload.operation_id,
        profile_id=payload.profile_id,
        model=payload.model,
        request_hash=prepared.request_hash,
        response_id="resp_adapted_offline",
        text=json.dumps(content, ensure_ascii=False),
        completed_at="2026-10-08T23:00:00Z",
    )
    completed, _ = store.complete(project, episode, completion)
    adopted, _ = store.adopt(
        project, episode, reserve.operation_id, adoption_request(completed), "local-user"
    )
    assert adopted.adoption is not None
    with sqlite3.connect(repository.database_path) as connection:
        bindings = json.loads(
            connection.execute(
                "SELECT input_bindings_json FROM workflow_node_runs "
                "WHERE node_type='official.director.plan'"
            ).fetchone()[0]
        )
        assert source.version.id in bindings["input_version_ids"]
    added = client.post(
        f"/api/v1/projects/{project}/sources",
        json={
            "filename": "additional.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode("新来源章节。".encode()).decode("ascii"),
        },
    )
    assert added.status_code == 201
    manifest = client.get(f"/api/v1/projects/{project}/source-manifest")
    approve_manifest(
        client,
        project_id=project,
        version_id=manifest.json()["data"]["latest_version"]["id"],
        etag=manifest.headers["etag"],
    )
    assert store.get(project, episode, reserve.operation_id).adoption is not None
    with pytest.raises(OfficialDirectorError, match="SOURCE_STALE"):
        store.prepare(project, episode, payload)


@pytest.mark.parametrize(
    "mutation", ["bool", "float", "trailing", "duration_bound", "missing_field", "duplicate_nested"]
)
def test_strict_raw_provider_shape_blocks_coercion_or_normalization(tmp_path, mutation):
    _, project, episode, store, _, _, reserve, content, completion = prepared_case(tmp_path)
    changed = copy.deepcopy(content)
    if mutation == "bool":
        changed["shots"][0]["duration_frames"] = True
    if mutation == "float":
        changed["shots"][0]["duration_frames"] = 24.0
    if mutation == "duration_bound":
        changed["shots"][0]["duration_frames"] = 864001
    if mutation == "missing_field":
        del changed["issues"]
    raw = json.dumps(changed, ensure_ascii=False)
    if mutation == "trailing":
        raw += " {}"
    if mutation == "duplicate_nested":
        duration = changed["shots"][0]["duration_frames"]
        needle = f'"duration_frames": {duration}'
        raw = raw.replace(needle, f"{needle}, {needle}", 1)
    store.reserve(project, episode, reserve)
    invalid, _ = store.complete(
        project,
        episode,
        CompleteOfficialDirectorRequest(**{**completion.model_dump(mode="json"), "text": raw}),
    )
    assert invalid.status == "INVALID" and invalid.completion.text == raw


def test_delivery_frame_rate_loss_blocks_ai_adoption_without_retiming(tmp_path):
    _, project, episode, store, _, _, reserve, content, completion = prepared_case(tmp_path)
    content["timebase"]["frame_rate"] = {"num": 25, "den": 1}
    store.reserve(project, episode, reserve)
    completed, _ = store.complete(
        project,
        episode,
        CompleteOfficialDirectorRequest(
            **{
                **completion.model_dump(mode="json"),
                "text": json.dumps(content, ensure_ascii=False),
            }
        ),
    )
    assert completed.status == "COMPLETED"
    assert any(
        loss.code == "OFFICIAL_DIRECTOR_DELIVERY_RATE_MISMATCH" and loss.severity == "BLOCKING"
        for loss in completed.proposal.capability_losses
    )
    with pytest.raises(OfficialDirectorError, match="BLOCKING_ISSUES"):
        store.adopt(
            project, episode, reserve.operation_id, adoption_request(completed), "local-user"
        )
    assert completed.proposal.content.timebase.frame_rate.num == 25


def test_oversized_complete_output_retained_invalid_and_wire_safe_escaped_cap(tmp_path):
    _, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    raw = "x" * 4_000_001
    invalid, _ = store.complete(
        project,
        episode,
        CompleteOfficialDirectorRequest(**{**completion.model_dump(mode="json"), "text": raw}),
    )
    assert (
        invalid.status == "INVALID" and invalid.error_code == "OFFICIAL_DIRECTOR_OUTPUT_TOO_LARGE"
    )
    assert invalid.completion.text == raw and invalid.attempt_status == "FAILED"
    safe_nuls = "\x00" * ((4_194_304 - 2) // 6)
    boundary = CompleteOfficialDirectorRequest(
        **{**completion.model_dump(mode="json"), "text": safe_nuls}
    )
    assert len(json.dumps(boundary.text).encode()) <= 4_194_304
    with pytest.raises(ValidationError):
        CompleteOfficialDirectorRequest(
            **{**completion.model_dump(mode="json"), "text": safe_nuls + "\x00"}
        )


def test_recent_history_is_byte_bounded_signals_has_more_and_exact_older_read_survives(tmp_path):
    _, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    all_operations = []
    for number in range(5):
        reserve = ReserveOfficialDirectorRequest(
            **{**reserve.model_dump(mode="json"), "operation_id": str(uuid4())}
        )
        store.reserve(project, episode, reserve)
        result, _ = store.complete(
            project,
            episode,
            CompleteOfficialDirectorRequest(
                **{
                    **completion.model_dump(mode="json"),
                    "operation_id": reserve.operation_id,
                    "response_id": f"resp_offline_{number}",
                    "text": "x" * 3_000_000,
                }
            ),
        )
        all_operations.append(result)
    recent, has_more = store.list_page(project, episode)
    assert has_more and len(recent) < 5
    assert (
        len(canonical_content_bytes([item.model_dump(mode="json") for item in recent]))
        <= 12 * 1024 * 1024
    )
    assert (
        store.get(project, episode, all_operations[0].request.operation_id).completion.text
        == "x" * 3_000_000
    )


@pytest.mark.parametrize("change_after_reserve", [False, True])
def test_existing_storyboard_is_preserved_with_cas_and_new_adopted_version(
    tmp_path, change_after_reserve
):
    from test_episode_storyboard import payload as storyboard_payload

    repository, project, episode, store, payload, _, _, _, _ = prepared_case(tmp_path)
    storyboard_store = EpisodeStoryboardStore(repository)
    previous, _ = storyboard_store.write(
        project_id=project,
        episode_id=episode,
        payload=storyboard_payload(project, episode),
        idempotency_key="previous-manual",
        actor_id="local-user",
    )
    human = request(ShotPlanProposalStore(repository), project, episode, count=9).content
    payload = PrepareOfficialDirectorRequest.model_validate(
        {
            **payload.model_dump(mode="json"),
            "storyboard_base": human.storyboard_base.model_dump(mode="json"),
            "options": {"target_shot_count": 9, "pacing": "BALANCED"},
        }
    )
    prepared = store.prepare(project, episode, payload)
    reserve = ReserveOfficialDirectorRequest.model_validate(
        prepared.model_dump(mode="json", include=set(ReserveOfficialDirectorRequest.model_fields))
    )
    store.reserve(project, episode, reserve)
    content = human.model_dump(mode="json")
    content["provenance"] = "AI"
    completed, _ = store.complete(
        project,
        episode,
        CompleteOfficialDirectorRequest(
            operation_id=reserve.operation_id,
            profile_id=reserve.profile_id,
            model=reserve.model,
            request_hash=prepared.request_hash,
            response_id="resp_storyboard_cas",
            text=json.dumps(content, ensure_ascii=False),
            completed_at="2026-10-08T23:00:00Z",
        ),
    )
    if change_after_reserve:
        edited = previous.content.model_dump(mode="json")
        edited["fps"] = 25
        from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest

        manual_new, _ = storyboard_store.write(
            project_id=project,
            episode_id=episode,
            payload=CreateEpisodeStoryboardVersionRequest.model_validate(
                {
                    "content": edited,
                    "parent_version_id": previous.version_id,
                    "expected_revision": previous.head_revision,
                    "change_summary": "manual edit",
                }
            ),
            idempotency_key="manual-edit",
            actor_id="local-user",
        )
        with pytest.raises(OfficialDirectorError, match="STORYBOARD_STALE"):
            store.adopt(
                project, episode, reserve.operation_id, adoption_request(completed), "local-user"
            )
        assert (
            storyboard_store.get_latest(project_id=project, episode_id=episode).version_id
            == manual_new.version_id
        )
    else:
        adopted, _ = store.adopt(
            project, episode, reserve.operation_id, adoption_request(completed), "local-user"
        )
        assert adopted.adoption.storyboard_version_id != previous.version_id
        latest = storyboard_store.get_latest(project_id=project, episode_id=episode)
        assert latest.parent_version_id == previous.version_id
        assert latest.content.script_version_id == prepared.authority.script.version_id
    preserved = storyboard_store.get_version(
        project_id=project, episode_id=episode, version_id=previous.version_id
    )
    assert preserved.content == previous.content


@pytest.mark.parametrize("seconds,warns", [(21, False), (22, True), (None, False)])
def test_duration_intent_exact_rational_constraint_only_warns_for_explicit_episode_target(
    tmp_path, seconds, warns
):
    from aijian_api.episode_script_contracts import EpisodeScriptContentV1
    from aijian_api.official_director_constraints import review_director_losses
    from aijian_api.official_director_contracts import OfficialDirectorContentV1
    from aijian_api.production_brief import ProductionBriefContentV1

    _, _, _, _, _, prepared, _, content, _ = prepared_case(tmp_path)
    brief = copy.deepcopy(prepared.production_brief_stored_content)
    brief["duration_intent"] = {
        "work_seconds": 9999,
        "episode_mode": "per_episode" if seconds else "unspecified",
        "episode_seconds": seconds,
    }
    losses = review_director_losses(
        OfficialDirectorContentV1.model_validate(content),
        EpisodeScriptContentV1.model_validate(prepared.script_stored_content),
        ProductionBriefContentV1.model_validate(brief),
    )
    warnings = [
        loss for loss in losses if loss.code == "OFFICIAL_DIRECTOR_DURATION_INTENT_MISMATCH"
    ]
    assert bool(warnings) == warns
    assert all(loss.severity == "WARNING" for loss in warnings)


def test_prompt_ceiling_rejects_exact_large_script_before_reservation_or_send(tmp_path):
    repository, project, episode, store, payload, _, _, _, _ = prepared_case(tmp_path)
    current = EpisodeScriptStore(repository).get_latest(project_id=project, episode_id=episode)
    changed = current.content.model_dump(mode="json")
    changed["scenes"][0]["blocks"] = [
        {
            "block_id": f"sblk_{number:032x}",
            "ordinal": number,
            "kind": "ACTION",
            "text": "精确剧本内容" * 200,
            "speaker": None,
            "delivery": None,
        }
        for number in range(1, 100)
    ]
    revised, _ = EpisodeScriptStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(
            {
                "content": changed,
                "parent_version_id": current.version_id,
                "expected_revision": current.head_revision,
                "change_summary": "large script",
            }
        ),
        idempotency_key="large-script",
        actor_id="local-user",
    )
    EpisodeScriptConfirmationStore(repository).confirm(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptConfirmationRequest(
            version_id=revised.version_id,
            expected_content_hash=revised.content_hash,
            expected_head_revision=revised.head_revision,
            confirm=True,
        ),
        idempotency_key="large-confirm",
        actor_id="local-user",
    )
    authority = ShotPlanProposalStore(repository).prepare(project, episode).authority
    with pytest.raises(OfficialDirectorError, match="PROMPT_TOO_LARGE"):
        store.prepare(
            project,
            episode,
            PrepareOfficialDirectorRequest.model_validate(
                {**payload.model_dump(mode="json"), "authority": authority.model_dump(mode="json")}
            ),
        )
    assert store.list(project, episode) == []


def test_unknown_is_always_visible_even_when_clock_moves_back_and_history_exceeds_count_cap(
    tmp_path,
):
    from datetime import UTC, datetime

    repository, project, episode, store, _, _, reserve, _, _ = prepared_case(tmp_path)
    for _ in range(21):
        reserve = ReserveOfficialDirectorRequest(
            **{**reserve.model_dump(mode="json"), "operation_id": str(uuid4())}
        )
        store.reserve(project, episode, reserve)
        store.not_sent(project, episode, reserve.operation_id, "USER_CANCELLED")
    reserve = ReserveOfficialDirectorRequest(
        **{**reserve.model_dump(mode="json"), "operation_id": str(uuid4())}
    )
    backwards = OfficialDirectorStore(repository, clock=lambda: datetime(2020, 1, 1, tzinfo=UTC))
    unknown, _ = backwards.reserve(project, episode, reserve)
    recent, has_more = store.list_page(project, episode)
    assert has_more and len(recent) == 20
    assert recent[0].request.operation_id == unknown.request.operation_id
    assert recent[0].status == "REMOTE_UNKNOWN"


@pytest.mark.parametrize(
    "numerator,denominator", [(30, 1), (48, 1), (60, 1), (24000, 1001), (30000, 1001)]
)
def test_unsupported_delivery_rate_fails_before_approval_reserve_or_provider_send(
    tmp_path, numerator, denominator
):
    repository, project, episode, store, payload, _, _, _, _ = prepared_case(tmp_path)
    old_brief = repository.get_latest_artifact(project, "production_brief")
    changed = copy.deepcopy(old_brief.version.content)
    changed["delivery"]["frame_rate"] = {"num": numerator, "den": denominator}
    revised_brief = repository.create_artifact_version(
        project_id=project,
        artifact_type="production_brief",
        schema_version="1.0.0",
        content=changed,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="unsupported rate intent",
        parent_version_id=old_brief.version.id,
        expected_revision=old_brief.head.revision,
    )
    script_store = EpisodeScriptStore(repository)
    old_script = script_store.get_latest(project_id=project, episode_id=episode)
    script = old_script.content.model_dump(mode="json")
    script["production_brief_version_id"] = revised_brief.version.id
    revised, _ = script_store.write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(
            {
                "content": script,
                "parent_version_id": old_script.version_id,
                "expected_revision": old_script.head_revision,
                "change_summary": "pin revised rate",
            }
        ),
        idempotency_key="rate-script",
        actor_id="local-user",
    )
    EpisodeScriptConfirmationStore(repository).confirm(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptConfirmationRequest(
            version_id=revised.version_id,
            expected_content_hash=revised.content_hash,
            expected_head_revision=revised.head_revision,
            confirm=True,
        ),
        idempotency_key="rate-confirm",
        actor_id="local-user",
    )
    manual_preparation = ShotPlanProposalStore(repository).prepare(project, episode)
    assert manual_preparation.production_brief_content.delivery.frame_rate.num == numerator
    prepare = PrepareOfficialDirectorRequest.model_validate(
        {
            **payload.model_dump(mode="json"),
            "authority": manual_preparation.authority.model_dump(mode="json"),
        }
    )
    with pytest.raises(OfficialDirectorError, match="DELIVERY_RATE_UNSUPPORTED"):
        store.prepare(project, episode, prepare)
    with pytest.raises(OfficialDirectorError, match="DELIVERY_RATE_UNSUPPORTED"):
        store.reserve(
            project,
            episode,
            ReserveOfficialDirectorRequest(
                **{**prepare.model_dump(mode="json"), "request_hash": "sha256:" + "0" * 64}
            ),
        )
    assert store.list(project, episode) == []
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT count(*) FROM task_ledger").fetchone()[0] == 0


def test_fractional_model_plan_retains_exact_rate_and_blocks_projection_without_rounding(tmp_path):
    _, project, episode, store, _, _, reserve, content, completion = prepared_case(tmp_path)
    content["timebase"]["frame_rate"] = {"num": 24000, "den": 1001}
    store.reserve(project, episode, reserve)
    completed, _ = store.complete(
        project,
        episode,
        CompleteOfficialDirectorRequest(
            **{
                **completion.model_dump(mode="json"),
                "text": json.dumps(content, ensure_ascii=False),
            }
        ),
    )
    assert completed.status == "COMPLETED"
    losses = completed.proposal.capability_losses
    assert any(
        loss.code == "FRACTIONAL_STORYBOARD_TIMEBASE" and loss.severity == "BLOCKING"
        for loss in losses
    )
    assert any(loss.code == "OFFICIAL_DIRECTOR_DELIVERY_RATE_MISMATCH" for loss in losses)
    assert completed.proposal.content.timebase.frame_rate.den == 1001
    with pytest.raises(OfficialDirectorError, match="BLOCKING_ISSUES"):
        store.adopt(
            project, episode, reserve.operation_id, adoption_request(completed), "local-user"
        )
