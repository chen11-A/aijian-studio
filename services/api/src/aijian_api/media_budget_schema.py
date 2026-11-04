"""Migration 48: local media-budget configuration and reservations.

This is the monetary hold ledger. It does not record gateway or upstream invoices,
and it does not widen the zero-budget text authorization contract.
"""

MEDIA_BUDGET_MIGRATION = (
    """
    CREATE TABLE media_budget_revisions (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (
            typeof(revision) = 'integer' AND revision >= 1
        ),
        currency TEXT NOT NULL CHECK (
            length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'
        ),
        project_limit_micro INTEGER NOT NULL CHECK (
            typeof(project_limit_micro) = 'integer'
            AND project_limit_micro >= 0
            AND project_limit_micro <= 9007199254740991
        ),
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, revision)
    )
    """,
    """
    CREATE TABLE media_budget_episode_limits (
        project_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        limit_micro INTEGER NOT NULL CHECK (
            typeof(limit_micro) = 'integer'
            AND limit_micro >= 0
            AND limit_micro <= 9007199254740991
        ),
        PRIMARY KEY (project_id, revision, episode_id),
        FOREIGN KEY (project_id, revision)
            REFERENCES media_budget_revisions(project_id, revision) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE media_budget_heads (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 1),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id, revision)
            REFERENCES media_budget_revisions(project_id, revision) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE media_budget_reservations (
        reservation_id TEXT PRIMARY KEY CHECK (
            length(reservation_id) = 36 AND reservation_id GLOB 'mbr_[0-9a-f]*'
        ),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE,
        budget_revision INTEGER NOT NULL CHECK (
            typeof(budget_revision) = 'integer' AND budget_revision >= 1
        ),
        idempotency_key TEXT NOT NULL CHECK (
            length(idempotency_key) BETWEEN 1 AND 128
        ),
        currency TEXT NOT NULL CHECK (
            length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'
        ),
        amount_known INTEGER NOT NULL CHECK (amount_known IN (0, 1)),
        amount_micro INTEGER CHECK (
            (
                amount_known = 0 AND amount_micro IS NULL
            ) OR (
                amount_known = 1
                AND typeof(amount_micro) = 'integer'
                AND amount_micro >= 0
                AND amount_micro <= 9007199254740991
            )
        ),
        status TEXT NOT NULL CHECK (
            status IN ('RESERVED', 'CANCELLED', 'SETTLED', 'UNKNOWN')
        ),
        provider_called INTEGER NOT NULL CHECK (provider_called = 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, idempotency_key),
        FOREIGN KEY (project_id, budget_revision)
            REFERENCES media_budget_revisions(project_id, revision) ON DELETE CASCADE,
        CHECK (status <> 'SETTLED' OR amount_known = 1)
    )
    """,
    """
    CREATE INDEX media_budget_reservations_project
    ON media_budget_reservations(project_id, status)
    """,
    """
    CREATE TABLE media_budget_dispatch_receipts (
        reservation_id TEXT PRIMARY KEY
            REFERENCES media_budget_reservations(reservation_id) ON DELETE CASCADE,
        transport TEXT NOT NULL CHECK (transport = 'STUB_NO_PAID_CALL'),
        provider_called INTEGER NOT NULL CHECK (provider_called = 0),
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TRIGGER media_budget_revisions_no_update
    BEFORE UPDATE ON media_budget_revisions
    BEGIN
        SELECT RAISE(ABORT, 'media budget revision is immutable');
    END
    """,
    """
    CREATE TRIGGER media_budget_episode_limits_no_update
    BEFORE UPDATE ON media_budget_episode_limits
    BEGIN
        SELECT RAISE(ABORT, 'media budget episode limit is immutable');
    END
    """,
    """
    CREATE TRIGGER media_budget_reservations_identity_immutable
    BEFORE UPDATE ON media_budget_reservations
    WHEN OLD.reservation_id <> NEW.reservation_id
        OR OLD.project_id <> NEW.project_id
        OR OLD.episode_id IS NOT NEW.episode_id
        OR OLD.budget_revision <> NEW.budget_revision
        OR OLD.idempotency_key <> NEW.idempotency_key
        OR OLD.currency <> NEW.currency
        OR OLD.amount_known <> NEW.amount_known
        OR OLD.amount_micro IS NOT NEW.amount_micro
        OR OLD.provider_called <> NEW.provider_called
        OR OLD.created_at <> NEW.created_at
    BEGIN
        SELECT RAISE(ABORT, 'media budget reservation identity is immutable');
    END
    """,
    """
    CREATE TRIGGER media_budget_reservations_no_reopen
    BEFORE UPDATE ON media_budget_reservations
    WHEN OLD.status = 'CANCELLED'
        OR OLD.status = 'SETTLED'
        OR (OLD.status = 'UNKNOWN' AND NEW.status <> 'UNKNOWN')
    BEGIN
        SELECT RAISE(ABORT, 'media budget reservation cannot be reopened');
    END
    """,
    """
    CREATE TRIGGER media_budget_dispatch_receipts_no_update
    BEFORE UPDATE ON media_budget_dispatch_receipts
    BEGIN
        SELECT RAISE(ABORT, 'media budget dispatch receipt is immutable');
    END
    """,
)
