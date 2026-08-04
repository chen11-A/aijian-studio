"""Crash-safe SQLite persistence for local project, source, and artifact truth."""

import hashlib
import hmac
import json
import secrets
import sqlite3
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
from uuid import uuid4

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import (
    ArtifactActorType,
    ArtifactDependency,
    ArtifactDependencyDraft,
    ArtifactHead,
    ArtifactRoleIndex,
    ArtifactSourceSpan,
    ArtifactSourceSpanDraft,
    ArtifactVersion,
    ArtifactVersionPayloadMetrics,
    ArtifactVersionRecord,
    ArtifactVersionSummary,
    ConfirmationChallenge,
    DependencyImpact,
    GateDecision,
    GateDecisionResult,
    GateDecisionValue,
    GateReadinessReport,
    PreparedReviewAction,
    Project,
    ProjectStatus,
    ReviewAction,
    ReviewSignoffResult,
    ReviewSubmission,
    ReviewSubmissionResult,
    RoleSignoff,
    SourceBlock,
    SourceBlockKind,
    SourceDocument,
    SourceDocumentSummary,
    SourceSpanRole,
    TrustedReviewActor,
)
from aijian_api.gate_policy import DEFAULT_GATE_POLICIES, GatePolicy
from aijian_api.ingestion import ParsedSource
from aijian_api.source_manifest import (
    SourceManifestBlockV1,
    SourceManifestContentV1,
    SourceManifestDocumentV1,
)

SCHEMA_VERSION = 3

type MigrationHook = Callable[[int, int], None]
type TransactionHook = Callable[[str, str], None]
type ArtifactContentResolver = Callable[
    [Callable[[str], str]],
    tuple[dict[str, object], tuple[ArtifactSourceSpanDraft, ...]],
]
type ArtifactRecordValidator = Callable[[ArtifactVersionRecord], None]
type ArtifactPayloadMetricsValidator = Callable[[ArtifactVersionPayloadMetrics], None]


_MIGRATION_1 = (
    """
    CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        aspect_ratio TEXT NOT NULL,
        target_duration_seconds INTEGER NOT NULL,
        source_language TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE source_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        media_type TEXT NOT NULL,
        encoding TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        raw_sha256 TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        chapter_count INTEGER NOT NULL CHECK (chapter_count >= 1),
        UNIQUE (project_id, raw_sha256)
    )
    """,
    """
    CREATE TABLE source_blocks (
        id TEXT PRIMARY KEY,
        source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        kind TEXT NOT NULL CHECK (kind IN ('chapter_heading', 'paragraph')),
        chapter_index INTEGER NOT NULL CHECK (chapter_index >= 1),
        text TEXT NOT NULL,
        normalized_start_byte INTEGER NOT NULL CHECK (normalized_start_byte >= 0),
        normalized_end_byte INTEGER NOT NULL
            CHECK (normalized_end_byte >= normalized_start_byte),
        content_sha256 TEXT NOT NULL,
        UNIQUE (source_document_id, ordinal)
    )
    """,
    "CREATE INDEX source_documents_project ON source_documents(project_id, imported_at DESC)",
    "CREATE INDEX source_blocks_document ON source_blocks(source_document_id, ordinal)",
)


_MIGRATION_2 = (
    "CREATE UNIQUE INDEX source_documents_project_id ON source_documents(project_id, id)",
    """
    CREATE UNIQUE INDEX source_blocks_project_document_id
    ON source_blocks(project_id, source_document_id, id)
    """,
    """
    CREATE TABLE artifacts (
        artifact_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        artifact_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (project_id, artifact_type)
    )
    """,
    """
    CREATE TABLE artifact_versions (
        version_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL CHECK (version_number >= 1),
        schema_version TEXT NOT NULL,
        content_json TEXT NOT NULL,
        content_hash TEXT NOT NULL
            CHECK (length(content_hash) = 71 AND content_hash LIKE 'sha256:%'),
        author_actor_type TEXT NOT NULL
            CHECK (author_actor_type IN ('human', 'agent', 'system')),
        author_actor_id TEXT NOT NULL,
        parent_version_id TEXT,
        change_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (artifact_id, version_number),
        UNIQUE (artifact_id, version_id),
        FOREIGN KEY (artifact_id, parent_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
            DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE TABLE artifact_heads (
        artifact_id TEXT PRIMARY KEY REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
        latest_version_id TEXT NOT NULL,
        review_version_id TEXT,
        review_submission_id TEXT,
        accepted_version_id TEXT,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        review_evidence_revision INTEGER NOT NULL CHECK (review_evidence_revision >= 0),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (artifact_id, latest_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
            DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (artifact_id, review_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
            DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (artifact_id, accepted_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
            DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE TABLE artifact_source_spans (
        span_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        source_block_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('supports', 'contradicts', 'context')),
        start_byte INTEGER NOT NULL CHECK (start_byte >= 0),
        end_byte INTEGER NOT NULL CHECK (end_byte > start_byte),
        claim TEXT NOT NULL,
        quote_hash TEXT NOT NULL
            CHECK (length(quote_hash) = 71 AND quote_hash LIKE 'sha256:%'),
        created_at TEXT NOT NULL,
        UNIQUE (version_id, fact_id, source_block_id, start_byte, end_byte, role),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE,
        FOREIGN KEY (project_id, source_document_id)
            REFERENCES source_documents(project_id, id),
        FOREIGN KEY (project_id, source_document_id, source_block_id)
            REFERENCES source_blocks(project_id, source_document_id, id)
    )
    """,
    """
    CREATE TABLE artifact_dependencies (
        dependency_id TEXT PRIMARY KEY,
        downstream_artifact_id TEXT NOT NULL,
        downstream_version_id TEXT NOT NULL,
        upstream_artifact_id TEXT NOT NULL,
        upstream_version_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        impact TEXT NOT NULL CHECK (impact IN ('blocking', 'advisory', 'render_only')),
        created_at TEXT NOT NULL,
        CHECK (downstream_version_id <> upstream_version_id),
        UNIQUE (downstream_version_id, upstream_version_id, relationship),
        FOREIGN KEY (downstream_artifact_id, downstream_version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE,
        FOREIGN KEY (upstream_artifact_id, upstream_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
    )
    """,
    """
    CREATE TABLE gate_readiness_reports (
        report_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        submission_id TEXT,
        policy_code TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        head_revision INTEGER NOT NULL CHECK (head_revision >= 1),
        review_evidence_revision INTEGER NOT NULL CHECK (review_evidence_revision >= 0),
        report_json TEXT NOT NULL,
        report_hash TEXT NOT NULL
            CHECK (length(report_hash) = 71 AND report_hash LIKE 'sha256:%'),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (artifact_id, report_id),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE review_submissions (
        submission_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        readiness_report_id TEXT NOT NULL REFERENCES gate_readiness_reports(report_id),
        supersedes_submission_id TEXT REFERENCES review_submissions(submission_id),
        submitted_by_actor_id TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        UNIQUE (version_id, gate),
        UNIQUE (artifact_id, submission_id),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE review_findings (
        finding_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        submission_id TEXT NOT NULL REFERENCES review_submissions(submission_id),
        scope_type TEXT NOT NULL,
        scope_id TEXT,
        severity TEXT NOT NULL CHECK (severity IN ('blocking', 'major', 'minor', 'note')),
        expected_change TEXT NOT NULL,
        responsible_role TEXT NOT NULL,
        created_by_actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (artifact_id, finding_id),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE review_finding_events (
        event_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        previous_event_id TEXT REFERENCES review_finding_events(event_id),
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN ('open', 'resolved', 'disputed')),
        resolution_version_id TEXT,
        reason TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (finding_id, sequence),
        FOREIGN KEY (artifact_id, finding_id)
            REFERENCES review_findings(artifact_id, finding_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE role_signoffs (
        signoff_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        submission_id TEXT NOT NULL REFERENCES review_submissions(submission_id),
        gate TEXT NOT NULL,
        role TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        review_evidence_revision INTEGER NOT NULL CHECK (review_evidence_revision >= 0),
        readiness_report_id TEXT NOT NULL REFERENCES gate_readiness_reports(report_id),
        self_review INTEGER NOT NULL CHECK (self_review IN (0, 1)),
        supersedes_signoff_id TEXT REFERENCES role_signoffs(signoff_id),
        signed_at TEXT NOT NULL,
        UNIQUE (version_id, gate, role, review_evidence_revision)
    )
    """,
    """
    CREATE TABLE gate_waivers (
        waiver_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        submission_id TEXT NOT NULL REFERENCES review_submissions(submission_id),
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        impact_scope_json TEXT NOT NULL,
        review_gate TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (artifact_id, waiver_id),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE gate_waiver_events (
        event_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        waiver_id TEXT NOT NULL,
        previous_event_id TEXT REFERENCES gate_waiver_events(event_id),
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN ('open', 'reviewed', 'closed')),
        reason TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (waiver_id, sequence),
        FOREIGN KEY (artifact_id, waiver_id)
            REFERENCES gate_waivers(artifact_id, waiver_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE gate_decisions (
        decision_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        submission_id TEXT NOT NULL REFERENCES review_submissions(submission_id),
        gate TEXT NOT NULL,
        decision TEXT NOT NULL
            CHECK (decision IN ('approved', 'approved_with_waiver', 'rejected')),
        readiness_report_id TEXT NOT NULL REFERENCES gate_readiness_reports(report_id),
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        self_review INTEGER NOT NULL CHECK (self_review IN (0, 1)),
        rationale TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        UNIQUE (version_id, gate),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE confirmation_challenges (
        challenge_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
        version_id TEXT NOT NULL REFERENCES artifact_versions(version_id) ON DELETE CASCADE,
        gate TEXT NOT NULL,
        action TEXT NOT NULL,
        readiness_report_id TEXT NOT NULL REFERENCES gate_readiness_reports(report_id),
        challenge_hash TEXT NOT NULL UNIQUE,
        head_revision INTEGER NOT NULL CHECK (head_revision >= 1),
        review_evidence_revision INTEGER NOT NULL CHECK (review_evidence_revision >= 0),
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TRIGGER artifact_dependencies_no_cycle
    BEFORE INSERT ON artifact_dependencies
    BEGIN
        SELECT CASE WHEN EXISTS (
            WITH RECURSIVE upstream(version_id) AS (
                SELECT NEW.upstream_version_id
                UNION
                SELECT dependency.upstream_version_id
                FROM artifact_dependencies AS dependency
                JOIN upstream ON dependency.downstream_version_id = upstream.version_id
            )
            SELECT 1 FROM upstream WHERE version_id = NEW.downstream_version_id
        ) THEN RAISE(ABORT, 'artifact dependency cycle') END;
    END
    """,
)


_IMMUTABLE_V2_TABLES = (
    "artifact_versions",
    "artifact_source_spans",
    "artifact_dependencies",
    "gate_readiness_reports",
    "review_submissions",
    "review_findings",
    "review_finding_events",
    "role_signoffs",
    "gate_decisions",
    "gate_waivers",
    "gate_waiver_events",
)


_IMMUTABILITY_TRIGGERS = tuple(
    f"""
    CREATE TRIGGER {table}_immutable_update
    BEFORE UPDATE ON {table}
    BEGIN
        SELECT RAISE(ABORT, '{table} rows are immutable');
    END
    """
    for table in _IMMUTABLE_V2_TABLES
) + tuple(
    f"""
    CREATE TRIGGER {table}_immutable_delete
    BEFORE DELETE ON {table}
    BEGIN
        SELECT RAISE(ABORT, '{table} rows are immutable');
    END
    """
    for table in _IMMUTABLE_V2_TABLES
)


