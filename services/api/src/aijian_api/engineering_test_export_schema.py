"""Separate, synthetic-only encoder QA ledger; repository owner registers migration 31."""

ENGINEERING_TEST_EXPORT_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE engineering_test_export_operations (
        operation_id TEXT PRIMARY KEY CHECK (
            length(operation_id) = 38 AND substr(operation_id, 1, 6) = 'etexp_'
            AND substr(operation_id, 7) NOT GLOB '*[^0-9a-f]*'
        ),
        scope TEXT NOT NULL CHECK (scope = 'ENGINEERING_TEST'),
        request_hash TEXT NOT NULL CHECK (
            length(request_hash) = 71 AND request_hash LIKE 'sha256:%'
        ),
        fixture_id TEXT NOT NULL CHECK (fixture_id = 'vfr-pattern-25fps-proxy'),
        fixture_sha256 TEXT NOT NULL CHECK (
            fixture_sha256 = '0801c350d098061a9694017f4adcc3cbe8a37c24dce67c864644f928f286b67a'
        ),
        toolchain_profile_id TEXT NOT NULL,
        ffmpeg_sha256 TEXT NOT NULL CHECK (length(ffmpeg_sha256) = 64),
        ffprobe_sha256 TEXT NOT NULL CHECK (length(ffprobe_sha256) = 64),
        output_relative_path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (
            status IN ('CLAIMED', 'RUNNING', 'UNKNOWN', 'CANCELLED', 'SUCCEEDED')
        ),
        progress_phase TEXT NOT NULL CHECK (
            progress_phase IN ('QUEUED', 'ENCODING', 'VERIFYING')
        ),
        progress_frames INTEGER NOT NULL CHECK (
            typeof(progress_frames) = 'integer' AND progress_frames BETWEEN 0 AND 64
        ),
        cancel_requested_at TEXT,
        unknown_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        CHECK (status != 'UNKNOWN' OR unknown_reason IS NOT NULL),
        CHECK (status NOT IN ('RUNNING', 'SUCCEEDED') OR started_at IS NOT NULL),
        CHECK (status NOT IN ('UNKNOWN', 'CANCELLED', 'SUCCEEDED') OR finished_at IS NOT NULL),
        CHECK (status != 'CANCELLED' OR cancel_requested_at IS NOT NULL)
    )
    """,
    """
    CREATE TABLE engineering_test_export_outputs (
        operation_id TEXT PRIMARY KEY REFERENCES engineering_test_export_operations(operation_id)
            ON DELETE NO ACTION,
        scope TEXT NOT NULL CHECK (scope = 'ENGINEERING_TEST'),
        relative_path TEXT NOT NULL UNIQUE,
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        byte_size INTEGER NOT NULL CHECK (
            typeof(byte_size) = 'integer' AND byte_size > 0 AND byte_size <= 33554432
        ),
        probe_json TEXT NOT NULL CHECK (length(probe_json) BETWEEN 2 AND 8388608),
        probe_hash TEXT NOT NULL CHECK (
            length(probe_hash) = 71 AND probe_hash LIKE 'sha256:%'
        ),
        verified_at TEXT NOT NULL
    )
    """,
    """
    CREATE INDEX engineering_test_export_status
    ON engineering_test_export_operations(status, created_at)
    """,
    """
    CREATE TRIGGER engineering_test_export_operation_initial
    BEFORE INSERT ON engineering_test_export_operations
    WHEN NEW.status != 'CLAIMED' OR NEW.progress_phase != 'QUEUED'
      OR NEW.progress_frames != 0 OR NEW.cancel_requested_at IS NOT NULL
      OR NEW.unknown_reason IS NOT NULL OR NEW.started_at IS NOT NULL
      OR NEW.finished_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'engineering export must begin claimed'); END
    """,
    """
    CREATE TRIGGER engineering_test_export_operation_identity
    BEFORE UPDATE ON engineering_test_export_operations
    WHEN NEW.operation_id IS NOT OLD.operation_id
      OR NEW.scope IS NOT OLD.scope OR NEW.request_hash IS NOT OLD.request_hash
      OR NEW.fixture_id IS NOT OLD.fixture_id
      OR NEW.fixture_sha256 IS NOT OLD.fixture_sha256
      OR NEW.toolchain_profile_id IS NOT OLD.toolchain_profile_id
      OR NEW.ffmpeg_sha256 IS NOT OLD.ffmpeg_sha256
      OR NEW.ffprobe_sha256 IS NOT OLD.ffprobe_sha256
      OR NEW.output_relative_path IS NOT OLD.output_relative_path
      OR NEW.created_at IS NOT OLD.created_at
      OR (OLD.cancel_requested_at IS NOT NULL
          AND NEW.cancel_requested_at IS NOT OLD.cancel_requested_at)
      OR (OLD.started_at IS NOT NULL AND NEW.started_at IS NOT OLD.started_at)
      OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at)
    BEGIN SELECT RAISE(ABORT, 'engineering export identity is immutable'); END
    """,
    """
    CREATE TRIGGER engineering_test_export_operation_transition
    BEFORE UPDATE ON engineering_test_export_operations
    WHEN NEW.status IS NOT OLD.status AND NOT (
        (OLD.status = 'CLAIMED' AND NEW.status IN ('RUNNING', 'CANCELLED', 'UNKNOWN'))
        OR (OLD.status = 'RUNNING' AND NEW.status IN ('CANCELLED', 'SUCCEEDED', 'UNKNOWN'))
    )
    BEGIN SELECT RAISE(ABORT, 'invalid engineering export transition'); END
    """,
    """
    CREATE TRIGGER engineering_test_export_progress
    BEFORE UPDATE ON engineering_test_export_operations
    WHEN NEW.progress_frames < OLD.progress_frames
      OR (OLD.progress_phase = 'ENCODING' AND NEW.progress_phase = 'QUEUED')
      OR (OLD.progress_phase = 'VERIFYING' AND NEW.progress_phase != 'VERIFYING')
      OR (NEW.progress_phase = 'VERIFYING' AND NEW.progress_frames != 64)
    BEGIN SELECT RAISE(ABORT, 'engineering export progress cannot regress'); END
    """,
    """
    CREATE TRIGGER engineering_test_export_success_receipt
    BEFORE UPDATE ON engineering_test_export_operations
    WHEN NEW.status = 'SUCCEEDED' AND NOT EXISTS (
        SELECT 1 FROM engineering_test_export_outputs AS output
        WHERE output.operation_id = NEW.operation_id
    )
    BEGIN SELECT RAISE(ABORT, 'engineering export needs verified output'); END
    """,
    """
    CREATE TRIGGER engineering_test_export_cancel_without_output
    BEFORE UPDATE ON engineering_test_export_operations
    WHEN NEW.status = 'CANCELLED' AND EXISTS (
        SELECT 1 FROM engineering_test_export_outputs AS output
        WHERE output.operation_id = NEW.operation_id
    )
    BEGIN SELECT RAISE(ABORT, 'verified output cannot be cancelled'); END
    """,
    """
    CREATE TRIGGER engineering_test_export_output_only_running
    BEFORE INSERT ON engineering_test_export_outputs
    WHEN NOT EXISTS (
        SELECT 1 FROM engineering_test_export_operations AS operation
        WHERE operation.operation_id = NEW.operation_id AND operation.status = 'RUNNING'
          AND operation.progress_phase = 'VERIFYING'
          AND operation.cancel_requested_at IS NULL
          AND NEW.relative_path = operation.output_relative_path
    )
    BEGIN SELECT RAISE(ABORT, 'engineering output has no matching running operation'); END
    """,
    """
    CREATE TRIGGER engineering_test_export_operation_no_delete
    BEFORE DELETE ON engineering_test_export_operations
    BEGIN SELECT RAISE(ABORT, 'engineering export operations are durable'); END
    """,
    """
    CREATE TRIGGER engineering_test_export_output_no_update
    BEFORE UPDATE ON engineering_test_export_outputs
    BEGIN SELECT RAISE(ABORT, 'engineering export output is immutable'); END
    """,
    """
    CREATE TRIGGER engineering_test_export_output_no_delete
    BEFORE DELETE ON engineering_test_export_outputs
    BEGIN SELECT RAISE(ABORT, 'engineering export output is durable'); END
    """,
)
