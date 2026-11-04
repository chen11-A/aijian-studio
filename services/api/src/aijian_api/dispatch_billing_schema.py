"""Migration 49: billing class recorded on each dispatch.

Subscription login calls and metered calls share this label so a later ledger or
UI can tell them apart. The zero-budget text authorization snapshot is unchanged.
"""

DISPATCH_BILLING_MIGRATION = (
    """
    CREATE TABLE dispatch_billing_records (
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
        created_at TEXT NOT NULL,
        CHECK (attempt_id IS NOT NULL OR reservation_id IS NOT NULL)
    )
    """,
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
)
