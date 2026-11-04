"""Migration 43: G5 write receipts and exact native image inspection evidence.

Visual content and human approval remain in the existing artifact/review tables.
"""

VISUAL_BIBLE_MIGRATION: tuple[str, ...] = (
    """CREATE TABLE visual_bible_write_requests (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        idempotency_key_hash TEXT NOT NULL CHECK(length(idempotency_key_hash)=71),
        request_hash TEXT NOT NULL CHECK(length(request_hash)=71),
        artifact_id TEXT NOT NULL, version_id TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(project_id,idempotency_key_hash),
        FOREIGN KEY(artifact_id,version_id) REFERENCES artifact_versions(artifact_id,version_id)
    )""",
    """CREATE TRIGGER visual_bible_write_requests_no_update
       BEFORE UPDATE ON visual_bible_write_requests
       BEGIN SELECT RAISE(ABORT,'G5 write receipt is immutable'); END""",
    """CREATE TRIGGER visual_bible_write_requests_owner
       BEFORE INSERT ON visual_bible_write_requests
       WHEN NOT EXISTS(SELECT 1 FROM artifact_versions v JOIN artifacts a
         ON a.artifact_id=v.artifact_id WHERE v.artifact_id=NEW.artifact_id
         AND v.version_id=NEW.version_id AND a.project_id=NEW.project_id
         AND a.episode_id IS NULL AND a.artifact_type='visual_bible')
       BEGIN SELECT RAISE(ABORT,'G5 write receipt scope mismatch'); END""",
    """CREATE TABLE visual_media_inspections (
        inspection_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL, version_id TEXT NOT NULL,
        asset_sha256 TEXT NOT NULL CHECK(length(asset_sha256)=64),
        operation_id TEXT NOT NULL, request_hash TEXT NOT NULL CHECK(length(request_hash)=71),
        evidence_json TEXT NOT NULL, evidence_hash TEXT NOT NULL CHECK(length(evidence_hash)=71),
        created_at TEXT NOT NULL,
        UNIQUE(project_id,operation_id),
        FOREIGN KEY(project_id,asset_id,version_id)
          REFERENCES media_asset_versions(project_id,asset_id,id) ON DELETE CASCADE
    )""",
    """CREATE TRIGGER visual_media_inspections_no_update
       BEFORE UPDATE ON visual_media_inspections
       BEGIN SELECT RAISE(ABORT,'Visual inspection is immutable'); END""",
    "DROP TRIGGER gate_decision_policy_and_ownership",
    """
    CREATE TRIGGER gate_decision_policy_and_ownership
    BEFORE INSERT ON gate_decisions
    BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM artifacts AS artifact
            WHERE artifact.artifact_id = NEW.artifact_id
              AND ((artifact.artifact_type = 'story_bible' AND NEW.gate = 'G2')
                OR (artifact.artifact_type = 'source_manifest' AND NEW.gate = 'G1')
                OR (artifact.artifact_type = 'visual_bible' AND artifact.episode_id IS NULL
                    AND NEW.gate = 'G5'))
        ) THEN RAISE(ABORT, 'Gate policy is not registered for artifact') END;
        SELECT CASE WHEN NEW.decision = 'approved_with_waiver'
            THEN RAISE(ABORT, 'waiver approval is not enabled') END;
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM review_submissions AS submission
            WHERE submission.submission_id = NEW.submission_id
              AND submission.artifact_id = NEW.artifact_id
              AND submission.version_id = NEW.version_id
              AND submission.gate = NEW.gate
        ) THEN RAISE(ABORT, 'decision submission ownership mismatch') END;
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM gate_readiness_reports AS report
            WHERE report.report_id = NEW.readiness_report_id
              AND report.artifact_id = NEW.artifact_id
              AND report.version_id = NEW.version_id
              AND report.gate = NEW.gate
        ) THEN RAISE(ABORT, 'decision report ownership mismatch') END;
        SELECT CASE WHEN NEW.confirmation_challenge_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM confirmation_challenges AS challenge
            WHERE challenge.challenge_id = NEW.confirmation_challenge_id
              AND challenge.artifact_id = NEW.artifact_id
              AND challenge.version_id = NEW.version_id
              AND challenge.gate = NEW.gate
              AND challenge.action = 'decision'
              AND challenge.readiness_report_id = NEW.readiness_report_id
              AND challenge.actor_id = NEW.actor_id
              AND challenge.head_revision = NEW.head_revision
              AND challenge.consumed_at IS NOT NULL
        ) THEN RAISE(ABORT, 'decision challenge ownership mismatch') END;
        SELECT CASE WHEN NEW.decision = 'approved' AND NOT EXISTS (
            SELECT 1 FROM role_signoffs AS signoff
            WHERE signoff.version_id = NEW.version_id AND signoff.gate = NEW.gate
              AND signoff.submission_id = NEW.submission_id
              AND signoff.readiness_report_id = NEW.readiness_report_id
              AND signoff.role = 'producer'
        ) THEN RAISE(ABORT, 'producer signoff is required') END;
        SELECT CASE WHEN NEW.decision = 'approved' AND NEW.gate IN ('G1','G2') AND NOT EXISTS (
            SELECT 1 FROM role_signoffs AS signoff
            WHERE signoff.version_id = NEW.version_id AND signoff.gate = NEW.gate
              AND signoff.submission_id = NEW.submission_id
              AND signoff.readiness_report_id = NEW.readiness_report_id
              AND signoff.role = 'writer'
        ) THEN RAISE(ABORT, 'writer signoff is required') END;
        SELECT CASE WHEN NEW.decision = 'approved' AND NEW.gate IN ('G2','G5') AND NOT EXISTS (
            SELECT 1 FROM role_signoffs AS signoff
            WHERE signoff.version_id = NEW.version_id AND signoff.gate = NEW.gate
              AND signoff.submission_id = NEW.submission_id
              AND signoff.readiness_report_id = NEW.readiness_report_id
              AND signoff.role = 'continuity_reviewer'
        ) THEN RAISE(ABORT, 'continuity signoff is required') END;
    END
    """,
)
