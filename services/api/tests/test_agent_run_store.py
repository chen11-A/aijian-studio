import sqlite3
from pathlib import Path

import pytest
from aijian_api.agent_context_builder import (
    BuiltContext,
    ContextFragment,
    _mint_resolved_context_inputs,
    build_context,
)
from aijian_api.agent_run_store import AgentRunBundleConflictError, AgentRunStore
from aijian_api.agent_skill_contracts import (
    AgentSkillFixtureBundleV1,
)
from aijian_api.agent_skill_registry import (
    AgentRegistration,
    AgentSkillRegistry,
    ResolvedDelegation,
    SkillRegistration,
)
from aijian_api.repository import StudioRepository

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"


def run_bundle(project_id: str):
    fixture = AgentSkillFixtureBundleV1.model_validate_json(
        FIXTURE_PATH.read_text(encoding="utf-8")
    )
    registry = AgentSkillRegistry(
        agents=(AgentRegistration(fixture.agent_definition),),
        skills=(SkillRegistration(fixture.skill_definition),),
    )
    delegation = registry.resolve_delegation(
        fixture.agent_run.agent_definition,
        fixture.skill_run.skill_definition,
    )
    trusted_inputs = _mint_resolved_context_inputs(
        project_id=project_id,
        delegation=delegation,
        role_invariants=ContextFragment(
            ref="agent:writer.source-analyst",
            version="1.0.0",
            content="Only extract evidence-backed source facts.",
        ),
        skill_instructions=ContextFragment(
            ref="skill:source.extract",
            version="1.0.0",
            content="Return a closed SourceExtractionProposal.",
        ),
        approved_artifacts=(
            ContextFragment(
                ref=f"artifact:SourceManifest/ver_{'1' * 32}",
                version="1.0.0",
                content="Approved source manifest metadata.",
            ),
        ),
        source_spans=(
            ContextFragment(
                ref=f"source:spn_{'2' * 32}",
                version="source-v1",
                content="Untrusted source excerpt.",
            ),
        ),
        task_output_schema=ContextFragment(
            ref="schema:SourceExtractionProposal",
            version="1.0.0",
            content='{"type":"object","additionalProperties":false}',
        ),
    )
    built_context = build_context(delegation=delegation, trusted_inputs=trusted_inputs)
    agent_run = fixture.agent_run.model_copy(update={"project_id": project_id, "status": "PENDING"})
    skill_run = fixture.skill_run.model_copy(
        update={
            "project_id": project_id,
            "context_manifest_id": built_context.manifest.context_manifest_id,
            "status": "PENDING",
            "proposal_id": None,
        }
    )
    return agent_run, skill_run, built_context, delegation


def create_project(database: Path, name: str = "Agent run truth") -> str:
    return (
        StudioRepository(database)
        .create_project(
            name=name,
            aspect_ratio="9:16",
            target_duration_seconds=15,
            source_language="zh-CN",
        )
        .id
    )


