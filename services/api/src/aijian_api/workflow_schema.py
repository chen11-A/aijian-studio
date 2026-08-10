"""SQLite schema owned by the deterministic workflow subsystem."""

MIGRATION_4 = (
    """
    CREATE TABLE workflow_definitions (
        definition_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        definition_hash TEXT NOT NULL
            CHECK (length(definition_hash) = 71 AND definition_hash LIKE 'sha256:%'),
        graph_json TEXT NOT NULL CHECK (json_valid(graph_json)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (definition_id, version)
    )
    """,
    """
    CREATE TABLE workflow_runs (
        workflow_run_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        definition_id TEXT NOT NULL,
        definition_version INTEGER NOT NULL,
        input_hash TEXT NOT NULL
            CHECK (length(input_hash) = 71 AND input_hash LIKE 'sha256:%'),
        status TEXT NOT NULL CHECK (
            status IN ('ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED',
                       'CANCELLED', 'SUPERSEDED')
        ),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        cancel_requested_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (definition_id, definition_version)
            REFERENCES workflow_definitions(definition_id, version)
    )
    """,
    """
    CREATE TABLE workflow_node_runs (
        node_run_id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(workflow_run_id)
            ON DELETE CASCADE,
        node_key TEXT NOT NULL,
        node_type TEXT NOT NULL,
        contract_version INTEGER NOT NULL CHECK (contract_version >= 1),
        input_bindings_json TEXT NOT NULL CHECK (json_valid(input_bindings_json)),
        input_hash TEXT NOT NULL
            CHECK (length(input_hash) = 71 AND input_hash LIKE 'sha256:%'),
        idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
        status TEXT NOT NULL CHECK (
            status IN ('BLOCKED', 'PENDING', 'RUNNING', 'RECONCILIATION_REQUIRED',
                       'NEEDS_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED',
                       'CANCELLED', 'SUPERSEDED')
        ),
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
        max_attempts INTEGER NOT NULL CHECK (max_attempts >= 1),
        active_attempt_id TEXT,
        output_version_id TEXT REFERENCES artifact_versions(version_id),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (attempt_count <= max_attempts),
        UNIQUE (workflow_run_id, node_key),
        UNIQUE (node_run_id, active_attempt_id),
        FOREIGN KEY (node_run_id, active_attempt_id)
            REFERENCES workflow_attempts(node_run_id, attempt_id)
            DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE TABLE workflow_attempts (
        attempt_id TEXT PRIMARY KEY,
        node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(node_run_id)
            ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
        execution_mode TEXT NOT NULL CHECK (execution_mode IN ('local', 'remote')),
        status TEXT NOT NULL CHECK (
            status IN ('READY', 'LEASED', 'RUNNING', 'SUBMIT_INTENT', 'SUBMITTING',
                       'WAITING_REMOTE', 'REMOTE_UNKNOWN', 'SUCCEEDED', 'FAILED',
                       'CANCEL_REQUESTED', 'CANCELLED', 'NOT_SUBMITTED')
        ),
        input_hash TEXT NOT NULL
            CHECK (length(input_hash) = 71 AND input_hash LIKE 'sha256:%'),
        request_fingerprint TEXT NOT NULL
            CHECK (length(request_fingerprint) = 71
                   AND request_fingerprint LIKE 'sha256:%'),
        provider_account_id TEXT,
        provider_model TEXT,
        provider_idempotency_key TEXT,
        provider_capabilities_json TEXT CHECK (
            provider_capabilities_json IS NULL OR json_valid(provider_capabilities_json)
        ),
        provider_job_id TEXT,
        dispatch_started_at TEXT,
        accepted_at TEXT,
        retry_disposition TEXT CHECK (
            retry_disposition IS NULL OR retry_disposition IN (
                'SAFE_LOCAL_RETRY', 'PROVIDER_CONFIRMED_NOT_ACCEPTED',
                'NON_RETRYABLE', 'REMOTE_UNKNOWN'
            )
        ),
        error_code TEXT,
        output_version_id TEXT REFERENCES artifact_versions(version_id),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (node_run_id, attempt_number),
        UNIQUE (node_run_id, attempt_id),
        CHECK (status <> 'SUBMITTING' OR dispatch_started_at IS NOT NULL),
        CHECK (status <> 'WAITING_REMOTE' OR provider_job_id IS NOT NULL),
        CHECK (status <> 'REMOTE_UNKNOWN' OR retry_disposition = 'REMOTE_UNKNOWN'),
        CHECK (status <> 'SUCCEEDED' OR output_version_id IS NOT NULL)
    )
    """,
    """
    CREATE TABLE task_ledger (
        task_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES workflow_attempts(attempt_id) ON DELETE CASCADE,
        task_kind TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('READY', 'LEASED', 'COMPLETED', 'CANCELLED')),
        priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100),
        available_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_token TEXT,
        lease_generation INTEGER NOT NULL CHECK (lease_generation >= 0),
        lease_expires_at TEXT,
        heartbeat_at TEXT,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
            status <> 'LEASED' OR (
                lease_owner IS NOT NULL AND lease_token IS NOT NULL
                AND lease_generation >= 1 AND lease_expires_at IS NOT NULL
                AND heartbeat_at IS NOT NULL
            )
        )
    )
    """,
    """
    CREATE TABLE workflow_transition_events (
        event_id TEXT PRIMARY KEY,
        entity_kind TEXT NOT NULL CHECK (entity_kind IN ('node', 'attempt', 'task')),
        entity_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        from_status TEXT,
        to_status TEXT NOT NULL,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('system', 'worker', 'human')),
        actor_id TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        lease_generation INTEGER,
        created_at TEXT NOT NULL,
        UNIQUE (entity_kind, entity_id, sequence)
    )
    """,
    """
    CREATE TABLE remote_reconciliations (
        reconciliation_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES workflow_attempts(attempt_id),
        decision TEXT NOT NULL CHECK (
            decision IN ('MATCHED_REMOTE_JOB', 'CONFIRMED_SUCCEEDED',
                         'CONFIRMED_NOT_SUBMITTED', 'STILL_UNKNOWN')
        ),
        evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
        operator_id TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE UNIQUE INDEX workflow_one_blocking_attempt_per_node
    ON workflow_attempts(node_run_id)
    WHERE status IN ('READY', 'LEASED', 'RUNNING', 'SUBMIT_INTENT', 'SUBMITTING',
                     'WAITING_REMOTE', 'REMOTE_UNKNOWN', 'CANCEL_REQUESTED')
    """,
    """
    CREATE UNIQUE INDEX workflow_one_open_task_per_kind
    ON task_ledger(attempt_id, task_kind)
    WHERE status IN ('READY', 'LEASED')
    """,
    """
    CREATE UNIQUE INDEX workflow_provider_idempotency
    ON workflow_attempts(provider_account_id, provider_idempotency_key)
    WHERE provider_account_id IS NOT NULL AND provider_idempotency_key IS NOT NULL
    """,
    """
    CREATE INDEX task_ledger_ready_order
    ON task_ledger(status, available_at, priority DESC, created_at, task_id)
    """,
    """
    CREATE TRIGGER workflow_remote_unknown_blocks_new_attempt
    BEFORE INSERT ON workflow_attempts
    WHEN EXISTS (
        SELECT 1 FROM workflow_attempts AS existing
        WHERE existing.node_run_id = NEW.node_run_id
          AND existing.status = 'REMOTE_UNKNOWN'
    )
    BEGIN
        SELECT RAISE(ABORT, 'remote unknown attempt blocks a new attempt');
    END
    """,
    """
    CREATE TRIGGER workflow_transition_events_immutable_update
    BEFORE UPDATE ON workflow_transition_events
    BEGIN
        SELECT RAISE(ABORT, 'workflow transition events are immutable');
    END
    """,
    """
    CREATE TRIGGER workflow_transition_events_immutable_delete
    BEFORE DELETE ON workflow_transition_events
    BEGIN
        SELECT RAISE(ABORT, 'workflow transition events are immutable');
    END
    """,
    """
    CREATE TRIGGER remote_reconciliations_immutable_update
    BEFORE UPDATE ON remote_reconciliations
    BEGIN
        SELECT RAISE(ABORT, 'remote reconciliations are immutable');
    END
    """,
    """
    CREATE TRIGGER remote_reconciliations_immutable_delete
    BEFORE DELETE ON remote_reconciliations
    BEGIN
        SELECT RAISE(ABORT, 'remote reconciliations are immutable');
    END
    """,
    """
    CREATE TRIGGER workflow_definitions_immutable_update
    BEFORE UPDATE ON workflow_definitions
    BEGIN
        SELECT RAISE(ABORT, 'workflow definitions are immutable');
    END
    """,
    """
    CREATE TRIGGER workflow_definitions_immutable_delete
    BEFORE DELETE ON workflow_definitions
    BEGIN
        SELECT RAISE(ABORT, 'workflow definitions are immutable');
    END
    """,
)


