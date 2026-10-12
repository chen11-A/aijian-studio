"""Append-only source-impact records; existing confirmation bodies remain unchanged."""

SCRIPT_CONFIRMATION_IMPACT_MIGRATION: tuple[str, ...] = (
    """
    ALTER TABLE episode_script_confirmations ADD COLUMN impact_coverage_version INTEGER
      NOT NULL DEFAULT 0 CHECK (typeof(impact_coverage_version) = 'integer'
                               AND impact_coverage_version IN (0, 1))
    """,
    """
    CREATE TABLE script_confirmation_impact_coverage (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL CHECK (schema_version = 44),
      preexisting_max_rowid INTEGER NOT NULL CHECK (preexisting_max_rowid >= 0),
      preexisting_confirmation_count INTEGER NOT NULL CHECK (preexisting_confirmation_count >= 0)
    )
    """,
    """
    INSERT INTO script_confirmation_impact_coverage
    SELECT 1, 44, COALESCE(MAX(rowid), 0), COUNT(*) FROM episode_script_confirmations
    """,
    """
    CREATE TRIGGER script_confirmation_impact_coverage_no_update
    BEFORE UPDATE ON script_confirmation_impact_coverage
    BEGIN SELECT RAISE(ABORT, 'confirmation impact coverage is immutable'); END
    """,
    """
    CREATE TRIGGER script_confirmation_impact_coverage_no_delete
    BEFORE DELETE ON script_confirmation_impact_coverage
    BEGIN SELECT RAISE(ABORT, 'confirmation impact coverage is immutable'); END
    """,
    """
    CREATE TRIGGER episode_script_confirmation_impact_coverage_insert
    BEFORE INSERT ON episode_script_confirmations WHEN NEW.impact_coverage_version != 1
    BEGIN SELECT RAISE(ABORT, 'new confirmation requires atomic impact coverage'); END
    """,
    """
    CREATE TABLE script_confirmation_impacts (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id TEXT NOT NULL UNIQUE CHECK (length(report_id) = 36 AND report_id LIKE 'sci_%'),
      project_id TEXT NOT NULL,
      episode_id TEXT NOT NULL,
      new_confirmation_id TEXT NOT NULL UNIQUE,
      old_confirmation_id TEXT,
      event_kind TEXT NOT NULL CHECK (event_kind IN ('BASELINE', 'SAME_SOURCE', 'SOURCE_REPLACED')),
      assessment_hash TEXT NOT NULL CHECK (length(assessment_hash) = 71
                                          AND assessment_hash LIKE 'sha256:%'),
      assessment_json TEXT NOT NULL CHECK (json_valid(assessment_json)
                                          AND length(CAST(assessment_json AS BLOB)) <= 12582912),
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
      FOREIGN KEY (new_confirmation_id) REFERENCES episode_script_confirmations(confirmation_id)
        ON DELETE CASCADE,
      FOREIGN KEY (old_confirmation_id) REFERENCES episode_script_confirmations(confirmation_id)
        ON DELETE CASCADE
    )
    """,
    """
    CREATE INDEX script_confirmation_impacts_project_history
    ON script_confirmation_impacts(project_id, sequence DESC)
    """,
    """
    CREATE TRIGGER script_confirmation_impact_chain_insert
    BEFORE INSERT ON script_confirmation_impacts WHEN NOT EXISTS (
      SELECT 1 FROM episode_script_confirmations AS receipt
      WHERE receipt.confirmation_id = NEW.new_confirmation_id
        AND receipt.project_id = NEW.project_id AND receipt.episode_id = NEW.episode_id
        AND receipt.impact_coverage_version = 1
        AND NEW.created_at = receipt.confirmed_at
        AND NEW.old_confirmation_id IS (
          SELECT prior.confirmation_id FROM episode_script_confirmations AS prior
          WHERE prior.project_id = receipt.project_id AND prior.episode_id = receipt.episode_id
            AND prior.rowid < receipt.rowid ORDER BY prior.rowid DESC LIMIT 1
        )
        AND json_extract(NEW.assessment_json, '$.schema_version') = '1.0.0'
        AND json_extract(NEW.assessment_json, '$.algorithm_version')
          = 'script-confirmation-exact-dependencies-v1'
        AND json_extract(NEW.assessment_json, '$.source_kind') = 'EPISODE_SCRIPT_CONFIRMATION'
        AND json_extract(NEW.assessment_json, '$.project_id') = NEW.project_id
        AND json_extract(NEW.assessment_json, '$.episode_id') = NEW.episode_id
        AND json_extract(NEW.assessment_json, '$.event_kind') = NEW.event_kind
        AND json_extract(NEW.assessment_json, '$.new_confirmation.confirmation_id')
          = NEW.new_confirmation_id
        AND json_extract(NEW.assessment_json, '$.old_confirmation.confirmation_id')
          IS NEW.old_confirmation_id
    )
    BEGIN SELECT RAISE(ABORT, 'confirmation impact chain is inconsistent'); END
    """,
    """
    CREATE TRIGGER script_confirmation_impact_no_update
    BEFORE UPDATE ON script_confirmation_impacts
    BEGIN SELECT RAISE(ABORT, 'confirmation impact is immutable'); END
    """,
    """
    CREATE TRIGGER script_confirmation_impact_no_delete
    BEFORE DELETE ON script_confirmation_impacts WHEN EXISTS (
      SELECT 1 FROM projects WHERE id = OLD.project_id
    ) AND EXISTS (
      SELECT 1 FROM episode_script_confirmations
      WHERE confirmation_id = OLD.new_confirmation_id
    )
    BEGIN SELECT RAISE(ABORT, 'confirmation impact is immutable'); END
    """,
)