def test_run_bundle_is_atomic_project_scoped_and_exactly_replayable(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    agent_run, skill_run, built_context, delegation = run_bundle(project_id)
    store = AgentRunStore(database)

    first = store.persist_pending_bundle(
        agent_run=agent_run,
        skill_run=skill_run,
        built_context=built_context,
        delegation=delegation,
    )
    replayed = AgentRunStore(database).persist_pending_bundle(
        agent_run=agent_run,
        skill_run=skill_run,
        built_context=built_context,
        delegation=delegation,
    )

    assert replayed == first
    assert AgentRunStore(database).get(project_id, agent_run.agent_run_id) == first
    with pytest.raises(LookupError):
        store.get(f"prj_{'f' * 32}", agent_run.agent_run_id)


def test_run_bundle_rejects_drift_cross_project_and_non_pending_state(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    other_project_id = create_project(database, "Other project")
    agent_run, skill_run, built_context, delegation = run_bundle(project_id)
    store = AgentRunStore(database)
    store.persist_pending_bundle(
        agent_run=agent_run,
        skill_run=skill_run,
        built_context=built_context,
        delegation=delegation,
    )

    with pytest.raises(AgentRunBundleConflictError, match="must be pending"):
        store.persist_pending_bundle(
            agent_run=agent_run.model_copy(update={"status": "RUNNING"}),
            skill_run=skill_run,
            built_context=built_context,
            delegation=delegation,
        )
    with pytest.raises(AgentRunBundleConflictError, match="project"):
        store.persist_pending_bundle(
            agent_run=agent_run,
            skill_run=skill_run.model_copy(update={"project_id": other_project_id}),
            built_context=built_context,
            delegation=delegation,
        )


def test_exact_replay_returns_progressed_state_but_identity_columns_are_immutable(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    agent_run, skill_run, built_context, delegation = run_bundle(project_id)
    store = AgentRunStore(database)
    store.persist_pending_bundle(
        agent_run=agent_run,
        skill_run=skill_run,
        built_context=built_context,
        delegation=delegation,
    )

    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE agent_runs SET status = 'RUNNING', revision = 2 WHERE agent_run_id = ?",
            (agent_run.agent_run_id,),
        )
        with pytest.raises(sqlite3.IntegrityError, match="identity is immutable"):
            connection.execute(
                "UPDATE agent_runs SET agent_definition_version = '2.0.0' WHERE agent_run_id = ?",
                (agent_run.agent_run_id,),
            )
        connection.rollback()
        connection.execute(
            "UPDATE agent_runs SET status = 'RUNNING', revision = 2 WHERE agent_run_id = ?",
            (agent_run.agent_run_id,),
        )
        connection.commit()

    replayed = store.persist_pending_bundle(
        agent_run=agent_run,
        skill_run=skill_run,
        built_context=built_context,
        delegation=delegation,
    )
    assert replayed.agent_run.status == "RUNNING"
    assert replayed.agent_revision == 2


def test_run_bundle_rolls_back_every_row_when_transaction_fails(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    agent_run, skill_run, built_context, delegation = run_bundle(project_id)

    def fail_after_context(step: str) -> None:
        if step == "context_persisted":
            raise RuntimeError("injected run bundle failure")

    with pytest.raises(RuntimeError, match="injected run bundle failure"):
        AgentRunStore(database, transaction_hook=fail_after_context).persist_pending_bundle(
            agent_run=agent_run,
            skill_run=skill_run,
            built_context=built_context,
            delegation=delegation,
        )

    with sqlite3.connect(database) as connection:
        for table in ("agent_runs", "skill_runs", "agent_context_manifests"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (0,)


def test_context_builder_token_cannot_be_forged(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    agent_run, skill_run, built_context, delegation = run_bundle(project_id)

    with pytest.raises(TypeError, match="must be created by build_context"):
        BuiltContext(
            layers=built_context.layers,
            manifest=built_context.manifest,
            _seal=object(),
        )
    copied_token_context = BuiltContext(
        layers=built_context.layers,
        manifest=built_context.manifest,
        _seal=built_context._build_seal,
    )
    with pytest.raises(TypeError, match="invalid Context Builder token"):
        AgentRunStore(database).persist_pending_bundle(
            agent_run=agent_run,
            skill_run=skill_run,
            built_context=copied_token_context,
            delegation=delegation,
        )
    copied_token_delegation = ResolvedDelegation(
        delegation.agent_definition,
        delegation.skill_definition,
        _seal=delegation._resolution_seal,
    )
    with pytest.raises(TypeError, match="invalid Registry delegation token"):
        AgentRunStore(database).persist_pending_bundle(
            agent_run=agent_run,
            skill_run=skill_run,
            built_context=built_context,
            delegation=copied_token_delegation,
        )


def test_database_rejects_cross_project_chain_and_reader_fails_closed_on_drift(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    other_project_id = create_project(database, "Other project")
    agent_run, skill_run, built_context, delegation = run_bundle(project_id)
    store = AgentRunStore(database)
    store.persist_pending_bundle(
        agent_run=agent_run,
        skill_run=skill_run,
        built_context=built_context,
        delegation=delegation,
    )

    extra_agent_id = f"agr_{'c' * 32}"
    extra_skill_id = f"skr_{'d' * 32}"
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            connection.execute(
                """
                INSERT INTO agent_context_manifests (
                    context_manifest_id, project_id,
                    agent_definition_id, agent_definition_version,
                    skill_definition_id, skill_definition_version,
                    manifest_json, manifest_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)
                """,
                (
                    f"ctx_{'e' * 32}",
                    project_id,
                    agent_run.agent_definition.definition_id,
                    agent_run.agent_definition.version,
                    skill_run.skill_definition.definition_id,
                    skill_run.skill_definition.version,
                    f"sha256:{'e' * 64}",
                    "2026-08-10T10:00:00.000000Z",
                ),
            )
        connection.rollback()
        connection.execute(
            """
            INSERT INTO agent_runs (
                agent_run_id, project_id, agent_definition_id,
                agent_definition_version, status, delegated_skill_run_ids_json,
                revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'PENDING', ?, 1, ?, ?)
            """,
            (
                extra_agent_id,
                project_id,
                agent_run.agent_definition.definition_id,
                agent_run.agent_definition.version,
                f'["{extra_skill_id}"]',
                "2026-08-10T10:00:00.000000Z",
                "2026-08-10T10:00:00.000000Z",
            ),
        )
        with pytest.raises(sqlite3.IntegrityError, match="chain is inconsistent"):
            connection.execute(
                """
                INSERT INTO skill_runs (
                    skill_run_id, project_id, agent_run_id,
                    skill_definition_id, skill_definition_version,
                    context_manifest_id, status, proposal_id, revision,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, 1, ?, ?)
                """,
                (
                    extra_skill_id,
                    other_project_id,
                    extra_agent_id,
                    skill_run.skill_definition.definition_id,
                    skill_run.skill_definition.version,
                    built_context.manifest.context_manifest_id,
                    "2026-08-10T10:00:00.000000Z",
                    "2026-08-10T10:00:00.000000Z",
                ),
            )
        connection.rollback()
        connection.execute("PRAGMA ignore_check_constraints = ON")
        connection.execute("DROP TRIGGER agent_context_manifests_immutable_update")
        connection.execute(
            "UPDATE agent_context_manifests SET agent_definition_id = 'writer.other' "
            "WHERE context_manifest_id = ?",
            (built_context.manifest.context_manifest_id,),
        )
        connection.commit()

    with pytest.raises(AgentRunBundleConflictError, match="failed validation"):
        store.get(project_id, agent_run.agent_run_id)


def test_context_manifest_rows_are_immutable_while_project_cascade_is_allowed(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    agent_run, skill_run, built_context, delegation = run_bundle(project_id)
    AgentRunStore(database).persist_pending_bundle(
        agent_run=agent_run,
        skill_run=skill_run,
        built_context=built_context,
        delegation=delegation,
    )

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE agent_context_manifests SET manifest_hash = ? "
                "WHERE context_manifest_id = ?",
                (
                    f"sha256:{'f' * 64}",
                    built_context.manifest.context_manifest_id,
                ),
            )
        connection.rollback()
        connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        assert connection.execute("SELECT COUNT(*) FROM agent_context_manifests").fetchone() == (0,)