MIGRATION_5 = (
    """
    CREATE TABLE workflow_enqueue_keys (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(workflow_run_id)
            ON DELETE CASCADE,
        node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(node_run_id)
            ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, idempotency_key),
        UNIQUE (workflow_run_id),
        UNIQUE (node_run_id)
    )
    """,
    """
    INSERT INTO workflow_enqueue_keys (
        project_id, idempotency_key, workflow_run_id, node_run_id, created_at
    )
    SELECT run.project_id, node.idempotency_key, run.workflow_run_id,
           node.node_run_id, node.created_at
    FROM workflow_node_runs AS node
    JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
    """,
    """
    CREATE TRIGGER workflow_enqueue_keys_immutable_update
    BEFORE UPDATE ON workflow_enqueue_keys
    BEGIN
        SELECT RAISE(ABORT, 'workflow enqueue keys are immutable');
    END
    """,
)


MIGRATION_6 = (
    """
    ALTER TABLE artifact_versions
    ADD COLUMN producer_attempt_id TEXT REFERENCES workflow_attempts(attempt_id)
    """,
    """
    CREATE UNIQUE INDEX artifact_version_one_output_per_attempt
    ON artifact_versions(producer_attempt_id)
    WHERE producer_attempt_id IS NOT NULL
    """,
)


