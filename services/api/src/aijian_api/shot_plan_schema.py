"""Migration 40: immutable HUMAN proposal and adoption receipts; no provider state."""

SHOT_PLAN_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE shot_plan_write_requests (
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL
            CHECK (length(idempotency_key_hash) = 71 AND idempotency_key_hash LIKE 'sha256:%'),
        request_hash TEXT NOT NULL
            CHECK (length(request_hash) = 71 AND request_hash LIKE 'sha256:%'),
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, episode_id, idempotency_key_hash),
        FOREIGN KEY (project_id, episode_id, artifact_id)
            REFERENCES artifacts(project_id, episode_id, artifact_id) ON DELETE CASCADE,
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE shot_plan_adoptions (
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        proposal_artifact_id TEXT NOT NULL,
        proposal_version_id TEXT NOT NULL UNIQUE,
        proposal_content_hash TEXT NOT NULL
            CHECK (length(proposal_content_hash) = 71 AND proposal_content_hash LIKE 'sha256:%'),
        storyboard_artifact_id TEXT NOT NULL,
        storyboard_version_id TEXT NOT NULL UNIQUE,
        storyboard_content_hash TEXT NOT NULL
            CHECK (length(storyboard_content_hash) = 71
                AND storyboard_content_hash LIKE 'sha256:%'),
        actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 240),
        adopted_at TEXT NOT NULL,
        FOREIGN KEY (project_id, episode_id, proposal_artifact_id)
            REFERENCES artifacts(project_id, episode_id, artifact_id) ON DELETE CASCADE,
        FOREIGN KEY (proposal_artifact_id, proposal_version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE,
        FOREIGN KEY (project_id, episode_id, storyboard_artifact_id)
            REFERENCES artifacts(project_id, episode_id, artifact_id) ON DELETE CASCADE,
        FOREIGN KEY (storyboard_artifact_id, storyboard_version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE shot_plan_adoption_requests (
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL
            CHECK (length(idempotency_key_hash) = 71 AND idempotency_key_hash LIKE 'sha256:%'),
        request_hash TEXT NOT NULL
            CHECK (length(request_hash) = 71 AND request_hash LIKE 'sha256:%'),
        proposal_version_id TEXT NOT NULL,
        PRIMARY KEY (project_id, episode_id, idempotency_key_hash),
        FOREIGN KEY (proposal_version_id)
            REFERENCES shot_plan_adoptions(proposal_version_id) ON DELETE CASCADE
    )
    """,
    *(
        f"""CREATE TRIGGER {table}_no_update BEFORE UPDATE ON {table}
        BEGIN SELECT RAISE(ABORT, 'Shot plan receipt is immutable'); END"""
        for table in (
            "shot_plan_write_requests",
            "shot_plan_adoptions",
            "shot_plan_adoption_requests",
        )
    ),
)
