"""Durable, non-monetary video failure protection; no implicit allowance."""

GENERATION_FAILURE_MIGRATION = (
    """
    CREATE TABLE generation_failure_policy (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK(revision > 0),
        failure_limit INTEGER NOT NULL CHECK(failure_limit BETWEEN 0 AND 1000)
    )
    """,
    """
    CREATE TABLE generation_failure_attempt (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64),
        attempt_key_sha256 TEXT NOT NULL CHECK(length(attempt_key_sha256) = 64),
        policy_revision INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING','UNKNOWN','FAILED','SUCCEEDED')),
        UNIQUE(project_id, attempt_key_sha256)
    )
    """,
    """
    CREATE INDEX generation_failure_input_status
    ON generation_failure_attempt(project_id, input_sha256, status)
    """,
)