MIGRATION_8 = (
    """
    CREATE TABLE workflow_attempt_snapshots (
        attempt_id TEXT PRIMARY KEY REFERENCES workflow_attempts(attempt_id)
            ON DELETE CASCADE,
        snapshot_kind TEXT NOT NULL CHECK (
            length(snapshot_kind) BETWEEN 1 AND 80
            AND snapshot_kind NOT GLOB '*[^a-z0-9_.-]*'
        ),
        snapshot_json TEXT NOT NULL CHECK (
            json_valid(snapshot_json) AND length(snapshot_json) <= 2097152
        ),
        snapshot_hash TEXT NOT NULL CHECK (
            length(snapshot_hash) = 71 AND snapshot_hash LIKE 'sha256:%'
        ),
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TRIGGER workflow_attempt_snapshot_recovery_copy
    AFTER INSERT ON workflow_attempts
    WHEN NEW.attempt_number > 1
    BEGIN
        INSERT INTO workflow_attempt_snapshots (
            attempt_id, snapshot_kind, snapshot_json, snapshot_hash, created_at
        )
        SELECT NEW.attempt_id, snapshot.snapshot_kind, snapshot.snapshot_json,
               snapshot.snapshot_hash, NEW.created_at
        FROM workflow_attempt_snapshots AS snapshot
        JOIN workflow_attempts AS previous
          ON previous.attempt_id = snapshot.attempt_id
        WHERE previous.node_run_id = NEW.node_run_id
          AND previous.attempt_number = NEW.attempt_number - 1
          AND previous.input_hash = NEW.input_hash
          AND previous.request_fingerprint = NEW.request_fingerprint
        LIMIT 1;
    END
    """,
    """
    CREATE TRIGGER workflow_attempt_snapshots_immutable_update
    BEFORE UPDATE ON workflow_attempt_snapshots
    BEGIN
        SELECT RAISE(ABORT, 'workflow attempt snapshots are immutable');
    END
    """,
    """
    CREATE TRIGGER workflow_attempt_snapshots_immutable_delete
    BEFORE DELETE ON workflow_attempt_snapshots
    WHEN EXISTS (
        SELECT 1 FROM workflow_attempts
        WHERE attempt_id = OLD.attempt_id
    )
    BEGIN
        SELECT RAISE(ABORT, 'workflow attempt snapshots are immutable');
    END
    """,
)


