"""Additive evidence for resuming GETs; never stores bearer credentials."""

VIDEO_RECOVERY_MIGRATION = (
    """
    CREATE TABLE generation_video_recovery (
        attempt_id TEXT PRIMARY KEY REFERENCES generation_failure_attempt(id),
        input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
        account_sha256 TEXT NOT NULL CHECK(length(account_sha256)=64),
        provider_request_id TEXT NOT NULL,
        output_sha256 TEXT,
        output_bytes INTEGER,
        CHECK ((output_sha256 IS NULL AND output_bytes IS NULL) OR
               (length(output_sha256)=64 AND output_bytes>0))
    )
    """,
)