_LEGACY_V2_CHALLENGE_COLUMNS = (
    """
    ALTER TABLE confirmation_challenges
    ADD COLUMN action_payload_hash TEXT NOT NULL
        DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    """,
    """
    ALTER TABLE confirmation_challenges
    ADD COLUMN policy_snapshot_hash TEXT NOT NULL
        DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    """,
    """
    ALTER TABLE confirmation_challenges
    ADD COLUMN actor_id TEXT NOT NULL DEFAULT 'legacy-unbound'
    """,
    "ALTER TABLE confirmation_challenges ADD COLUMN actor_roles_json TEXT NOT NULL DEFAULT '[]'",
)


_MIGRATION_3 = (
    """
    ALTER TABLE gate_decisions
    ADD COLUMN confirmation_challenge_id TEXT
    """,
    """
    ALTER TABLE gate_decisions
    ADD COLUMN head_revision INTEGER NOT NULL DEFAULT 0 CHECK (head_revision >= 0)
    """,
    """
    CREATE TRIGGER artifact_heads_revision_increments_once
    BEFORE UPDATE ON artifact_heads
    WHEN NEW.revision <> OLD.revision + 1
    BEGIN
        SELECT RAISE(ABORT, 'artifact head revision must increment exactly once');
    END
    """,
    """
    CREATE TRIGGER artifact_heads_accepted_requires_decision
    BEFORE UPDATE OF accepted_version_id ON artifact_heads
    WHEN NEW.accepted_version_id IS NOT OLD.accepted_version_id
    BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM gate_decisions AS decision
            WHERE decision.artifact_id = NEW.artifact_id
              AND decision.version_id = NEW.accepted_version_id
              AND decision.decision = 'approved'
              AND decision.head_revision = OLD.revision
              AND decision.confirmation_challenge_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM confirmation_challenges AS challenge
                  WHERE challenge.challenge_id = decision.confirmation_challenge_id
                    AND challenge.artifact_id = decision.artifact_id
                    AND challenge.version_id = decision.version_id
                    AND challenge.gate = decision.gate
                    AND challenge.action = 'decision'
                    AND challenge.consumed_at IS NOT NULL
              )
        ) THEN RAISE(ABORT, 'accepted head requires an approved Gate decision') END;
    END
    """,
    """
    CREATE TRIGGER artifact_heads_review_submission_owner
    BEFORE UPDATE OF review_submission_id ON artifact_heads
    WHEN NEW.review_submission_id IS NOT NULL
    BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM review_submissions AS submission
            WHERE submission.submission_id = NEW.review_submission_id
              AND submission.artifact_id = NEW.artifact_id
              AND submission.version_id = NEW.review_version_id
        ) THEN RAISE(ABORT, 'review head submission ownership mismatch') END;
    END
    """,
    """
    CREATE TRIGGER gate_readiness_report_submission_owner
    BEFORE INSERT ON gate_readiness_reports
    WHEN NEW.submission_id IS NOT NULL
    BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM review_submissions AS submission
            WHERE submission.submission_id = NEW.submission_id
              AND submission.artifact_id = NEW.artifact_id
              AND submission.version_id = NEW.version_id
              AND submission.gate = NEW.gate
        ) THEN RAISE(ABORT, 'readiness report submission ownership mismatch') END;
    END
    """,
    """
    CREATE TRIGGER review_submission_ownership
    BEFORE INSERT ON review_submissions
    BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM gate_readiness_reports AS report
            WHERE report.report_id = NEW.readiness_report_id
              AND report.artifact_id = NEW.artifact_id
              AND report.version_id = NEW.version_id
              AND report.gate = NEW.gate
        ) THEN RAISE(ABORT, 'submission readiness ownership mismatch') END;
        SELECT CASE WHEN NEW.supersedes_submission_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM review_submissions AS previous
            WHERE previous.submission_id = NEW.supersedes_submission_id
              AND previous.artifact_id = NEW.artifact_id
              AND previous.gate = NEW.gate
        ) THEN RAISE(ABORT, 'submission predecessor ownership mismatch') END;
    END
    """,
    """
    CREATE TRIGGER role_signoff_ownership
    BEFORE INSERT ON role_signoffs
    BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM review_submissions AS submission
            WHERE submission.submission_id = NEW.submission_id
              AND submission.artifact_id = NEW.artifact_id
              AND submission.version_id = NEW.version_id
              AND submission.gate = NEW.gate
        ) THEN RAISE(ABORT, 'signoff submission ownership mismatch') END;
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM gate_readiness_reports AS report
            WHERE report.report_id = NEW.readiness_report_id
              AND report.artifact_id = NEW.artifact_id
              AND report.version_id = NEW.version_id
              AND report.gate = NEW.gate
        ) THEN RAISE(ABORT, 'signoff report ownership mismatch') END;
        SELECT CASE WHEN NEW.supersedes_signoff_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM role_signoffs AS previous
            WHERE previous.signoff_id = NEW.supersedes_signoff_id
              AND previous.artifact_id = NEW.artifact_id
              AND previous.version_id = NEW.version_id
              AND previous.gate = NEW.gate
              AND previous.role = NEW.role
        ) THEN RAISE(ABORT, 'signoff predecessor ownership mismatch') END;
    END
    """,
    """
    CREATE TRIGGER gate_decision_policy_and_ownership
    BEFORE INSERT ON gate_decisions
    BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM artifacts AS artifact
            WHERE artifact.artifact_id = NEW.artifact_id
              AND ((artifact.artifact_type = 'story_bible' AND NEW.gate = 'G2')
                OR (artifact.artifact_type = 'source_manifest' AND NEW.gate = 'G1'))
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
        SELECT CASE WHEN NEW.decision = 'approved' AND NOT EXISTS (
            SELECT 1 FROM role_signoffs AS signoff
            WHERE signoff.version_id = NEW.version_id AND signoff.gate = NEW.gate
              AND signoff.submission_id = NEW.submission_id
              AND signoff.readiness_report_id = NEW.readiness_report_id
              AND signoff.role = 'writer'
        ) THEN RAISE(ABORT, 'writer signoff is required') END;
        SELECT CASE WHEN NEW.decision = 'approved' AND NEW.gate = 'G2' AND NOT EXISTS (
            SELECT 1 FROM role_signoffs AS signoff
            WHERE signoff.version_id = NEW.version_id AND signoff.gate = NEW.gate
              AND signoff.submission_id = NEW.submission_id
              AND signoff.readiness_report_id = NEW.readiness_report_id
              AND signoff.role = 'continuity_reviewer'
        ) THEN RAISE(ABORT, 'continuity signoff is required') END;
    END
    """,
    """
    CREATE TRIGGER confirmation_challenge_ownership
    BEFORE INSERT ON confirmation_challenges
    BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM artifact_versions AS version
            WHERE version.version_id = NEW.version_id
              AND version.artifact_id = NEW.artifact_id
        ) THEN RAISE(ABORT, 'challenge version ownership mismatch') END;
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM gate_readiness_reports AS report
            WHERE report.report_id = NEW.readiness_report_id
              AND report.artifact_id = NEW.artifact_id
              AND report.version_id = NEW.version_id
              AND report.gate = NEW.gate
        ) THEN RAISE(ABORT, 'challenge report ownership mismatch') END;
    END
    """,
    """
    CREATE TRIGGER confirmation_challenges_consume_once
    BEFORE UPDATE ON confirmation_challenges
    WHEN OLD.consumed_at IS NOT NULL
        OR NEW.consumed_at IS NULL
        OR NEW.challenge_id <> OLD.challenge_id
        OR NEW.artifact_id <> OLD.artifact_id
        OR NEW.version_id <> OLD.version_id
        OR NEW.gate <> OLD.gate
        OR NEW.action <> OLD.action
        OR NEW.action_payload_hash <> OLD.action_payload_hash
        OR NEW.policy_snapshot_hash <> OLD.policy_snapshot_hash
        OR NEW.actor_id <> OLD.actor_id
        OR NEW.actor_roles_json <> OLD.actor_roles_json
        OR NEW.readiness_report_id <> OLD.readiness_report_id
        OR NEW.challenge_hash <> OLD.challenge_hash
        OR NEW.head_revision <> OLD.head_revision
        OR NEW.review_evidence_revision <> OLD.review_evidence_revision
        OR NEW.expires_at <> OLD.expires_at
        OR NEW.created_at <> OLD.created_at
    BEGIN
        SELECT RAISE(ABORT, 'confirmation challenge is immutable except first consumption');
    END
    """,
    """
    CREATE TRIGGER confirmation_challenges_no_delete
    BEFORE DELETE ON confirmation_challenges
    BEGIN
        SELECT RAISE(ABORT, 'confirmation challenge cannot be deleted');
    END
    """,
    """
    CREATE TRIGGER review_findings_not_enabled
    BEFORE INSERT ON review_findings
    BEGIN
        SELECT RAISE(ABORT, 'review finding writes are not enabled');
    END
    """,
    """
    CREATE TRIGGER gate_waivers_not_enabled
    BEFORE INSERT ON gate_waivers
    BEGIN
        SELECT RAISE(ABORT, 'Gate waiver writes are not enabled');
    END
    """,
    """
    CREATE TRIGGER review_finding_events_not_enabled
    BEFORE INSERT ON review_finding_events
    BEGIN
        SELECT RAISE(ABORT, 'review finding event writes are not enabled');
    END
    """,
    """
    CREATE TRIGGER gate_waiver_events_not_enabled
    BEFORE INSERT ON gate_waiver_events
    BEGIN
        SELECT RAISE(ABORT, 'Gate waiver event writes are not enabled');
    END
    """,
)


_IMMUTABLE_V3_TABLES = ("source_documents", "source_blocks")
_IMMUTABILITY_V3_TRIGGERS = tuple(
    f"""
    CREATE TRIGGER {table}_immutable_update
    BEFORE UPDATE ON {table}
    BEGIN
        SELECT RAISE(ABORT, '{table} rows are immutable');
    END
    """
    for table in _IMMUTABLE_V3_TABLES
) + tuple(
    f"""
    CREATE TRIGGER {table}_immutable_delete
    BEFORE DELETE ON {table}
    BEGIN
        SELECT RAISE(ABORT, '{table} rows are immutable');
    END
    """
    for table in _IMMUTABLE_V3_TABLES
)


_MIGRATIONS = {
    1: _MIGRATION_1,
    2: _MIGRATION_2 + _IMMUTABILITY_TRIGGERS,
    3: _MIGRATION_3 + _IMMUTABILITY_V3_TRIGGERS,
}


