"""Migration 41: official director intent, raw completion and review receipts."""

OFFICIAL_DIRECTOR_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE official_director_operations (
        operation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        request_json TEXT NOT NULL CHECK (json_valid(request_json)),
        request_hash TEXT NOT NULL
            CHECK (length(request_hash) = 71 AND request_hash LIKE 'sha256:%'),
        status TEXT NOT NULL
            CHECK (status IN ('REMOTE_UNKNOWN', 'COMPLETED', 'NOT_SENT', 'INVALID')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        task_id TEXT NOT NULL UNIQUE REFERENCES task_ledger(task_id),
        attempt_id TEXT NOT NULL UNIQUE REFERENCES workflow_attempts(attempt_id),
        completion_json TEXT CHECK (completion_json IS NULL OR json_valid(completion_json)),
        completion_hash TEXT CHECK (
            completion_hash IS NULL
            OR (length(completion_hash) = 71 AND completion_hash LIKE 'sha256:%')
        ),
        validation_issues_json TEXT NOT NULL DEFAULT '[]'
            CHECK (json_valid(validation_issues_json)
                AND json_type(validation_issues_json) = 'array'),
        proposal_version_id TEXT REFERENCES artifact_versions(version_id),
        FOREIGN KEY (project_id, episode_id) REFERENCES episodes(project_id, id),
        CHECK ((completion_json IS NULL) = (completion_hash IS NULL)),
        CHECK ((status IN ('COMPLETED', 'INVALID')) = (completion_json IS NOT NULL)),
        CHECK ((status = 'COMPLETED') = (proposal_version_id IS NOT NULL)),
        CHECK ((status IN ('NOT_SENT', 'INVALID')) = (error_code IS NOT NULL)),
        CHECK (status = 'INVALID' OR json_array_length(validation_issues_json) = 0)
    )
    """,
    "CREATE INDEX official_director_episode "
    "ON official_director_operations(project_id, episode_id, created_at)",
    """
    CREATE TRIGGER official_director_task_chain BEFORE INSERT ON official_director_operations
    WHEN NOT EXISTS (
        SELECT 1 FROM task_ledger AS task
        JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id
        JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
        JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
        WHERE task.task_id = NEW.task_id AND attempt.attempt_id = NEW.attempt_id
          AND run.project_id = NEW.project_id AND run.definition_id = 'official.director.plan'
          AND task.task_kind = 'official.director.plan' AND attempt.execution_mode = 'remote'
          AND node.active_attempt_id = attempt.attempt_id AND node.max_attempts = 1
          AND json_extract(node.input_bindings_json, '$.operation_id') = NEW.operation_id
    )
    BEGIN SELECT RAISE(ABORT, 'Official director task chain is inconsistent'); END
    """,
    """
    CREATE TRIGGER official_director_request_immutable BEFORE UPDATE ON official_director_operations
    WHEN OLD.operation_id IS NOT NEW.operation_id OR OLD.project_id IS NOT NEW.project_id
      OR OLD.episode_id IS NOT NEW.episode_id OR OLD.request_json IS NOT NEW.request_json
      OR OLD.request_hash IS NOT NEW.request_hash OR OLD.created_at IS NOT NEW.created_at
      OR OLD.task_id IS NOT NEW.task_id OR OLD.attempt_id IS NOT NEW.attempt_id
      OR OLD.status <> 'REMOTE_UNKNOWN' OR NEW.status = 'REMOTE_UNKNOWN'
    BEGIN SELECT RAISE(ABORT, 'Official director operation is immutable'); END
    """,
    """
    CREATE TABLE official_director_adoptions (
        operation_id TEXT PRIMARY KEY REFERENCES official_director_operations(operation_id),
        proposal_version_id TEXT NOT NULL REFERENCES artifact_versions(version_id),
        proposal_content_hash TEXT NOT NULL
            CHECK (length(proposal_content_hash) = 71 AND proposal_content_hash LIKE 'sha256:%'),
        storyboard_version_id TEXT NOT NULL UNIQUE REFERENCES artifact_versions(version_id),
        storyboard_content_hash TEXT NOT NULL CHECK (
            length(storyboard_content_hash) = 71 AND storyboard_content_hash LIKE 'sha256:%'
        ),
        actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 240),
        adopted_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE official_director_rejections (
        operation_id TEXT PRIMARY KEY REFERENCES official_director_operations(operation_id),
        proposal_version_id TEXT NOT NULL REFERENCES artifact_versions(version_id),
        proposal_content_hash TEXT NOT NULL
            CHECK (length(proposal_content_hash) = 71 AND proposal_content_hash LIKE 'sha256:%'),
        actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 240),
        reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
        rejected_at TEXT NOT NULL
    )
    """,
    """
    CREATE TRIGGER official_director_adoption_chain BEFORE INSERT ON official_director_adoptions
    WHEN NOT EXISTS (
        SELECT 1 FROM official_director_operations AS operation
        JOIN artifact_versions AS proposal ON proposal.version_id = NEW.proposal_version_id
        JOIN artifacts AS proposal_artifact ON proposal_artifact.artifact_id = proposal.artifact_id
        JOIN artifact_versions AS storyboard ON storyboard.version_id = NEW.storyboard_version_id
        JOIN artifacts AS storyboard_artifact
          ON storyboard_artifact.artifact_id = storyboard.artifact_id
        WHERE operation.operation_id = NEW.operation_id AND operation.status = 'COMPLETED'
          AND operation.proposal_version_id = NEW.proposal_version_id
          AND proposal.content_hash = NEW.proposal_content_hash
          AND proposal_artifact.project_id = operation.project_id
          AND proposal_artifact.episode_id = operation.episode_id
          AND proposal_artifact.artifact_type = 'official_director_proposal'
          AND proposal.producer_attempt_id = operation.attempt_id
          AND proposal.author_actor_type = 'agent'
          AND proposal.author_actor_id = 'chatgpt-official:'
              || json_extract(operation.request_json, '$.profile_id')
          AND storyboard.content_hash = NEW.storyboard_content_hash
          AND storyboard_artifact.project_id = operation.project_id
          AND storyboard_artifact.episode_id = operation.episode_id
          AND storyboard_artifact.artifact_type = 'episode_storyboard'
          AND NOT EXISTS (SELECT 1 FROM official_director_rejections AS rejection
                          WHERE rejection.operation_id = NEW.operation_id)
    )
    BEGIN SELECT RAISE(ABORT, 'Official director adoption chain is inconsistent'); END
    """,
    """
    CREATE TRIGGER official_director_rejection_chain BEFORE INSERT ON official_director_rejections
    WHEN NOT EXISTS (
        SELECT 1 FROM official_director_operations AS operation
        JOIN artifact_versions AS proposal ON proposal.version_id = NEW.proposal_version_id
        JOIN artifacts AS artifact ON artifact.artifact_id = proposal.artifact_id
        WHERE operation.operation_id = NEW.operation_id AND operation.status = 'COMPLETED'
          AND operation.proposal_version_id = NEW.proposal_version_id
          AND proposal.content_hash = NEW.proposal_content_hash
          AND artifact.project_id = operation.project_id
          AND artifact.episode_id = operation.episode_id
          AND artifact.artifact_type = 'official_director_proposal'
          AND proposal.producer_attempt_id = operation.attempt_id
          AND proposal.author_actor_type = 'agent'
          AND proposal.author_actor_id = 'chatgpt-official:'
              || json_extract(operation.request_json, '$.profile_id')
          AND NOT EXISTS (SELECT 1 FROM official_director_adoptions AS adoption
                          WHERE adoption.operation_id = NEW.operation_id)
    )
    BEGIN SELECT RAISE(ABORT, 'Official director rejection chain is inconsistent'); END
    """,
    *(
        f"""CREATE TRIGGER {table}_immutable_update BEFORE UPDATE ON {table}
        BEGIN SELECT RAISE(ABORT, 'Official director review receipt is immutable'); END"""
        for table in ("official_director_adoptions", "official_director_rejections")
    ),
    *(
        f"""CREATE TRIGGER {table}_immutable_delete BEFORE DELETE ON {table}
        BEGIN SELECT RAISE(ABORT, 'Official director history is immutable'); END"""
        for table in (
            "official_director_operations",
            "official_director_adoptions",
            "official_director_rejections",
        )
    ),
)
