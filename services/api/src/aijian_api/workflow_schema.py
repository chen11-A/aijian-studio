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