_V3_LEGACY_INVARIANT_CHECKS = (
    (
        "artifact head review ownership mismatch",
        """
        SELECT 1 FROM artifact_heads AS head
        LEFT JOIN review_submissions AS submission
          ON submission.submission_id = head.review_submission_id
        WHERE head.review_submission_id IS NOT NULL AND (
            submission.submission_id IS NULL
            OR submission.artifact_id <> head.artifact_id
            OR submission.version_id <> head.review_version_id
        ) LIMIT 1
        """,
    ),
    (
        "accepted head has no approved Gate decision",
        """
        SELECT 1 FROM artifact_heads AS head
        WHERE head.accepted_version_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM gate_decisions AS decision
            WHERE decision.artifact_id = head.artifact_id
              AND decision.version_id = head.accepted_version_id
              AND decision.decision = 'approved'
        ) LIMIT 1
        """,
    ),
    (
        "readiness report submission ownership mismatch",
        """
        SELECT 1 FROM gate_readiness_reports AS report
        LEFT JOIN review_submissions AS submission
          ON submission.submission_id = report.submission_id
        WHERE report.submission_id IS NOT NULL AND (
            submission.submission_id IS NULL
            OR submission.artifact_id <> report.artifact_id
            OR submission.version_id <> report.version_id
            OR submission.gate <> report.gate
        ) LIMIT 1
        """,
    ),
    (
        "review submission readiness ownership mismatch",
        """
        SELECT 1 FROM review_submissions AS submission
        LEFT JOIN gate_readiness_reports AS report
          ON report.report_id = submission.readiness_report_id
        WHERE report.report_id IS NULL
           OR report.artifact_id <> submission.artifact_id
           OR report.version_id <> submission.version_id
           OR report.gate <> submission.gate
        LIMIT 1
        """,
    ),
    (
        "review submission predecessor ownership mismatch",
        """
        SELECT 1 FROM review_submissions AS submission
        LEFT JOIN review_submissions AS previous
          ON previous.submission_id = submission.supersedes_submission_id
        WHERE submission.supersedes_submission_id IS NOT NULL AND (
            previous.submission_id IS NULL
            OR previous.artifact_id <> submission.artifact_id
            OR previous.gate <> submission.gate
        ) LIMIT 1
        """,
    ),
    (
        "review finding submission ownership mismatch",
        """
        SELECT 1 FROM review_findings AS finding
        LEFT JOIN review_submissions AS submission
          ON submission.submission_id = finding.submission_id
        WHERE submission.submission_id IS NULL
           OR submission.artifact_id <> finding.artifact_id
           OR submission.version_id <> finding.version_id
        LIMIT 1
        """,
    ),
    (
        "review finding event predecessor ownership mismatch",
        """
        SELECT 1 FROM review_finding_events AS event
        LEFT JOIN review_finding_events AS previous
          ON previous.event_id = event.previous_event_id
        WHERE event.previous_event_id IS NOT NULL AND (
            previous.event_id IS NULL
            OR previous.artifact_id <> event.artifact_id
            OR previous.finding_id <> event.finding_id
        ) LIMIT 1
        """,
    ),
    (
        "role signoff ownership mismatch",
        """
        SELECT 1 FROM role_signoffs AS signoff
        LEFT JOIN review_submissions AS submission
          ON submission.submission_id = signoff.submission_id
        LEFT JOIN gate_readiness_reports AS report
          ON report.report_id = signoff.readiness_report_id
        WHERE submission.submission_id IS NULL
           OR submission.artifact_id <> signoff.artifact_id
           OR submission.version_id <> signoff.version_id
           OR submission.gate <> signoff.gate
           OR report.report_id IS NULL
           OR report.artifact_id <> signoff.artifact_id
           OR report.version_id <> signoff.version_id
           OR report.gate <> signoff.gate
        LIMIT 1
        """,
    ),
    (
        "role signoff predecessor ownership mismatch",
        """
        SELECT 1 FROM role_signoffs AS signoff
        LEFT JOIN role_signoffs AS previous
          ON previous.signoff_id = signoff.supersedes_signoff_id
        WHERE signoff.supersedes_signoff_id IS NOT NULL AND (
            previous.signoff_id IS NULL
            OR previous.artifact_id <> signoff.artifact_id
            OR previous.version_id <> signoff.version_id
            OR previous.gate <> signoff.gate
            OR previous.role <> signoff.role
        ) LIMIT 1
        """,
    ),
    (
        "Gate waiver submission ownership mismatch",
        """
        SELECT 1 FROM gate_waivers AS waiver
        LEFT JOIN review_submissions AS submission
          ON submission.submission_id = waiver.submission_id
        WHERE submission.submission_id IS NULL
           OR submission.artifact_id <> waiver.artifact_id
           OR submission.version_id <> waiver.version_id
        LIMIT 1
        """,
    ),
    (
        "Gate waiver event predecessor ownership mismatch",
        """
        SELECT 1 FROM gate_waiver_events AS event
        LEFT JOIN gate_waiver_events AS previous
          ON previous.event_id = event.previous_event_id
        WHERE event.previous_event_id IS NOT NULL AND (
            previous.event_id IS NULL
            OR previous.artifact_id <> event.artifact_id
            OR previous.waiver_id <> event.waiver_id
        ) LIMIT 1
        """,
    ),
    (
        "Gate decision ownership mismatch",
        """
        SELECT 1 FROM gate_decisions AS decision
        LEFT JOIN review_submissions AS submission
          ON submission.submission_id = decision.submission_id
        LEFT JOIN gate_readiness_reports AS report
          ON report.report_id = decision.readiness_report_id
        WHERE submission.submission_id IS NULL
           OR submission.artifact_id <> decision.artifact_id
           OR submission.version_id <> decision.version_id
           OR submission.gate <> decision.gate
           OR report.report_id IS NULL
           OR report.artifact_id <> decision.artifact_id
           OR report.version_id <> decision.version_id
           OR report.gate <> decision.gate
        LIMIT 1
        """,
    ),
    (
        "confirmation challenge ownership mismatch",
        """
        SELECT 1 FROM confirmation_challenges AS challenge
        LEFT JOIN artifact_versions AS version
          ON version.version_id = challenge.version_id
        LEFT JOIN gate_readiness_reports AS report
          ON report.report_id = challenge.readiness_report_id
        WHERE version.version_id IS NULL
           OR version.artifact_id <> challenge.artifact_id
           OR report.report_id IS NULL
           OR report.artifact_id <> challenge.artifact_id
           OR report.version_id <> challenge.version_id
           OR report.gate <> challenge.gate
        LIMIT 1
        """,
    ),
)


class ProjectNotFoundError(LookupError):
    pass


class SourceAlreadyImportedError(RuntimeError):
    pass


class SchemaTooNewError(RuntimeError):
    pass


class ArtifactConflictError(RuntimeError):
    pass


class ArtifactNotFoundError(LookupError):
    def __init__(self, artifact_type: str) -> None:
        super().__init__(f"Artifact was not found: {artifact_type}")
        self.artifact_type = artifact_type


class ArtifactDependencyInvalidError(RuntimeError):
    """Raised when a downstream version is not bound to an accepted upstream version."""


class SourceSpanInvalidError(ValueError):
    pass


class ReviewInvalidError(RuntimeError):
    pass


class GateNotReadyError(RuntimeError):
    pass


