"""Migration 50: desktop subscription dispatches.

The access token stays in the desktop secure store. This table records that a
Grok or ChatGPT login dispatch happened, and anchors one immutable billing row.
It never has a column for a token, a prompt, or a provider response body.
"""

DESKTOP_SUBSCRIPTION_MIGRATION = (
    """
    CREATE TABLE desktop_subscription_dispatches (
        dispatch_id TEXT PRIMARY KEY CHECK (
            length(dispatch_id) = 36 AND dispatch_id GLOB 'dsd_[0-9a-f]*'
        ),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        account_kind TEXT NOT NULL CHECK (account_kind IN ('gpt_login', 'grok_login')),
        model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
        request_sha256 TEXT NOT NULL CHECK (
            length(request_sha256) = 71 AND request_sha256 LIKE 'sha256:%'
        ),
        idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 80),
        outcome TEXT NOT NULL CHECK (outcome IN ('RECORDED', 'COMPLETED', 'FAILED')),
        failure_code TEXT CHECK (
            failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 64
        ),
        created_at TEXT NOT NULL,
        UNIQUE (project_id, idempotency_key)
    )
    """,
    """
    CREATE TABLE dispatch_billing_records_v50 (
        record_id TEXT PRIMARY KEY CHECK (
            length(record_id) = 36 AND record_id GLOB 'dbr_[0-9a-f]*'
        ),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        billing_class TEXT NOT NULL CHECK (
            billing_class IN ('subscription', 'metered')
        ),
        account_kind TEXT CHECK (
            account_kind IS NULL OR length(account_kind) BETWEEN 1 AND 64
        ),
        classification_source TEXT NOT NULL CHECK (
            classification_source IN (
                'explicit',
                'account_kind',
                'transport_mapping',
                'unknown_as_metered',
                'conflict_as_metered'
            )
        ),
        attempt_id TEXT UNIQUE
            REFERENCES workflow_attempts(attempt_id) ON DELETE CASCADE,
        reservation_id TEXT UNIQUE
            REFERENCES media_budget_reservations(reservation_id) ON DELETE CASCADE,
        desktop_dispatch_id TEXT UNIQUE
            REFERENCES desktop_subscription_dispatches(dispatch_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        CHECK (
            (
                desktop_dispatch_id IS NOT NULL
                AND attempt_id IS NULL
                AND reservation_id IS NULL
            )
            OR (
                desktop_dispatch_id IS NULL
                AND (attempt_id IS NOT NULL OR reservation_id IS NOT NULL)
            )
        )
    )
    """,
    """
    INSERT INTO dispatch_billing_records_v50 (
        record_id, project_id, billing_class, account_kind, classification_source,
        attempt_id, reservation_id, desktop_dispatch_id, created_at
    )
    SELECT
        record_id, project_id, billing_class, account_kind, classification_source,
        attempt_id, reservation_id, NULL, created_at
    FROM dispatch_billing_records
    """,
    "DROP TABLE dispatch_billing_records",
    "ALTER TABLE dispatch_billing_records_v50 RENAME TO dispatch_billing_records",
    """
    CREATE INDEX dispatch_billing_records_project
    ON dispatch_billing_records(project_id, billing_class)
    """,
    """
    CREATE TRIGGER dispatch_billing_records_no_update
    BEFORE UPDATE ON dispatch_billing_records
    BEGIN
        SELECT RAISE(ABORT, 'dispatch billing record is immutable');
    END
    """,
    """
    CREATE TRIGGER desktop_subscription_dispatches_outcome_only
    BEFORE UPDATE ON desktop_subscription_dispatches
    BEGIN
        SELECT CASE
            WHEN OLD.dispatch_id != NEW.dispatch_id
                OR OLD.project_id != NEW.project_id
                OR OLD.account_kind != NEW.account_kind
                OR OLD.model_id != NEW.model_id
                OR OLD.request_sha256 != NEW.request_sha256
                OR OLD.idempotency_key != NEW.idempotency_key
                OR OLD.created_at != NEW.created_at
                OR OLD.outcome != 'RECORDED'
                OR NEW.outcome NOT IN ('COMPLETED', 'FAILED')
            THEN RAISE(ABORT, 'desktop subscription dispatch is immutable')
        END;
    END
    """,
)
