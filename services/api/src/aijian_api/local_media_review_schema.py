"""Migration47: immutable attribution receipts; observations live in artifact_versions."""

LOCAL_MEDIA_REVIEW_MIGRATION = (
    """CREATE TABLE local_media_review_write_requests (
       project_id TEXT NOT NULL, episode_id TEXT NOT NULL,
       idempotency_key_hash TEXT NOT NULL CHECK(length(idempotency_key_hash)=71),
       request_hash TEXT NOT NULL CHECK(length(request_hash)=71),
       artifact_id TEXT NOT NULL, version_id TEXT NOT NULL UNIQUE,
       expected_revision INTEGER CHECK(expected_revision IS NULL OR expected_revision>=1),
       result_revision INTEGER NOT NULL CHECK(result_revision>=1),
       PRIMARY KEY(project_id, episode_id, idempotency_key_hash),
       FOREIGN KEY(project_id, episode_id, artifact_id)
         REFERENCES artifacts(project_id, episode_id, artifact_id) ON DELETE CASCADE,
       FOREIGN KEY(artifact_id, version_id)
         REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE)""",
    """CREATE TRIGGER local_media_review_receipt_no_update
       BEFORE UPDATE ON local_media_review_write_requests
       BEGIN SELECT RAISE(ABORT, 'Local media review receipt is immutable'); END""",
    """CREATE TRIGGER local_media_review_receipt_no_delete
       BEFORE DELETE ON local_media_review_write_requests
       WHEN EXISTS(SELECT 1 FROM artifact_versions WHERE version_id=OLD.version_id)
       BEGIN SELECT RAISE(ABORT, 'Local media review receipt is immutable'); END""",
)