def _default_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _challenge_token() -> str:
    return secrets.token_urlsafe(32)


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class StudioRepository:
    def __init__(
        self,
        database_path: Path,
        *,
        id_factory: Callable[[str], str] = _default_id,
        clock: Callable[[], datetime] = _utc_now,
        migration_hook: MigrationHook | None = None,
        challenge_token_factory: Callable[[], str] = _challenge_token,
        gate_policies: Mapping[str, GatePolicy] | None = None,
        allow_gate_policy_override: bool = False,
        transaction_hook: TransactionHook | None = None,
    ) -> None:
        self._database_path = database_path
        self._id_factory = id_factory
        self._clock = clock
        self._migration_hook = migration_hook
        self._challenge_token_factory = challenge_token_factory
        if gate_policies is not None and not allow_gate_policy_override:
            raise ValueError("Gate policy overrides are restricted to explicit test composition")
        self._gate_policies = gate_policies or DEFAULT_GATE_POLICIES
        self._transaction_hook = transaction_hook
        self._database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._open()
        try:
            yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as connection:
            version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if version > SCHEMA_VERSION:
                raise SchemaTooNewError("Workspace schema is newer than this application")
            connection.execute("PRAGMA journal_mode = WAL")
            while version < SCHEMA_VERSION:
                next_version = version + 1
                statements = _MIGRATIONS[next_version]
                if next_version == 3:
                    challenge_columns = {
                        str(row["name"])
                        for row in connection.execute(
                            "PRAGMA table_info(confirmation_challenges)"
                        ).fetchall()
                    }
                    if "action_payload_hash" not in challenge_columns:
                        statements = _LEGACY_V2_CHALLENGE_COLUMNS + statements
                connection.execute("BEGIN IMMEDIATE")
                try:
                    if next_version == 3:
                        self._validate_v3_legacy_invariants(connection)
                    for step, statement in enumerate(statements):
                        connection.execute(statement)
                        if self._migration_hook is not None:
                            self._migration_hook(next_version, step)
                    foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
                    if foreign_key_errors:
                        raise RuntimeError("Migration produced invalid foreign keys")
                    connection.execute(f"PRAGMA user_version = {next_version}")
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
                version = next_version

    @staticmethod
    def _validate_v3_legacy_invariants(connection: sqlite3.Connection) -> None:
        for message, query in _V3_LEGACY_INVARIANT_CHECKS:
            if connection.execute(query).fetchone() is not None:
                raise RuntimeError(f"Cannot migrate workspace to schema v3: {message}")

    def create_project(
        self,
        *,
        name: str,
        aspect_ratio: str,
        target_duration_seconds: int,
        source_language: str,
    ) -> Project:
        now = self._clock()
        project = Project(
            id=self._id_factory("prj"),
            name=name,
            aspect_ratio=aspect_ratio,
            target_duration_seconds=target_duration_seconds,
            source_language=source_language,
            status="active",
            revision=1,
            created_at=now,
            updated_at=now,
        )
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO projects (
                    id, name, aspect_ratio, target_duration_seconds, source_language,
                    status, revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project.id,
                    project.name,
                    project.aspect_ratio,
                    project.target_duration_seconds,
                    project.source_language,
                    project.status,
                    project.revision,
                    _timestamp(project.created_at),
                    _timestamp(project.updated_at),
                ),
            )
            connection.commit()
        return project

    def list_projects(self) -> list[Project]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM projects ORDER BY updated_at DESC, id ASC"
            ).fetchall()
        return [self._project_from_row(row) for row in rows]

    def get_project(self, project_id: str) -> Project:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
        if row is None:
            raise ProjectNotFoundError("Project was not found")
        return self._project_from_row(row)

    def import_source(self, project_id: str, source: ParsedSource) -> SourceDocument:
        document_id = self._id_factory("src")
        imported_at = self._clock()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                project = connection.execute(
                    "SELECT id FROM projects WHERE id = ?", (project_id,)
                ).fetchone()
                if project is None:
                    raise ProjectNotFoundError("Project was not found")
                duplicate = connection.execute(
                    "SELECT id FROM source_documents WHERE project_id = ? AND raw_sha256 = ?",
                    (project_id, source.raw_sha256),
                ).fetchone()
                if duplicate is not None:
                    raise SourceAlreadyImportedError("Source has already been imported")

                connection.execute(
                    """
                    INSERT INTO source_documents (
                        id, project_id, filename, media_type, encoding, byte_size, raw_sha256,
                        normalized_text, imported_at, chapter_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        document_id,
                        project_id,
                        source.filename,
                        source.media_type,
                        source.encoding,
                        source.byte_size,
                        source.raw_sha256,
                        source.normalized_text,
                        _timestamp(imported_at),
                        source.chapter_count,
                    ),
                )
                blocks: list[SourceBlock] = []
                for draft in source.blocks:
                    block = SourceBlock(
                        id=self._id_factory("srcb"),
                        source_document_id=document_id,
                        project_id=project_id,
                        ordinal=draft.ordinal,
                        kind=draft.kind,
                        chapter_index=draft.chapter_index,
                        text=draft.text,
                        normalized_start_byte=draft.normalized_start_byte,
                        normalized_end_byte=draft.normalized_end_byte,
                        content_sha256=draft.content_sha256,
                    )
                    connection.execute(
                        """
                        INSERT INTO source_blocks (
                            id, source_document_id, project_id, ordinal, kind, chapter_index,
                            text, normalized_start_byte, normalized_end_byte, content_sha256
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            block.id,
                            block.source_document_id,
                            block.project_id,
                            block.ordinal,
                            block.kind,
                            block.chapter_index,
                            block.text,
                            block.normalized_start_byte,
                            block.normalized_end_byte,
                            block.content_sha256,
                        ),
                    )
                    blocks.append(block)
                self._append_source_manifest_draft(
                    connection,
                    project_id=project_id,
                    created_at=imported_at,
                )
                self._transaction_step("import_source", "manifest_updated")
                connection.execute(
                    "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
                    (_timestamp(imported_at), project_id),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return SourceDocument(
            id=document_id,
            project_id=project_id,
            filename=source.filename,
            media_type=source.media_type,
            encoding=source.encoding,
            byte_size=source.byte_size,
            raw_sha256=source.raw_sha256,
            normalized_text=source.normalized_text,
            imported_at=imported_at,
            chapter_count=source.chapter_count,
            blocks=tuple(blocks),
        )

    def _append_source_manifest_draft(
        self,
        connection: sqlite3.Connection,
        *,
        project_id: str,
        created_at: datetime,
    ) -> ArtifactVersionRecord:
        document_rows = connection.execute(
            """
            SELECT * FROM source_documents
            WHERE project_id = ?
            ORDER BY imported_at ASC, id ASC
            """,
            (project_id,),
        ).fetchall()
        documents: list[SourceManifestDocumentV1] = []
        for import_order, document_row in enumerate(document_rows, start=1):
            block_rows = connection.execute(
                """
                SELECT * FROM source_blocks
                WHERE project_id = ? AND source_document_id = ?
                ORDER BY ordinal ASC
                """,
                (project_id, str(document_row["id"])),
            ).fetchall()
            documents.append(
                SourceManifestDocumentV1(
                    source_document_id=str(document_row["id"]),
                    import_order=import_order,
                    filename=str(document_row["filename"]),
                    media_type="text/plain",
                    encoding="utf-8",
                    byte_size=int(document_row["byte_size"]),
                    raw_sha256=str(document_row["raw_sha256"]),
                    normalized_sha256=hashlib.sha256(
                        str(document_row["normalized_text"]).encode("utf-8")
                    ).hexdigest(),
                    chapter_count=int(document_row["chapter_count"]),
                    blocks=[
                        SourceManifestBlockV1(
                            source_block_id=str(block_row["id"]),
                            ordinal=int(block_row["ordinal"]),
                            kind=cast(SourceBlockKind, str(block_row["kind"])),
                            chapter_index=int(block_row["chapter_index"]),
                            start_byte=int(block_row["normalized_start_byte"]),
                            end_byte=int(block_row["normalized_end_byte"]),
                            content_sha256=str(block_row["content_sha256"]),
                        )
                        for block_row in block_rows
                    ],
                )
            )
        content_model = SourceManifestContentV1(documents=documents)
        content = cast(dict[str, object], content_model.model_dump(mode="json"))
        content_json = canonical_content_bytes(content).decode("utf-8")
        content_hash = canonical_content_hash(content)
        artifact_row = connection.execute(
            """
            SELECT * FROM artifacts
            WHERE project_id = ? AND artifact_type = 'source_manifest'
            """,
            (project_id,),
        ).fetchone()
        version_id = self._id_factory("ver")
        if artifact_row is None:
            artifact_id = self._id_factory("art")
            version_number = 1
            parent_version_id = None
            connection.execute(
                "INSERT INTO artifacts VALUES (?, ?, 'source_manifest', ?)",
                (artifact_id, project_id, _timestamp(created_at)),
            )
        else:
            artifact_id = str(artifact_row["artifact_id"])
            head_row = connection.execute(
                "SELECT * FROM artifact_heads WHERE artifact_id = ?", (artifact_id,)
            ).fetchone()
            if head_row is None:
                raise RuntimeError("Source manifest head is missing")
            parent_version_id = str(head_row["latest_version_id"])
            version_number = int(
                connection.execute(
                    """
                    SELECT COALESCE(MAX(version_number), 0) + 1
                    FROM artifact_versions WHERE artifact_id = ?
                    """,
                    (artifact_id,),
                ).fetchone()[0]
            )
        version = ArtifactVersion(
            id=version_id,
            artifact_id=artifact_id,
            version_number=version_number,
            schema_version="1.0.0",
            content=content,
            content_hash=content_hash,
            author_actor_type="system",
            author_actor_id="source-import",
            parent_version_id=parent_version_id,
            change_summary="同步不可变来源清单",
            created_at=created_at,
        )
        connection.execute(
            """
            INSERT INTO artifact_versions (
                version_id, artifact_id, version_number, schema_version, content_json,
                content_hash, author_actor_type, author_actor_id, parent_version_id,
                change_summary, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                version.id,
                version.artifact_id,
                version.version_number,
                version.schema_version,
                content_json,
                version.content_hash,
                version.author_actor_type,
                version.author_actor_id,
                version.parent_version_id,
                version.change_summary,
                _timestamp(version.created_at),
            ),
        )
        self._transaction_step("import_source", "manifest_version_inserted")
        if artifact_row is None:
            connection.execute(
                """
                INSERT INTO artifact_heads (
                    artifact_id, latest_version_id, review_version_id,
                    review_submission_id, accepted_version_id, revision,
                    review_evidence_revision, updated_at
                ) VALUES (?, ?, NULL, NULL, NULL, 1, 0, ?)
                """,
                (artifact_id, version.id, _timestamp(created_at)),
            )
        else:
            connection.execute(
                """
                UPDATE artifact_heads
                SET latest_version_id = ?, revision = revision + 1, updated_at = ?
                WHERE artifact_id = ?
                """,
                (version.id, _timestamp(created_at), artifact_id),
            )
        head = self._load_artifact_head(connection, artifact_id)
        return ArtifactVersionRecord(
            version=version,
            head=head,
            source_spans=(),
            dependencies=(),
        )

    def list_sources(self, project_id: str) -> list[SourceDocumentSummary]:
        self.get_project(project_id)
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT source_documents.*, COUNT(source_blocks.id) AS block_count
                FROM source_documents
                LEFT JOIN source_blocks ON source_blocks.source_document_id = source_documents.id
                WHERE source_documents.project_id = ?
                GROUP BY source_documents.id
                ORDER BY imported_at DESC, source_documents.id ASC
                """,
                (project_id,),
            ).fetchall()
        return [self._source_summary_from_row(row) for row in rows]

    def get_source(self, project_id: str, source_id: str) -> SourceDocument:
        with self._connection() as connection:
            document = connection.execute(
                "SELECT * FROM source_documents WHERE project_id = ? AND id = ?",
                (project_id, source_id),
            ).fetchone()
            if document is None:
                raise ProjectNotFoundError("Source document was not found")
            block_rows = connection.execute(
                "SELECT * FROM source_blocks WHERE source_document_id = ? ORDER BY ordinal ASC",
                (source_id,),
            ).fetchall()
        blocks = tuple(self._source_block_from_row(row) for row in block_rows)
        return SourceDocument(
            id=str(document["id"]),
            project_id=str(document["project_id"]),
            filename=str(document["filename"]),
            media_type=str(document["media_type"]),
            encoding=str(document["encoding"]),
            byte_size=int(document["byte_size"]),
            raw_sha256=str(document["raw_sha256"]),
            normalized_text=str(document["normalized_text"]),
            imported_at=_datetime(str(document["imported_at"])),
            chapter_count=int(document["chapter_count"]),
            blocks=blocks,
        )

    def create_artifact_version(
        self,
        *,
        project_id: str,
        artifact_type: str,
        schema_version: str,
        content: dict[str, object] | None,
        author_actor_type: ArtifactActorType,
        author_actor_id: str,
        change_summary: str,
        parent_version_id: str | None = None,
        expected_revision: int | None = None,
        source_spans: tuple[ArtifactSourceSpanDraft, ...] = (),
        dependencies: tuple[ArtifactDependencyDraft, ...] = (),
        required_accepted_upstream_version_id: str | None = None,
        content_resolver: ArtifactContentResolver | None = None,
        record_validator: ArtifactRecordValidator | None = None,
    ) -> ArtifactVersionRecord:
        """Append an immutable artifact version and conditionally move its latest head."""

        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                project = connection.execute(
                    "SELECT id FROM projects WHERE id = ?", (project_id,)
                ).fetchone()
                if project is None:
                    raise ProjectNotFoundError("Project was not found")

                if artifact_type == "story_bible" and required_accepted_upstream_version_id is None:
                    raise ArtifactDependencyInvalidError(
                        "StoryBible requires an exact accepted SourceManifest dependency"
                    )
                if required_accepted_upstream_version_id is not None:
                    accepted_upstream = connection.execute(
                        """
                        SELECT artifacts.artifact_type, artifact_heads.accepted_version_id
                        FROM artifact_versions
                        JOIN artifacts
                            ON artifacts.artifact_id = artifact_versions.artifact_id
                        JOIN artifact_heads
                            ON artifact_heads.artifact_id = artifacts.artifact_id
                        WHERE artifacts.project_id = ?
                            AND artifact_versions.version_id = ?
                        """,
                        (project_id, required_accepted_upstream_version_id),
                    ).fetchone()
                    has_blocking_dependency = any(
                        dependency.upstream_version_id == required_accepted_upstream_version_id
                        and dependency.relationship == "derived_from"
                        and dependency.impact == "blocking"
                        for dependency in dependencies
                    )
                    if (
                        accepted_upstream is None
                        or str(accepted_upstream["artifact_type"]) != "source_manifest"
                        or accepted_upstream["accepted_version_id"]
                        != required_accepted_upstream_version_id
                        or not has_blocking_dependency
                    ):
                        raise ArtifactDependencyInvalidError(
                            "StoryBible requires an exact accepted SourceManifest dependency"
                        )

                if content_resolver is not None:
                    if content is not None or source_spans:
                        raise ValueError(
                            "Resolved artifact creation cannot also provide canonical "
                            "content or spans"
                        )
                    content, source_spans = content_resolver(self._id_factory)
                if content is None:
                    raise ValueError("Artifact content is required")
                content_bytes = canonical_content_bytes(content)
                content_json = content_bytes.decode("utf-8")
                content_hash = canonical_content_hash(content)
                created_at = self._clock()
                version_id = self._id_factory("ver")

                artifact_row = connection.execute(
                    "SELECT * FROM artifacts WHERE project_id = ? AND artifact_type = ?",
                    (project_id, artifact_type),
                ).fetchone()
                if artifact_row is None:
                    if expected_revision is not None or parent_version_id is not None:
                        raise ArtifactConflictError("Artifact does not have the expected head")
                    artifact_id = self._id_factory("art")
                    version_number = 1
                    connection.execute(
                        "INSERT INTO artifacts VALUES (?, ?, ?, ?)",
                        (artifact_id, project_id, artifact_type, _timestamp(created_at)),
                    )
                else:
                    artifact_id = str(artifact_row["artifact_id"])
                    head_row = connection.execute(
                        "SELECT * FROM artifact_heads WHERE artifact_id = ?", (artifact_id,)
                    ).fetchone()
                    if (
                        head_row is None
                        or expected_revision is None
                        or int(head_row["revision"]) != expected_revision
                    ):
                        raise ArtifactConflictError("Artifact head revision has changed")
                    if parent_version_id is None:
                        raise ArtifactConflictError("A revision must identify its parent version")
                    if artifact_type == "story_bible" and parent_version_id != str(
                        head_row["latest_version_id"]
                    ):
                        raise ArtifactConflictError(
                            "A StoryBible revision must use the current latest version as parent"
                        )
                    parent = connection.execute(
                        """
                        SELECT version_number FROM artifact_versions
                        WHERE artifact_id = ? AND version_id = ?
                        """,
                        (artifact_id, parent_version_id),
                    ).fetchone()
                    if parent is None:
                        raise ArtifactConflictError(
                            "Parent version does not belong to the artifact"
                        )
                    version_number = int(
                        connection.execute(
                            """
                            SELECT COALESCE(MAX(version_number), 0) + 1
                            FROM artifact_versions WHERE artifact_id = ?
                            """,
                            (artifact_id,),
                        ).fetchone()[0]
                    )

                version = ArtifactVersion(
                    id=version_id,
                    artifact_id=artifact_id,
                    version_number=version_number,
                    schema_version=schema_version,
                    content=content,
                    content_hash=content_hash,
                    author_actor_type=author_actor_type,
                    author_actor_id=author_actor_id,
                    parent_version_id=parent_version_id,
                    change_summary=change_summary,
                    created_at=created_at,
                )
                connection.execute(
                    """
                    INSERT INTO artifact_versions (
                        version_id, artifact_id, version_number, schema_version, content_json,
                        content_hash, author_actor_type, author_actor_id, parent_version_id,
                        change_summary, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        version.id,
                        version.artifact_id,
                        version.version_number,
                        version.schema_version,
                        content_json,
                        version.content_hash,
                        version.author_actor_type,
                        version.author_actor_id,
                        version.parent_version_id,
                        version.change_summary,
                        _timestamp(version.created_at),
                    ),
                )

                persisted_spans = tuple(
                    self._insert_source_span(
                        connection,
                        project_id=project_id,
                        artifact_id=artifact_id,
                        version_id=version.id,
                        draft=draft,
                        created_at=created_at,
                    )
                    for draft in source_spans
                )
                persisted_dependencies = tuple(
                    self._insert_dependency(
                        connection,
                        project_id=project_id,
                        downstream_artifact_id=artifact_id,
                        downstream_version_id=version.id,
                        draft=draft,
                        created_at=created_at,
                    )
                    for draft in dependencies
                )

                if artifact_row is None:
                    connection.execute(
                        """
                        INSERT INTO artifact_heads (
                            artifact_id, latest_version_id, review_version_id,
                            review_submission_id, accepted_version_id, revision,
                            review_evidence_revision, updated_at
                        ) VALUES (?, ?, NULL, NULL, NULL, 1, 0, ?)
                        """,
                        (artifact_id, version.id, _timestamp(created_at)),
                    )
                else:
                    updated = connection.execute(
                        """
                        UPDATE artifact_heads
                        SET latest_version_id = ?, revision = revision + 1, updated_at = ?
                        WHERE artifact_id = ? AND revision = ?
                        """,
                        (
                            version.id,
                            _timestamp(created_at),
                            artifact_id,
                            expected_revision,
                        ),
                    )
                    if updated.rowcount != 1:
                        raise ArtifactConflictError("Artifact head revision has changed")

                head_row = connection.execute(
                    "SELECT * FROM artifact_heads WHERE artifact_id = ?", (artifact_id,)
                ).fetchone()
                if head_row is None:
                    raise RuntimeError("Artifact head was not persisted")
                head = self._artifact_head_from_row(head_row)
                record = ArtifactVersionRecord(
                    version=version,
                    head=head,
                    source_spans=persisted_spans,
                    dependencies=persisted_dependencies,
                )
                if record_validator is not None:
                    record_validator(record)
                connection.commit()
            except sqlite3.IntegrityError as error:
                connection.rollback()
                raise ArtifactConflictError("Artifact transaction violated an invariant") from error
            except Exception:
                connection.rollback()
                raise

        return record

    def get_artifact_head(self, project_id: str, artifact_type: str) -> ArtifactHead:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT artifact_heads.*
                FROM artifact_heads
                JOIN artifacts ON artifacts.artifact_id = artifact_heads.artifact_id
                WHERE artifacts.project_id = ? AND artifacts.artifact_type = ?
                """,
                (project_id, artifact_type),
            ).fetchone()
        if row is None:
            raise ArtifactConflictError("Artifact was not found")
        return self._artifact_head_from_row(row)

    def get_artifact_version(
        self,
        project_id: str,
        artifact_type: str,
        version_id: str,
        payload_metrics_validator: ArtifactPayloadMetricsValidator | None = None,
    ) -> ArtifactVersionRecord:
        with self._connection() as connection:
            try:
                connection.execute("BEGIN")
                if payload_metrics_validator is not None:
                    payload_metrics_validator(
                        self._get_artifact_version_payload_metrics_in_connection(
                            connection,
                            project_id=project_id,
                            artifact_type=artifact_type,
                            version_id=version_id,
                        )
                    )
                record = self._get_artifact_version_in_connection(
                    connection,
                    project_id=project_id,
                    artifact_type=artifact_type,
                    version_id=version_id,
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return record

    def _get_artifact_version_payload_metrics_in_connection(
        self,
        connection: sqlite3.Connection,
        *,
        project_id: str,
        artifact_type: str,
        version_id: str,
    ) -> ArtifactVersionPayloadMetrics:
        row = connection.execute(
            """
            SELECT
                length(CAST(artifact_versions.content_json AS BLOB)) AS content_json_bytes,
                (
                    SELECT COUNT(*)
                    FROM artifact_source_spans
                    WHERE artifact_source_spans.version_id = artifact_versions.version_id
                ) AS source_span_count,
                (
                    SELECT COALESCE(SUM(length(CAST(claim AS BLOB))), 0)
                    FROM artifact_source_spans
                    WHERE artifact_source_spans.version_id = artifact_versions.version_id
                ) AS source_span_claim_bytes
            FROM artifact_versions
            JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
            WHERE artifacts.project_id = ? AND artifacts.artifact_type = ?
                AND artifact_versions.version_id = ?
            """,
            (project_id, artifact_type, version_id),
        ).fetchone()
        if row is None:
            raise ArtifactConflictError("Artifact version was not found")
        return ArtifactVersionPayloadMetrics(
            content_json_bytes=int(row["content_json_bytes"]),
            source_span_count=int(row["source_span_count"]),
            source_span_claim_bytes=int(row["source_span_claim_bytes"]),
        )

    def _get_artifact_version_in_connection(
        self,
        connection: sqlite3.Connection,
        *,
        project_id: str,
        artifact_type: str,
        version_id: str,
    ) -> ArtifactVersionRecord:
        version_row = connection.execute(
            """
            SELECT artifact_versions.*
            FROM artifact_versions
            JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
            WHERE artifacts.project_id = ? AND artifacts.artifact_type = ?
                AND artifact_versions.version_id = ?
            """,
            (project_id, artifact_type, version_id),
        ).fetchone()
        if version_row is None:
            raise ArtifactConflictError("Artifact version was not found")
        artifact_id = str(version_row["artifact_id"])
        head_row = connection.execute(
            "SELECT * FROM artifact_heads WHERE artifact_id = ?", (artifact_id,)
        ).fetchone()
        span_rows = connection.execute(
            """
            SELECT * FROM artifact_source_spans
            WHERE version_id = ? ORDER BY fact_id, start_byte, span_id
            """,
            (version_id,),
        ).fetchall()
        dependency_rows = connection.execute(
            """
            SELECT * FROM artifact_dependencies
            WHERE downstream_version_id = ? ORDER BY dependency_id
            """,
            (version_id,),
        ).fetchall()
        if head_row is None:
            raise RuntimeError("Artifact head is missing")
        return ArtifactVersionRecord(
            version=self._artifact_version_from_row(version_row),
            head=self._artifact_head_from_row(head_row),
            source_spans=tuple(self._artifact_source_span_from_row(row) for row in span_rows),
            dependencies=tuple(self._artifact_dependency_from_row(row) for row in dependency_rows),
        )

    def get_latest_artifact(self, project_id: str, artifact_type: str) -> ArtifactVersionRecord:
        with self._connection() as connection:
            connection.execute("BEGIN")
            row = connection.execute(
                """
                SELECT artifact_heads.latest_version_id
                FROM artifact_heads
                JOIN artifacts ON artifacts.artifact_id = artifact_heads.artifact_id
                WHERE artifacts.project_id = ? AND artifacts.artifact_type = ?
                """,
                (project_id, artifact_type),
            ).fetchone()
            if row is None:
                connection.rollback()
                self.get_project(project_id)
                raise ArtifactNotFoundError(artifact_type)
            self._transaction_step("get_latest_artifact", "head_selected")
            record = self._get_artifact_version_in_connection(
                connection,
                project_id=project_id,
                artifact_type=artifact_type,
                version_id=str(row["latest_version_id"]),
            )
            connection.commit()
        return record

    def get_artifact_role_index(self, project_id: str, artifact_type: str) -> ArtifactRoleIndex:
        """Read role pointers and their lightweight immutable metadata in one snapshot."""
        with self._connection() as connection:
            connection.execute("BEGIN")
            head_row = connection.execute(
                """
                SELECT artifact_heads.*
                FROM artifact_heads
                JOIN artifacts ON artifacts.artifact_id = artifact_heads.artifact_id
                WHERE artifacts.project_id = ? AND artifacts.artifact_type = ?
                """,
                (project_id, artifact_type),
            ).fetchone()
            if head_row is None:
                connection.rollback()
                self.get_project(project_id)
                raise ArtifactNotFoundError(artifact_type)
            head = self._artifact_head_from_row(head_row)
            self._transaction_step("get_artifact_role_index", "head_selected")
            version_ids = tuple(
                dict.fromkeys(
                    version_id
                    for version_id in (
                        head.latest_version_id,
                        head.review_version_id,
                        head.accepted_version_id,
                    )
                    if version_id is not None
                )
            )
            placeholders = ", ".join("?" for _ in version_ids)
            rows = connection.execute(
                f"""
                SELECT version_id, artifact_id, version_number, schema_version, content_hash,
                       parent_version_id, change_summary, created_at
                FROM artifact_versions
                WHERE artifact_id = ? AND version_id IN ({placeholders})
                """,
                (head.artifact_id, *version_ids),
            ).fetchall()
            summaries = {
                str(row["version_id"]): self._artifact_version_summary_from_row(row) for row in rows
            }
            if summaries.keys() != set(version_ids):
                raise ArtifactConflictError("Artifact role version is missing")
            connection.commit()
        return ArtifactRoleIndex(
            head=head,
            versions=tuple(summaries[version_id] for version_id in version_ids),
        )

    def prepare_review_action(
        self,
        *,
        project_id: str,
        artifact_type: str,
        version_id: str,
        action: ReviewAction,
        action_payload: dict[str, object],
        actor: TrustedReviewActor,
        expected_revision: int,
        readiness_report_id: str | None = None,
    ) -> PreparedReviewAction:
        """Freeze review evidence and issue a short-lived native confirmation challenge."""

        policy = self._gate_policy(artifact_type)
        now = self._clock()
        expires_at = now + timedelta(minutes=5)
        self._authorize_review_action(policy, action, action_payload, actor)
        bound_payload = self._bound_action_payload(action_payload, actor, policy)

        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                version_row, head_row = self._review_context(
                    connection,
                    project_id=project_id,
                    artifact_type=artifact_type,
                    version_id=version_id,
                )
                if int(head_row["revision"]) != expected_revision:
                    raise ArtifactConflictError("Artifact head revision has changed")
                if (
                    action in ("signoff", "decision")
                    and not policy.allow_self_review
                    and str(version_row["author_actor_id"]) == actor.subject_id
                ):
                    raise ReviewInvalidError("This Gate policy forbids self-review")
                if action == "submit":
                    if str(head_row["latest_version_id"]) != version_id:
                        raise ReviewInvalidError("Only the latest draft can be submitted")
                    duplicate = connection.execute(
                        "SELECT 1 FROM review_submissions WHERE version_id = ? AND gate = ?",
                        (version_id, policy.gate),
                    ).fetchone()
                    if duplicate is not None:
                        raise ReviewInvalidError("This version has already been submitted")
                elif (
                    str(head_row["review_version_id"] or "") != version_id
                    or head_row["review_submission_id"] is None
                ):
                    raise ReviewInvalidError("Review action requires the current open submission")

                if readiness_report_id is None:
                    content = cast(dict[str, object], json.loads(str(version_row["content_json"])))
                    readiness_report = policy.evaluate(content)
                    if readiness_report.get("ready") is not True:
                        raise GateNotReadyError("Gate readiness has blocking checks")
                    report = GateReadinessReport(
                        id=self._id_factory("rpt"),
                        artifact_id=str(version_row["artifact_id"]),
                        version_id=version_id,
                        gate=policy.gate,
                        submission_id=(
                            str(head_row["review_submission_id"])
                            if action != "submit" and head_row["review_submission_id"] is not None
                            else None
                        ),
                        policy_code=policy.policy_code,
                        policy_version=policy.policy_version,
                        head_revision=expected_revision,
                        review_evidence_revision=int(head_row["review_evidence_revision"]),
                        report=readiness_report,
                        report_hash=canonical_content_hash(readiness_report),
                        expires_at=expires_at,
                        created_at=now,
                    )
                    connection.execute(
                        """
                        INSERT INTO gate_readiness_reports VALUES (
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                        )
                        """,
                        (
                            report.id,
                            report.artifact_id,
                            report.version_id,
                            report.gate,
                            report.submission_id,
                            report.policy_code,
                            report.policy_version,
                            report.head_revision,
                            report.review_evidence_revision,
                            canonical_content_bytes(report.report).decode("utf-8"),
                            report.report_hash,
                            _timestamp(report.expires_at),
                            _timestamp(report.created_at),
                        ),
                    )
                else:
                    report_row = connection.execute(
                        "SELECT * FROM gate_readiness_reports WHERE report_id = ?",
                        (readiness_report_id,),
                    ).fetchone()
                    if report_row is None:
                        raise ReviewInvalidError("Readiness report was not found")
                    report = self._readiness_report_from_row(report_row)
                    if (
                        report.version_id != version_id
                        or report.gate != policy.gate
                        or report.policy_code != policy.policy_code
                        or report.policy_version != policy.policy_version
                        or report.report.get("policy_snapshot_hash") != policy.snapshot_hash
                        or report.review_evidence_revision
                        != int(head_row["review_evidence_revision"])
                        or report.expires_at <= now
                        or report.report.get("ready") is not True
                        or report.submission_id != str(head_row["review_submission_id"])
                    ):
                        raise ReviewInvalidError("Readiness report does not match review evidence")

                challenge_id = self._id_factory("chg")
                confirmation_token = self._challenge_token_factory()
                challenge = ConfirmationChallenge(
                    id=challenge_id,
                    artifact_id=str(version_row["artifact_id"]),
                    version_id=version_id,
                    gate=policy.gate,
                    action=action,
                    action_payload_hash=canonical_content_hash(bound_payload),
                    policy_snapshot_hash=policy.snapshot_hash,
                    actor_id=actor.subject_id,
                    actor_roles=actor.roles,
                    readiness_report_id=report.id,
                    head_revision=expected_revision,
                    review_evidence_revision=int(head_row["review_evidence_revision"]),
                    expires_at=expires_at,
                    consumed_at=None,
                    created_at=now,
                )
                connection.execute(
                    """
                    INSERT INTO confirmation_challenges (
                        challenge_id, artifact_id, version_id, gate, action,
                        action_payload_hash, policy_snapshot_hash, actor_id,
                        actor_roles_json, readiness_report_id, challenge_hash,
                        head_revision, review_evidence_revision, expires_at,
                        consumed_at, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                    """,
                    (
                        challenge.id,
                        challenge.artifact_id,
                        challenge.version_id,
                        challenge.gate,
                        challenge.action,
                        challenge.action_payload_hash,
                        challenge.policy_snapshot_hash,
                        challenge.actor_id,
                        canonical_content_bytes(list(challenge.actor_roles)).decode("utf-8"),
                        challenge.readiness_report_id,
                        self._confirmation_hash(challenge.id, confirmation_token),
                        challenge.head_revision,
                        challenge.review_evidence_revision,
                        _timestamp(challenge.expires_at),
                        _timestamp(challenge.created_at),
                    ),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return PreparedReviewAction(
            report=report,
            challenge=challenge,
            confirmation_token=confirmation_token,
        )

    def submit_artifact_review(
        self,
        *,
        project_id: str,
        artifact_type: str,
        version_id: str,
        expected_revision: int,
        challenge_id: str,
        confirmation_token: str,
        actor: TrustedReviewActor,
    ) -> ReviewSubmissionResult:
        policy = self._gate_policy(artifact_type)
        self._authorize_review_action(policy, "submit", {}, actor)
        now = self._clock()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                version_row, head_row = self._review_context(
                    connection,
                    project_id=project_id,
                    artifact_type=artifact_type,
                    version_id=version_id,
                )
                report = self._consume_challenge(
                    connection,
                    challenge_id=challenge_id,
                    confirmation_token=confirmation_token,
                    expected_action="submit",
                    action_payload={},
                    actor=actor,
                    policy=policy,
                    version_id=version_id,
                    gate=policy.gate,
                    expected_revision=expected_revision,
                    expected_evidence_revision=int(head_row["review_evidence_revision"]),
                    consumed_at=now,
                )
                self._transaction_step("submit_review", "challenge_consumed")
                previous_submission_id = (
                    str(head_row["review_submission_id"])
                    if head_row["review_submission_id"] is not None
                    else None
                )
                submission = ReviewSubmission(
                    id=self._id_factory("sub"),
                    artifact_id=str(version_row["artifact_id"]),
                    version_id=version_id,
                    gate=policy.gate,
                    readiness_report_id=report.id,
                    supersedes_submission_id=previous_submission_id,
                    submitted_by_actor_id=actor.subject_id,
                    submitted_at=now,
                )
                connection.execute(
                    "INSERT INTO review_submissions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        submission.id,
                        submission.artifact_id,
                        submission.version_id,
                        submission.gate,
                        submission.readiness_report_id,
                        submission.supersedes_submission_id,
                        submission.submitted_by_actor_id,
                        _timestamp(submission.submitted_at),
                    ),
                )
                self._transaction_step("submit_review", "submission_inserted")
                updated = connection.execute(
                    """
                    UPDATE artifact_heads
                    SET review_version_id = ?, review_submission_id = ?,
                        revision = revision + 1,
                        review_evidence_revision = review_evidence_revision + 1,
                        updated_at = ?
                    WHERE artifact_id = ? AND revision = ?
                    """,
                    (
                        version_id,
                        submission.id,
                        _timestamp(now),
                        submission.artifact_id,
                        expected_revision,
                    ),
                )
                if updated.rowcount != 1:
                    raise ArtifactConflictError("Artifact head revision has changed")
                self._transaction_step("submit_review", "head_updated")
                result_head = self._load_artifact_head(connection, submission.artifact_id)
                connection.commit()
            except sqlite3.IntegrityError as error:
                connection.rollback()
                raise ReviewInvalidError("Review submission violated an invariant") from error
            except Exception:
                connection.rollback()
                raise
        return ReviewSubmissionResult(submission=submission, head=result_head)

    def signoff_artifact_review(
        self,
        *,
        project_id: str,
        artifact_type: str,
        version_id: str,
        roles: tuple[str, ...],
        expected_revision: int,
        challenge_id: str,
        confirmation_token: str,
        actor: TrustedReviewActor,
    ) -> ReviewSignoffResult:
        policy = self._gate_policy(artifact_type)
        now = self._clock()
        payload: dict[str, object] = {"roles": list(roles)}
        self._authorize_review_action(policy, "signoff", payload, actor)
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                version_row, head_row = self._review_context(
                    connection,
                    project_id=project_id,
                    artifact_type=artifact_type,
                    version_id=version_id,
                )
                submission_id = self._require_open_review(head_row, version_id)
                report = self._consume_challenge(
                    connection,
                    challenge_id=challenge_id,
                    confirmation_token=confirmation_token,
                    expected_action="signoff",
                    action_payload=payload,
                    actor=actor,
                    policy=policy,
                    version_id=version_id,
                    gate=policy.gate,
                    expected_revision=expected_revision,
                    expected_evidence_revision=int(head_row["review_evidence_revision"]),
                    consumed_at=now,
                )
                self._transaction_step("signoff_review", "challenge_consumed")
                self_review = str(version_row["author_actor_id"]) == actor.subject_id
                signoffs: list[RoleSignoff] = []
                for role in roles:
                    previous = connection.execute(
                        """
                        SELECT signoff_id FROM role_signoffs
                        WHERE version_id = ? AND gate = ? AND role = ?
                        ORDER BY review_evidence_revision DESC, signed_at DESC LIMIT 1
                        """,
                        (version_id, policy.gate, role),
                    ).fetchone()
                    signoff = RoleSignoff(
                        id=self._id_factory("sig"),
                        artifact_id=str(version_row["artifact_id"]),
                        version_id=version_id,
                        submission_id=submission_id,
                        gate=policy.gate,
                        role=role,
                        actor_id=actor.subject_id,
                        review_evidence_revision=int(head_row["review_evidence_revision"]),
                        readiness_report_id=report.id,
                        self_review=self_review,
                        supersedes_signoff_id=(
                            str(previous["signoff_id"]) if previous is not None else None
                        ),
                        signed_at=now,
                    )
                    connection.execute(
                        """
                        INSERT INTO role_signoffs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            signoff.id,
                            signoff.artifact_id,
                            signoff.version_id,
                            signoff.submission_id,
                            signoff.gate,
                            signoff.role,
                            signoff.actor_id,
                            signoff.review_evidence_revision,
                            signoff.readiness_report_id,
                            int(signoff.self_review),
                            signoff.supersedes_signoff_id,
                            _timestamp(signoff.signed_at),
                        ),
                    )
                    self._transaction_step("signoff_review", f"signoff_{len(signoffs) + 1}")
                    signoffs.append(signoff)
                self._advance_head_revision(
                    connection,
                    artifact_id=str(version_row["artifact_id"]),
                    expected_revision=expected_revision,
                    updated_at=now,
                )
                self._transaction_step("signoff_review", "head_updated")
                result_head = self._load_artifact_head(connection, str(version_row["artifact_id"]))
                connection.commit()
            except sqlite3.IntegrityError as error:
                connection.rollback()
                raise ReviewInvalidError("Role signoff violated an invariant") from error
            except Exception:
                connection.rollback()
                raise
        return ReviewSignoffResult(signoffs=tuple(signoffs), head=result_head)

    def decide_artifact_gate(
        self,
        *,
        project_id: str,
        artifact_type: str,
        version_id: str,
        decision: GateDecisionValue,
        rationale: str,
        expected_revision: int,
        challenge_id: str,
        confirmation_token: str,
        actor: TrustedReviewActor,
        actor_role: str,
    ) -> GateDecisionResult:
        policy = self._gate_policy(artifact_type)
        now = self._clock()
        payload: dict[str, object] = {
            "decision": decision,
            "rationale": rationale,
            "actor_role": actor_role,
        }
        self._authorize_review_action(policy, "decision", payload, actor)
        if decision == "approved_with_waiver":
            raise ReviewInvalidError(
                "Waiver approval is disabled until waiver review is implemented"
            )
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                version_row, head_row = self._review_context(
                    connection,
                    project_id=project_id,
                    artifact_type=artifact_type,
                    version_id=version_id,
                )
                submission_id = self._require_open_review(head_row, version_id)
                report = self._consume_challenge(
                    connection,
                    challenge_id=challenge_id,
                    confirmation_token=confirmation_token,
                    expected_action="decision",
                    action_payload=payload,
                    actor=actor,
                    policy=policy,
                    version_id=version_id,
                    gate=policy.gate,
                    expected_revision=expected_revision,
                    expected_evidence_revision=int(head_row["review_evidence_revision"]),
                    consumed_at=now,
                )
                self._transaction_step("decide_gate", "challenge_consumed")
                if decision != "rejected":
                    signed_roles = {
                        str(row["role"])
                        for row in connection.execute(
                            """
                            SELECT role FROM role_signoffs
                            WHERE version_id = ? AND gate = ?
                                AND review_evidence_revision = ?
                                AND readiness_report_id = ?
                            """,
                            (
                                version_id,
                                policy.gate,
                                int(head_row["review_evidence_revision"]),
                                report.id,
                            ),
                        ).fetchall()
                    }
                    if not set(policy.required_roles) <= signed_roles:
                        raise ReviewInvalidError("Required role signoffs are incomplete")
                    if self._has_open_blocking_findings(connection, submission_id):
                        raise ReviewInvalidError("Blocking review findings remain open")
                gate_decision = GateDecision(
                    id=self._id_factory("dec"),
                    artifact_id=str(version_row["artifact_id"]),
                    version_id=version_id,
                    submission_id=submission_id,
                    gate=policy.gate,
                    decision=decision,
                    readiness_report_id=report.id,
                    confirmation_challenge_id=challenge_id,
                    head_revision=expected_revision,
                    actor_id=actor.subject_id,
                    actor_role=actor_role,
                    self_review=str(version_row["author_actor_id"]) == actor.subject_id,
                    rationale=rationale,
                    decided_at=now,
                )
                connection.execute(
                    """
                    INSERT INTO gate_decisions (
                        decision_id, artifact_id, version_id, submission_id, gate,
                        decision, readiness_report_id, actor_id, actor_role,
                        self_review, rationale, decided_at,
                        confirmation_challenge_id, head_revision
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        gate_decision.id,
                        gate_decision.artifact_id,
                        gate_decision.version_id,
                        gate_decision.submission_id,
                        gate_decision.gate,
                        gate_decision.decision,
                        gate_decision.readiness_report_id,
                        gate_decision.actor_id,
                        gate_decision.actor_role,
                        int(gate_decision.self_review),
                        gate_decision.rationale,
                        _timestamp(gate_decision.decided_at),
                        gate_decision.confirmation_challenge_id,
                        gate_decision.head_revision,
                    ),
                )
                self._transaction_step("decide_gate", "decision_inserted")
                accepted_version_id = (
                    version_id
                    if decision in ("approved", "approved_with_waiver")
                    else head_row["accepted_version_id"]
                )
                updated = connection.execute(
                    """
                    UPDATE artifact_heads
                    SET review_version_id = NULL, review_submission_id = NULL,
                        accepted_version_id = ?, revision = revision + 1, updated_at = ?
                    WHERE artifact_id = ? AND revision = ?
                    """,
                    (
                        accepted_version_id,
                        _timestamp(now),
                        gate_decision.artifact_id,
                        expected_revision,
                    ),
                )
                if updated.rowcount != 1:
                    raise ArtifactConflictError("Artifact head revision has changed")
                self._transaction_step("decide_gate", "head_updated")
                result_head = self._load_artifact_head(connection, gate_decision.artifact_id)
                connection.commit()
            except sqlite3.IntegrityError as error:
                connection.rollback()
                raise ReviewInvalidError("Gate decision violated an invariant") from error
            except Exception:
                connection.rollback()
                raise
        return GateDecisionResult(decision=gate_decision, head=result_head)

    def _review_context(
        self,
        connection: sqlite3.Connection,
        *,
        project_id: str,
        artifact_type: str,
        version_id: str,
    ) -> tuple[sqlite3.Row, sqlite3.Row]:
        version_row = connection.execute(
            """
            SELECT artifact_versions.*
            FROM artifact_versions
            JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
            WHERE artifacts.project_id = ? AND artifacts.artifact_type = ?
                AND artifact_versions.version_id = ?
            """,
            (project_id, artifact_type, version_id),
        ).fetchone()
        if version_row is None:
            raise ReviewInvalidError("Artifact version was not found")
        head_row = connection.execute(
            "SELECT * FROM artifact_heads WHERE artifact_id = ?",
            (str(version_row["artifact_id"]),),
        ).fetchone()
        if head_row is None:
            raise ReviewInvalidError("Artifact head was not found")
        return version_row, head_row

    def _consume_challenge(
        self,
        connection: sqlite3.Connection,
        *,
        challenge_id: str,
        confirmation_token: str,
        expected_action: ReviewAction,
        action_payload: dict[str, object],
        actor: TrustedReviewActor,
        policy: GatePolicy,
        version_id: str,
        gate: str,
        expected_revision: int,
        expected_evidence_revision: int,
        consumed_at: datetime,
    ) -> GateReadinessReport:
        row = connection.execute(
            "SELECT * FROM confirmation_challenges WHERE challenge_id = ?",
            (challenge_id,),
        ).fetchone()
        if row is None:
            raise ReviewInvalidError("Confirmation challenge was not found")
        actual_hash = self._confirmation_hash(challenge_id, confirmation_token)
        if not hmac.compare_digest(str(row["challenge_hash"]), actual_hash):
            raise ReviewInvalidError("Confirmation token is invalid")
        if (
            row["consumed_at"] is not None
            or _datetime(str(row["expires_at"])) <= consumed_at
            or str(row["version_id"]) != version_id
            or str(row["gate"]) != gate
            or str(row["action"]) != expected_action
            or str(row["action_payload_hash"])
            != canonical_content_hash(self._bound_action_payload(action_payload, actor, policy))
            or str(row["policy_snapshot_hash"]) != policy.snapshot_hash
            or str(row["actor_id"]) != actor.subject_id
            or cast(list[str], json.loads(str(row["actor_roles_json"]))) != list(actor.roles)
            or int(row["head_revision"]) != expected_revision
            or int(row["review_evidence_revision"]) != expected_evidence_revision
        ):
            raise ReviewInvalidError("Confirmation challenge no longer matches the review")
        updated = connection.execute(
            """
            UPDATE confirmation_challenges SET consumed_at = ?
            WHERE challenge_id = ? AND consumed_at IS NULL
            """,
            (_timestamp(consumed_at), challenge_id),
        )
        if updated.rowcount != 1:
            raise ReviewInvalidError("Confirmation challenge was already consumed")
        report_row = connection.execute(
            "SELECT * FROM gate_readiness_reports WHERE report_id = ?",
            (str(row["readiness_report_id"]),),
        ).fetchone()
        if report_row is None:
            raise ReviewInvalidError("Readiness report was not found")
        report = self._readiness_report_from_row(report_row)
        if (
            report.version_id != version_id
            or report.gate != gate
            or report.review_evidence_revision != expected_evidence_revision
            or report.expires_at <= consumed_at
            or report.policy_code != policy.policy_code
            or report.policy_version != policy.policy_version
            or report.report.get("policy_snapshot_hash") != policy.snapshot_hash
            or report.report.get("ready") is not True
        ):
            raise ReviewInvalidError("Readiness report no longer matches the review")
        return report

    def _transaction_step(self, operation: str, step: str) -> None:
        if self._transaction_hook is not None:
            self._transaction_hook(operation, step)

    def _gate_policy(self, artifact_type: str) -> GatePolicy:
        policy = self._gate_policies.get(artifact_type)
        if policy is None or policy.artifact_type != artifact_type:
            raise ReviewInvalidError("Artifact type does not have a registered Gate policy")
        return policy

    @staticmethod
    def _authorize_review_action(
        policy: GatePolicy,
        action: ReviewAction,
        action_payload: dict[str, object],
        actor: TrustedReviewActor,
    ) -> None:
        actor_roles = set(actor.roles)
        if not actor.subject_id or not actor.roles or len(actor_roles) != len(actor.roles):
            raise ReviewInvalidError("Trusted review actor is invalid")
        if action == "submit":
            if not actor_roles.intersection(policy.submit_roles):
                raise ReviewInvalidError("Actor cannot submit this Gate")
            return
        if action == "signoff":
            roles = action_payload.get("roles")
            if (
                not isinstance(roles, list)
                or not roles
                or not all(isinstance(role, str) for role in roles)
            ):
                raise ReviewInvalidError("Signoff requires explicit roles")
            selected_roles = cast(list[str], roles)
            if len(set(selected_roles)) != len(selected_roles):
                raise ReviewInvalidError("Signoff roles must be unique")
            if not set(selected_roles) <= actor_roles.intersection(policy.required_roles):
                raise ReviewInvalidError("Actor is not authorized for selected signoff roles")
            if len(selected_roles) > 1 and not policy.allow_multi_role_signoff:
                raise ReviewInvalidError("Gate policy forbids multi-role signoff")
            return
        decision = action_payload.get("decision")
        rationale = action_payload.get("rationale")
        actor_role = action_payload.get("actor_role")
        if (
            decision not in ("approved", "approved_with_waiver", "rejected")
            or not isinstance(rationale, str)
            or not rationale.strip()
            or not isinstance(actor_role, str)
            or actor_role not in actor_roles.intersection(policy.decision_roles)
        ):
            raise ReviewInvalidError("Actor cannot make this Gate decision")

    @staticmethod
    def _bound_action_payload(
        action_payload: dict[str, object],
        actor: TrustedReviewActor,
        policy: GatePolicy,
    ) -> dict[str, object]:
        return {
            **action_payload,
            "_actor_id": actor.subject_id,
            "_actor_roles": list(actor.roles),
            "_policy_snapshot_hash": policy.snapshot_hash,
        }

    @staticmethod
    def _has_open_blocking_findings(connection: sqlite3.Connection, submission_id: str) -> bool:
        row = connection.execute(
            """
            SELECT 1
            FROM review_findings AS finding
            WHERE finding.submission_id = ? AND finding.severity = 'blocking'
              AND COALESCE(
                (
                    SELECT event.event_type
                    FROM review_finding_events AS event
                    WHERE event.finding_id = finding.finding_id
                    ORDER BY event.sequence DESC LIMIT 1
                ),
                'open'
              ) <> 'resolved'
            LIMIT 1
            """,
            (submission_id,),
        ).fetchone()
        return row is not None

    @staticmethod
    def _confirmation_hash(challenge_id: str, confirmation_token: str) -> str:
        value = f"{challenge_id}:{confirmation_token}".encode()
        return f"sha256:{hashlib.sha256(value).hexdigest()}"

    @staticmethod
    def _require_open_review(head_row: sqlite3.Row, version_id: str) -> str:
        if (
            str(head_row["review_version_id"] or "") != version_id
            or head_row["review_submission_id"] is None
        ):
            raise ReviewInvalidError("Review action requires the current open submission")
        return str(head_row["review_submission_id"])

    @staticmethod
    def _advance_head_revision(
        connection: sqlite3.Connection,
        *,
        artifact_id: str,
        expected_revision: int,
        updated_at: datetime,
    ) -> None:
        updated = connection.execute(
            """
            UPDATE artifact_heads SET revision = revision + 1, updated_at = ?
            WHERE artifact_id = ? AND revision = ?
            """,
            (_timestamp(updated_at), artifact_id, expected_revision),
        )
        if updated.rowcount != 1:
            raise ArtifactConflictError("Artifact head revision has changed")

    def _load_artifact_head(self, connection: sqlite3.Connection, artifact_id: str) -> ArtifactHead:
        row = connection.execute(
            "SELECT * FROM artifact_heads WHERE artifact_id = ?", (artifact_id,)
        ).fetchone()
        if row is None:
            raise RuntimeError("Artifact head is missing")
        return self._artifact_head_from_row(row)

    @staticmethod
    def _readiness_report_from_row(row: sqlite3.Row) -> GateReadinessReport:
        report_content = cast(dict[str, object], json.loads(str(row["report_json"])))
        if canonical_content_hash(report_content) != str(row["report_hash"]):
            raise ReviewInvalidError("Readiness report hash does not match its content")
        return GateReadinessReport(
            id=str(row["report_id"]),
            artifact_id=str(row["artifact_id"]),
            version_id=str(row["version_id"]),
            gate=str(row["gate"]),
            submission_id=(str(row["submission_id"]) if row["submission_id"] is not None else None),
            policy_code=str(row["policy_code"]),
            policy_version=str(row["policy_version"]),
            head_revision=int(row["head_revision"]),
            review_evidence_revision=int(row["review_evidence_revision"]),
            report=report_content,
            report_hash=str(row["report_hash"]),
            expires_at=_datetime(str(row["expires_at"])),
            created_at=_datetime(str(row["created_at"])),
        )

    def _insert_source_span(
        self,
        connection: sqlite3.Connection,
        *,
        project_id: str,
        artifact_id: str,
        version_id: str,
        draft: ArtifactSourceSpanDraft,
        created_at: datetime,
    ) -> ArtifactSourceSpan:
        source_row = connection.execute(
            """
            SELECT source_documents.normalized_text,
                source_blocks.normalized_start_byte, source_blocks.normalized_end_byte
            FROM source_documents
            JOIN source_blocks ON source_blocks.source_document_id = source_documents.id
            WHERE source_documents.project_id = ? AND source_documents.id = ?
                AND source_blocks.project_id = ? AND source_blocks.id = ?
            """,
            (
                project_id,
                draft.source_document_id,
                project_id,
                draft.source_block_id,
            ),
        ).fetchone()
        if source_row is None:
            raise SourceSpanInvalidError("Source span does not belong to the project")
        block_start = int(source_row["normalized_start_byte"])
        block_end = int(source_row["normalized_end_byte"])
        if not (block_start <= draft.start_byte < draft.end_byte <= block_end):
            raise SourceSpanInvalidError("Source span falls outside its source block")
        normalized_bytes = str(source_row["normalized_text"]).encode("utf-8")
        quote_bytes = normalized_bytes[draft.start_byte : draft.end_byte]
        try:
            quote_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise SourceSpanInvalidError(
                "Source span is not aligned to UTF-8 boundaries"
            ) from error
        quote_hash = f"sha256:{hashlib.sha256(quote_bytes).hexdigest()}"
        span = ArtifactSourceSpan(
            id=self._id_factory("spn"),
            artifact_id=artifact_id,
            version_id=version_id,
            fact_id=draft.fact_id,
            project_id=project_id,
            source_document_id=draft.source_document_id,
            source_block_id=draft.source_block_id,
            role=draft.role,
            start_byte=draft.start_byte,
            end_byte=draft.end_byte,
            claim=draft.claim,
            quote_hash=quote_hash,
            created_at=created_at,
        )
        connection.execute(
            """
            INSERT INTO artifact_source_spans VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                span.id,
                span.artifact_id,
                span.version_id,
                span.fact_id,
                span.project_id,
                span.source_document_id,
                span.source_block_id,
                span.role,
                span.start_byte,
                span.end_byte,
                span.claim,
                span.quote_hash,
                _timestamp(span.created_at),
            ),
        )
        return span

    def _insert_dependency(
        self,
        connection: sqlite3.Connection,
        *,
        project_id: str,
        downstream_artifact_id: str,
        downstream_version_id: str,
        draft: ArtifactDependencyDraft,
        created_at: datetime,
    ) -> ArtifactDependency:
        upstream = connection.execute(
            """
            SELECT artifact_versions.artifact_id
            FROM artifact_versions
            JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
            WHERE artifact_versions.version_id = ? AND artifacts.project_id = ?
            """,
            (draft.upstream_version_id, project_id),
        ).fetchone()
        if upstream is None:
            raise ArtifactConflictError("Dependency version does not belong to the project")
        dependency = ArtifactDependency(
            id=self._id_factory("dep"),
            downstream_artifact_id=downstream_artifact_id,
            downstream_version_id=downstream_version_id,
            upstream_artifact_id=str(upstream["artifact_id"]),
            upstream_version_id=draft.upstream_version_id,
            relationship=draft.relationship,
            impact=draft.impact,
            created_at=created_at,
        )
        connection.execute(
            """
            INSERT INTO artifact_dependencies VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dependency.id,
                dependency.downstream_artifact_id,
                dependency.downstream_version_id,
                dependency.upstream_artifact_id,
                dependency.upstream_version_id,
                dependency.relationship,
                dependency.impact,
                _timestamp(dependency.created_at),
            ),
        )
        return dependency

    @staticmethod
    def _artifact_version_from_row(row: sqlite3.Row) -> ArtifactVersion:
        content = cast(dict[str, object], json.loads(str(row["content_json"])))
        if canonical_content_hash(content) != str(row["content_hash"]):
            raise ArtifactConflictError("Artifact content hash does not match its content")
        return ArtifactVersion(
            id=str(row["version_id"]),
            artifact_id=str(row["artifact_id"]),
            version_number=int(row["version_number"]),
            schema_version=str(row["schema_version"]),
            content=content,
            content_hash=str(row["content_hash"]),
            author_actor_type=cast(ArtifactActorType, row["author_actor_type"]),
            author_actor_id=str(row["author_actor_id"]),
            parent_version_id=(
                str(row["parent_version_id"]) if row["parent_version_id"] is not None else None
            ),
            change_summary=str(row["change_summary"]),
            created_at=_datetime(str(row["created_at"])),
        )

    @staticmethod
    def _artifact_version_summary_from_row(row: sqlite3.Row) -> ArtifactVersionSummary:
        return ArtifactVersionSummary(
            id=str(row["version_id"]),
            artifact_id=str(row["artifact_id"]),
            version_number=int(row["version_number"]),
            schema_version=str(row["schema_version"]),
            content_hash=str(row["content_hash"]),
            parent_version_id=(
                str(row["parent_version_id"]) if row["parent_version_id"] is not None else None
            ),
            change_summary=str(row["change_summary"]),
            created_at=_datetime(str(row["created_at"])),
        )

    @staticmethod
    def _artifact_head_from_row(row: sqlite3.Row) -> ArtifactHead:
        return ArtifactHead(
            artifact_id=str(row["artifact_id"]),
            latest_version_id=str(row["latest_version_id"]),
            review_version_id=(
                str(row["review_version_id"]) if row["review_version_id"] is not None else None
            ),
            review_submission_id=(
                str(row["review_submission_id"])
                if row["review_submission_id"] is not None
                else None
            ),
            accepted_version_id=(
                str(row["accepted_version_id"]) if row["accepted_version_id"] is not None else None
            ),
            revision=int(row["revision"]),
            review_evidence_revision=int(row["review_evidence_revision"]),
            updated_at=_datetime(str(row["updated_at"])),
        )

    @staticmethod
    def _artifact_source_span_from_row(row: sqlite3.Row) -> ArtifactSourceSpan:
        return ArtifactSourceSpan(
            id=str(row["span_id"]),
            artifact_id=str(row["artifact_id"]),
            version_id=str(row["version_id"]),
            fact_id=str(row["fact_id"]),
            project_id=str(row["project_id"]),
            source_document_id=str(row["source_document_id"]),
            source_block_id=str(row["source_block_id"]),
            role=cast(SourceSpanRole, row["role"]),
            start_byte=int(row["start_byte"]),
            end_byte=int(row["end_byte"]),
            claim=str(row["claim"]),
            quote_hash=str(row["quote_hash"]),
            created_at=_datetime(str(row["created_at"])),
        )

    @staticmethod
    def _artifact_dependency_from_row(row: sqlite3.Row) -> ArtifactDependency:
        return ArtifactDependency(
            id=str(row["dependency_id"]),
            downstream_artifact_id=str(row["downstream_artifact_id"]),
            downstream_version_id=str(row["downstream_version_id"]),
            upstream_artifact_id=str(row["upstream_artifact_id"]),
            upstream_version_id=str(row["upstream_version_id"]),
            relationship=str(row["relationship"]),
            impact=cast(DependencyImpact, row["impact"]),
            created_at=_datetime(str(row["created_at"])),
        )

    @staticmethod
    def _project_from_row(row: sqlite3.Row) -> Project:
        return Project(
            id=str(row["id"]),
            name=str(row["name"]),
            aspect_ratio=str(row["aspect_ratio"]),
            target_duration_seconds=int(row["target_duration_seconds"]),
            source_language=str(row["source_language"]),
            status=cast(ProjectStatus, row["status"]),
            revision=int(row["revision"]),
            created_at=_datetime(str(row["created_at"])),
            updated_at=_datetime(str(row["updated_at"])),
        )

    @staticmethod
    def _source_summary_from_row(row: sqlite3.Row) -> SourceDocumentSummary:
        return SourceDocumentSummary(
            id=str(row["id"]),
            project_id=str(row["project_id"]),
            filename=str(row["filename"]),
            media_type=str(row["media_type"]),
            encoding=str(row["encoding"]),
            byte_size=int(row["byte_size"]),
            raw_sha256=str(row["raw_sha256"]),
            imported_at=_datetime(str(row["imported_at"])),
            chapter_count=int(row["chapter_count"]),
            block_count=int(row["block_count"]),
        )

    @staticmethod
    def _source_block_from_row(row: sqlite3.Row) -> SourceBlock:
        return SourceBlock(
            id=str(row["id"]),
            source_document_id=str(row["source_document_id"]),
            project_id=str(row["project_id"]),
            ordinal=int(row["ordinal"]),
            kind=cast(SourceBlockKind, row["kind"]),
            chapter_index=int(row["chapter_index"]),
            text=str(row["text"]),
            normalized_start_byte=int(row["normalized_start_byte"]),
            normalized_end_byte=int(row["normalized_end_byte"]),
            content_sha256=str(row["content_sha256"]),
        )