MIGRATION_9 = (
    """
    CREATE TABLE agent_artifact_proposals (
        proposal_id TEXT PRIMARY KEY CHECK (
            length(proposal_id) = 36 AND proposal_id LIKE 'prp_%'
        ),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        producer_attempt_id TEXT NOT NULL UNIQUE
            REFERENCES workflow_attempts(attempt_id) ON DELETE CASCADE,
        producer_agent_run_id TEXT NOT NULL,
        producer_skill_run_id TEXT NOT NULL,
        target_artifact_type TEXT NOT NULL,
        proposal_json TEXT NOT NULL CHECK (
            json_valid(proposal_json) AND length(proposal_json) <= 8388608
        ),
        proposal_hash TEXT NOT NULL CHECK (
            length(proposal_hash) = 71 AND proposal_hash LIKE 'sha256:%'
        ),
        created_at TEXT NOT NULL,
        UNIQUE (project_id, producer_skill_run_id)
    )
    """,
    """
    CREATE TRIGGER agent_artifact_proposals_immutable_update
    BEFORE UPDATE ON agent_artifact_proposals
    BEGIN
        SELECT RAISE(ABORT, 'agent artifact proposals are immutable');
    END
    """,
    """
    CREATE TRIGGER agent_artifact_proposals_immutable_delete
    BEFORE DELETE ON agent_artifact_proposals
    WHEN EXISTS (
        SELECT 1 FROM projects WHERE id = OLD.project_id
    ) AND EXISTS (
        SELECT 1 FROM workflow_attempts WHERE attempt_id = OLD.producer_attempt_id
    )
    BEGIN
        SELECT RAISE(ABORT, 'agent artifact proposals are immutable');
    END
    """,
)


