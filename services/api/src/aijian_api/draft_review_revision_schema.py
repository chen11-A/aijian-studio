"""Pending schema 42, registered only after director schema 41 is integrated."""

DRAFT_REVIEW_REVISION_MIGRATION: tuple[str, ...] = (
    "CREATE UNIQUE INDEX draft_revision_export_scope "
    "ON draft_export_jobs(project_id, episode_id, operation_id)",
    "CREATE UNIQUE INDEX draft_revision_note_scope "
    "ON draft_review_notes(project_id, episode_id, operation_id, note_id)",
    """CREATE TABLE draft_review_revision_plans (
        event_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        operation_id TEXT NOT NULL REFERENCES draft_export_jobs(operation_id),
        request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
        event_json TEXT NOT NULL, event_hash TEXT NOT NULL,
        UNIQUE(event_id, project_id, episode_id, operation_id),
        UNIQUE(event_id, project_id, episode_id),
        FOREIGN KEY(project_id, episode_id) REFERENCES episodes(project_id, id),
        FOREIGN KEY(project_id, episode_id, operation_id)
            REFERENCES draft_export_jobs(project_id, episode_id, operation_id)
    )""",
    """CREATE TABLE draft_review_revision_plan_notes (
        plan_id TEXT NOT NULL REFERENCES draft_review_revision_plans(event_id),
        note_id TEXT NOT NULL REFERENCES draft_review_notes(note_id),
        project_id TEXT NOT NULL, episode_id TEXT NOT NULL, operation_id TEXT NOT NULL,
        PRIMARY KEY(plan_id, note_id),
        FOREIGN KEY(plan_id, project_id, episode_id, operation_id)
            REFERENCES draft_review_revision_plans(event_id, project_id, episode_id, operation_id),
        FOREIGN KEY(project_id, episode_id, operation_id, note_id)
            REFERENCES draft_review_notes(project_id, episode_id, operation_id, note_id)
    )""",
    """CREATE TABLE draft_review_revision_approvals (
        event_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL UNIQUE REFERENCES draft_review_revision_plans(event_id),
        request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
        event_json TEXT NOT NULL, event_hash TEXT NOT NULL,
        UNIQUE(event_id, plan_id)
    )""",
    """CREATE TABLE draft_review_revision_candidates (
        event_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES draft_review_revision_plans(event_id),
        approval_id TEXT NOT NULL,
        operation_id TEXT NOT NULL REFERENCES draft_export_jobs(operation_id),
        project_id TEXT NOT NULL, episode_id TEXT NOT NULL,
        request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
        event_json TEXT NOT NULL, event_hash TEXT NOT NULL,
        UNIQUE(plan_id, operation_id),
        FOREIGN KEY(approval_id, plan_id)
            REFERENCES draft_review_revision_approvals(event_id, plan_id),
        FOREIGN KEY(plan_id, project_id, episode_id)
            REFERENCES draft_review_revision_plans(event_id, project_id, episode_id),
        FOREIGN KEY(project_id, episode_id, operation_id)
            REFERENCES draft_export_jobs(project_id, episode_id, operation_id)
    )""",
    """CREATE TABLE draft_review_revision_rechecks (
        event_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL UNIQUE REFERENCES draft_review_revision_candidates(event_id),
        request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
        event_json TEXT NOT NULL, event_hash TEXT NOT NULL
    )""",
    "CREATE INDEX draft_review_revision_scope "
    "ON draft_review_revision_plans(project_id, episode_id, operation_id)",
    "CREATE INDEX draft_review_revision_candidate_scope "
    "ON draft_review_revision_candidates(plan_id)",
    *(
        statement
        for table in (
            "draft_review_revision_plans",
            "draft_review_revision_plan_notes",
            "draft_review_revision_approvals",
            "draft_review_revision_candidates",
            "draft_review_revision_rechecks",
        )
        for statement in (
            f"CREATE TRIGGER {table}_immutable BEFORE UPDATE ON {table} "
            "BEGIN SELECT RAISE(ABORT, 'Manual revision evidence is immutable'); END",
            f"CREATE TRIGGER {table}_preserved BEFORE DELETE ON {table} "
            "BEGIN SELECT RAISE(ABORT, 'Manual revision evidence is preserved'); END",
        )
    ),
)