MIGRATION_10 = (
    """
    CREATE TABLE agent_runs (
        agent_run_id TEXT PRIMARY KEY CHECK (
            length(agent_run_id) = 36 AND agent_run_id LIKE 'agr_%'
        ),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_definition_id TEXT NOT NULL,
        agent_definition_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
            status IN ('PENDING', 'RUNNING', 'NEEDS_REVIEW', 'SUCCEEDED',
                       'FAILED', 'CANCELLED')
        ),
        delegated_skill_run_ids_json TEXT NOT NULL CHECK (
            json_valid(delegated_skill_run_ids_json)
            AND length(delegated_skill_run_ids_json) <= 1048576
        ),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, agent_run_id)
    )
    """,
    """
    CREATE TABLE agent_context_manifests (
        context_manifest_id TEXT PRIMARY KEY CHECK (
            length(context_manifest_id) = 36 AND context_manifest_id LIKE 'ctx_%'
        ),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_definition_id TEXT NOT NULL,
        agent_definition_version TEXT NOT NULL,
        skill_definition_id TEXT NOT NULL,
        skill_definition_version TEXT NOT NULL,
        manifest_json TEXT NOT NULL CHECK (
            json_valid(manifest_json) AND length(manifest_json) <= 8388608
            AND project_id IS json_extract(manifest_json, '$.project_id')
            AND agent_definition_id IS json_extract(
                manifest_json, '$.agent_definition.definition_id'
            )
            AND agent_definition_version IS json_extract(
                manifest_json, '$.agent_definition.version'
            )
            AND skill_definition_id IS json_extract(
                manifest_json, '$.skill_definition.definition_id'
            )
            AND skill_definition_version IS json_extract(
                manifest_json, '$.skill_definition.version'
            )
        ),
        manifest_hash TEXT NOT NULL CHECK (
            length(manifest_hash) = 71 AND manifest_hash LIKE 'sha256:%'
        ),
        created_at TEXT NOT NULL,
        UNIQUE (project_id, context_manifest_id)
    )
    """,
    """
    CREATE TABLE skill_runs (
        skill_run_id TEXT PRIMARY KEY CHECK (
            length(skill_run_id) = 36 AND skill_run_id LIKE 'skr_%'
        ),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_run_id TEXT NOT NULL,
        skill_definition_id TEXT NOT NULL,
        skill_definition_version TEXT NOT NULL,
        context_manifest_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
            status IN ('PENDING', 'RUNNING', 'NEEDS_REVIEW', 'SUCCEEDED', 'FAILED',
                       'CANCEL_REQUESTED', 'CANCELLED', 'REMOTE_UNKNOWN')
        ),
        proposal_id TEXT,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, context_manifest_id),
        UNIQUE (agent_run_id),
        FOREIGN KEY (project_id, agent_run_id)
            REFERENCES agent_runs(project_id, agent_run_id) ON DELETE CASCADE,
        FOREIGN KEY (project_id, context_manifest_id)
            REFERENCES agent_context_manifests(project_id, context_manifest_id)
    )
    """,
    """
    CREATE TRIGGER agent_context_manifests_immutable_update
    BEFORE UPDATE ON agent_context_manifests
    BEGIN
        SELECT RAISE(ABORT, 'agent context manifests are immutable');
    END
    """,
    """
    CREATE TRIGGER agent_context_manifests_immutable_delete
    BEFORE DELETE ON agent_context_manifests
    WHEN EXISTS (
        SELECT 1 FROM projects WHERE id = OLD.project_id
    )
    BEGIN
        SELECT RAISE(ABORT, 'agent context manifests are immutable');
    END
    """,
    """
    CREATE TRIGGER agent_runs_identity_immutable
    BEFORE UPDATE ON agent_runs
    WHEN OLD.agent_run_id IS NOT NEW.agent_run_id
      OR OLD.project_id IS NOT NEW.project_id
      OR OLD.agent_definition_id IS NOT NEW.agent_definition_id
      OR OLD.agent_definition_version IS NOT NEW.agent_definition_version
      OR OLD.delegated_skill_run_ids_json IS NOT NEW.delegated_skill_run_ids_json
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN
        SELECT RAISE(ABORT, 'agent run identity is immutable');
    END
    """,
    """
    CREATE TRIGGER skill_runs_identity_immutable
    BEFORE UPDATE ON skill_runs
    WHEN OLD.skill_run_id IS NOT NEW.skill_run_id
      OR OLD.project_id IS NOT NEW.project_id
      OR OLD.agent_run_id IS NOT NEW.agent_run_id
      OR OLD.skill_definition_id IS NOT NEW.skill_definition_id
      OR OLD.skill_definition_version IS NOT NEW.skill_definition_version
      OR OLD.context_manifest_id IS NOT NEW.context_manifest_id
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN
        SELECT RAISE(ABORT, 'skill run identity is immutable');
    END
    """,
    """
    CREATE TRIGGER skill_runs_chain_consistent_insert
    BEFORE INSERT ON skill_runs
    WHEN NOT EXISTS (
        SELECT 1
        FROM agent_runs AS agent
        JOIN agent_context_manifests AS context
          ON context.project_id = NEW.project_id
         AND context.context_manifest_id = NEW.context_manifest_id
        WHERE agent.project_id = NEW.project_id
          AND agent.agent_run_id = NEW.agent_run_id
          AND agent.agent_definition_id = context.agent_definition_id
          AND agent.agent_definition_version = context.agent_definition_version
          AND NEW.skill_definition_id = context.skill_definition_id
          AND NEW.skill_definition_version = context.skill_definition_version
          AND json_array_length(agent.delegated_skill_run_ids_json) = 1
          AND json_extract(agent.delegated_skill_run_ids_json, '$[0]') = NEW.skill_run_id
    )
    BEGIN
        SELECT RAISE(ABORT, 'skill run chain is inconsistent');
    END
    """,
)


MIGRATION_11 = (
    """
    CREATE TABLE proposal_run_enqueue_intents (
        agent_run_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        request_hash TEXT NOT NULL CHECK (
            length(request_hash) = 71 AND request_hash LIKE 'sha256:%'
        ),
        intent_json TEXT NOT NULL CHECK (
            json_valid(intent_json) AND length(intent_json) <= 2097152
        ),
        intent_hash TEXT NOT NULL CHECK (
            length(intent_hash) = 71 AND intent_hash LIKE 'sha256:%'
        ),
        created_at TEXT NOT NULL,
        UNIQUE (project_id, agent_run_id),
        FOREIGN KEY (project_id, agent_run_id)
            REFERENCES agent_runs(project_id, agent_run_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TRIGGER proposal_run_enqueue_intents_immutable_update
    BEFORE UPDATE ON proposal_run_enqueue_intents
    BEGIN
        SELECT RAISE(ABORT, 'proposal run enqueue intents are immutable');
    END
    """,
    """
    CREATE TRIGGER proposal_run_enqueue_intents_immutable_delete
    BEFORE DELETE ON proposal_run_enqueue_intents
    WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
    BEGIN
        SELECT RAISE(ABORT, 'proposal run enqueue intents are immutable');
    END
    """,
)
