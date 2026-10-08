"""Durable product export operations; repository owner registers migration 28.

This schema does not make a development export or an unapproved encoder a
product output. A claim must verify its assembly, media, and rights in one
transaction before inserting any row.
"""

PRODUCT_EXPORT_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE product_export_operations (
        project_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        request_hash TEXT NOT NULL CHECK (
            length(request_hash) = 71 AND request_hash LIKE 'sha256:%'
        ),
        request_json TEXT NOT NULL,
        assembly_artifact_id TEXT NOT NULL,
        assembly_version_id TEXT NOT NULL,
        assembly_content_hash TEXT NOT NULL CHECK (
            length(assembly_content_hash) = 71
            AND assembly_content_hash LIKE 'sha256:%'
        ),
        assembly_head_revision INTEGER NOT NULL CHECK (
            typeof(assembly_head_revision) = 'integer' AND assembly_head_revision > 0
        ),
        render_plan_hash TEXT NOT NULL CHECK (
            length(render_plan_hash) = 71 AND render_plan_hash LIKE 'sha256:%'
        ),
        render_plan_json TEXT NOT NULL,
        output_target_identity TEXT NOT NULL CHECK (
            length(output_target_identity) BETWEEN 1 AND 512
        ),
        inputs_sealed_at TEXT,
        media_input_count INTEGER NOT NULL CHECK (
            typeof(media_input_count) = 'integer' AND media_input_count BETWEEN 1 AND 8
        ),
        subtitle_input_count INTEGER NOT NULL CHECK (
            typeof(subtitle_input_count) = 'integer' AND subtitle_input_count BETWEEN 0 AND 1000
        ),
        status TEXT NOT NULL CHECK (
            status IN ('CLAIMED', 'RUNNING', 'CANCELLED', 'SUCCEEDED', 'UNKNOWN')
        ),
        progress_phase TEXT NOT NULL CHECK (
            progress_phase IN ('QUEUED', 'ENCODING', 'VERIFYING')
        ),
        progress_frames INTEGER NOT NULL CHECK (
            typeof(progress_frames) = 'integer' AND progress_frames >= 0
        ),
        total_frames INTEGER NOT NULL CHECK (
            typeof(total_frames) = 'integer' AND total_frames > 0
        ),
        cancel_requested_at TEXT,
        unknown_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        reconciled_at TEXT,
        PRIMARY KEY (project_id, operation_id),
        FOREIGN KEY (project_id, episode_id)
            REFERENCES episodes(project_id, id) ON DELETE CASCADE,
        FOREIGN KEY (project_id, episode_id, assembly_artifact_id)
            REFERENCES artifacts(project_id, episode_id, artifact_id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (assembly_artifact_id, assembly_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CHECK (status != 'UNKNOWN' OR unknown_reason IS NOT NULL),
        CHECK (progress_frames <= total_frames),
        CHECK (status NOT IN ('RUNNING', 'SUCCEEDED') OR started_at IS NOT NULL),
        CHECK (status NOT IN ('CANCELLED', 'SUCCEEDED', 'UNKNOWN')
            OR finished_at IS NOT NULL),
        CHECK (status != 'CANCELLED' OR cancel_requested_at IS NOT NULL),
        CHECK (reconciled_at IS NULL OR status IN ('SUCCEEDED', 'CANCELLED'))
    )
    """,
    """
    CREATE TABLE product_export_media_inputs (
        project_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        input_index INTEGER NOT NULL CHECK (
            typeof(input_index) = 'integer' AND input_index >= 0
        ),
        track_kind TEXT NOT NULL CHECK (
            track_kind IN ('VISUAL', 'DIALOGUE', 'BGM', 'SFX')
        ),
        media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'audio')),
        asset_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        asset_sha256 TEXT NOT NULL CHECK (length(asset_sha256) = 64),
        rights_decision_id TEXT NOT NULL,
        rights_revision INTEGER NOT NULL CHECK (
            typeof(rights_revision) = 'integer' AND rights_revision > 0
        ),
        rights_content_hash TEXT NOT NULL CHECK (length(rights_content_hash) = 64),
        CHECK (
            (track_kind = 'VISUAL' AND media_kind IN ('image', 'video'))
            OR (track_kind != 'VISUAL' AND media_kind = 'audio')
        ),
        PRIMARY KEY (project_id, operation_id, input_index),
        FOREIGN KEY (project_id, operation_id)
            REFERENCES product_export_operations(project_id, operation_id)
            ON DELETE CASCADE,
        FOREIGN KEY (project_id, asset_id, version_id)
            REFERENCES media_asset_versions(project_id, asset_id, id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (
            project_id, asset_id, version_id, rights_decision_id, rights_revision
        ) REFERENCES media_asset_rights_decisions(
            project_id, asset_id, version_id, id, revision
        ) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE TABLE product_export_subtitle_inputs (
        project_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        script_version_id TEXT NOT NULL,
        script_block_id TEXT NOT NULL,
        start_frame INTEGER NOT NULL CHECK (
            typeof(start_frame) = 'integer' AND start_frame >= 0
        ),
        end_frame INTEGER NOT NULL CHECK (
            typeof(end_frame) = 'integer' AND end_frame > start_frame
        ),
        PRIMARY KEY (project_id, operation_id, segment_id),
        FOREIGN KEY (project_id, operation_id)
            REFERENCES product_export_operations(project_id, operation_id)
            ON DELETE CASCADE,
        FOREIGN KEY (script_version_id)
            REFERENCES artifact_versions(version_id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE TABLE product_export_outputs (
        project_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        absolute_path TEXT NOT NULL CHECK (length(absolute_path) BETWEEN 1 AND 2048),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        byte_size INTEGER NOT NULL CHECK (typeof(byte_size) = 'integer' AND byte_size > 0),
        probe_json TEXT NOT NULL,
        probe_hash TEXT NOT NULL CHECK (
            length(probe_hash) = 71 AND probe_hash LIKE 'sha256:%'
        ),
        verified_at TEXT NOT NULL,
        PRIMARY KEY (project_id, operation_id),
        FOREIGN KEY (project_id, operation_id)
            REFERENCES product_export_operations(project_id, operation_id)
            ON DELETE CASCADE,
        UNIQUE (absolute_path)
    )
    """,
    """
    CREATE INDEX product_export_operations_episode
    ON product_export_operations(project_id, episode_id, created_at DESC)
    """,
    """
    CREATE UNIQUE INDEX product_export_operations_target_identity
    ON product_export_operations(output_target_identity)
    """,
    """
    CREATE INDEX product_export_media_version
    ON product_export_media_inputs(project_id, asset_id, version_id)
    """,
    """
    CREATE TRIGGER product_export_outputs_no_update
    BEFORE UPDATE ON product_export_outputs
    BEGIN SELECT RAISE(ABORT, 'product export output receipts are immutable'); END
    """,
    """
    CREATE TRIGGER product_export_operations_snapshot_immutable
    BEFORE UPDATE ON product_export_operations
    WHEN NEW.project_id IS NOT OLD.project_id
      OR NEW.operation_id IS NOT OLD.operation_id
      OR NEW.episode_id IS NOT OLD.episode_id
      OR NEW.request_hash IS NOT OLD.request_hash
      OR NEW.request_json IS NOT OLD.request_json
      OR NEW.assembly_artifact_id IS NOT OLD.assembly_artifact_id
      OR NEW.assembly_version_id IS NOT OLD.assembly_version_id
      OR NEW.assembly_content_hash IS NOT OLD.assembly_content_hash
      OR NEW.assembly_head_revision IS NOT OLD.assembly_head_revision
      OR NEW.render_plan_hash IS NOT OLD.render_plan_hash
      OR NEW.render_plan_json IS NOT OLD.render_plan_json
      OR NEW.output_target_identity IS NOT OLD.output_target_identity
      OR NEW.total_frames IS NOT OLD.total_frames
      OR NEW.media_input_count IS NOT OLD.media_input_count
      OR NEW.subtitle_input_count IS NOT OLD.subtitle_input_count
      OR NEW.created_at IS NOT OLD.created_at
      OR (OLD.inputs_sealed_at IS NOT NULL
          AND NEW.inputs_sealed_at IS NOT OLD.inputs_sealed_at)
    BEGIN SELECT RAISE(ABORT, 'product export claim is immutable'); END
    """,
    """
    CREATE TRIGGER product_export_operations_transition
    BEFORE UPDATE ON product_export_operations
    WHEN NEW.status IS NOT OLD.status
      AND NOT (
        (OLD.status = 'CLAIMED' AND NEW.status IN ('RUNNING', 'CANCELLED', 'UNKNOWN'))
        OR (OLD.status = 'RUNNING' AND NEW.status IN ('SUCCEEDED', 'CANCELLED', 'UNKNOWN'))
        OR (OLD.status = 'UNKNOWN' AND NEW.status IN ('SUCCEEDED', 'CANCELLED'))
      )
    BEGIN SELECT RAISE(ABORT, 'invalid product export status transition'); END
    """,
    """
    CREATE TRIGGER product_export_operations_seal_required
    BEFORE UPDATE ON product_export_operations
    WHEN OLD.status = 'CLAIMED' AND NEW.status = 'RUNNING'
      AND OLD.inputs_sealed_at IS NULL
    BEGIN SELECT RAISE(ABORT, 'product export inputs must be sealed before start'); END
    """,
    """
    CREATE TRIGGER product_export_operations_reconciliation_required
    BEFORE UPDATE ON product_export_operations
    WHEN OLD.status = 'UNKNOWN' AND NEW.status IN ('SUCCEEDED', 'CANCELLED')
      AND NEW.reconciled_at IS NULL
    BEGIN SELECT RAISE(ABORT, 'unknown export requires explicit reconciliation'); END
    """,
    """
    CREATE TRIGGER product_export_operations_seal_counts
    BEFORE UPDATE ON product_export_operations
    WHEN OLD.inputs_sealed_at IS NULL AND NEW.inputs_sealed_at IS NOT NULL
      AND (
        NEW.status != 'CLAIMED'
        OR NEW.media_input_count != (
            SELECT COUNT(*) FROM product_export_media_inputs AS media
            WHERE media.project_id = NEW.project_id
              AND media.operation_id = NEW.operation_id
        )
        OR NEW.subtitle_input_count != (
            SELECT COUNT(*) FROM product_export_subtitle_inputs AS subtitle
            WHERE subtitle.project_id = NEW.project_id
              AND subtitle.operation_id = NEW.operation_id
        )
      )
    BEGIN SELECT RAISE(ABORT, 'product export input snapshot is incomplete'); END
    """,
    """
    CREATE TRIGGER product_export_operations_cancel_monotonic
    BEFORE UPDATE ON product_export_operations
    WHEN OLD.cancel_requested_at IS NOT NULL
      AND NEW.cancel_requested_at IS NOT OLD.cancel_requested_at
    BEGIN SELECT RAISE(ABORT, 'product export cancel request is immutable'); END
    """,
    """
    CREATE TRIGGER product_export_operations_progress_monotonic
    BEFORE UPDATE ON product_export_operations
    WHEN NEW.progress_frames < OLD.progress_frames
      OR (OLD.progress_phase = 'ENCODING' AND NEW.progress_phase = 'QUEUED')
      OR (OLD.progress_phase = 'VERIFYING' AND NEW.progress_phase != 'VERIFYING')
      OR (NEW.progress_phase = 'VERIFYING' AND NEW.progress_frames != NEW.total_frames)
      OR (OLD.started_at IS NOT NULL AND NEW.started_at IS NOT OLD.started_at)
      OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at)
      OR (OLD.reconciled_at IS NOT NULL AND NEW.reconciled_at IS NOT OLD.reconciled_at)
    BEGIN SELECT RAISE(ABORT, 'product export progress cannot regress'); END
    """,
    """
    CREATE TRIGGER product_export_operations_initial_status
    BEFORE INSERT ON product_export_operations
    WHEN NEW.status != 'CLAIMED' OR NEW.progress_phase != 'QUEUED'
      OR NEW.progress_frames != 0 OR NEW.started_at IS NOT NULL
      OR NEW.finished_at IS NOT NULL OR NEW.cancel_requested_at IS NOT NULL
      OR NEW.unknown_reason IS NOT NULL OR NEW.inputs_sealed_at IS NOT NULL
      OR NEW.reconciled_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'product export must begin claimed'); END
    """,
    """
    CREATE TRIGGER product_export_operations_success_receipt
    BEFORE UPDATE ON product_export_operations
    WHEN NEW.status = 'SUCCEEDED' AND NOT EXISTS (
        SELECT 1 FROM product_export_outputs AS output
        WHERE output.project_id = NEW.project_id
          AND output.operation_id = NEW.operation_id
    )
    BEGIN SELECT RAISE(ABORT, 'verified product export receipt required'); END
    """,
    """
    CREATE TRIGGER product_export_operations_cancel_without_output
    BEFORE UPDATE ON product_export_operations
    WHEN NEW.status = 'CANCELLED' AND EXISTS (
        SELECT 1 FROM product_export_outputs AS output
        WHERE output.project_id = NEW.project_id
          AND output.operation_id = NEW.operation_id
    )
    BEGIN SELECT RAISE(ABORT, 'verified output cannot be cancelled'); END
    """,
    """
    CREATE TRIGGER product_export_outputs_insert_status
    BEFORE INSERT ON product_export_outputs
    WHEN NOT EXISTS (
        SELECT 1 FROM product_export_operations AS operation
        WHERE operation.project_id = NEW.project_id
          AND operation.operation_id = NEW.operation_id
          AND operation.status IN ('RUNNING', 'UNKNOWN')
    )
    BEGIN SELECT RAISE(ABORT, 'product export output requires running or reconciliation'); END
    """,
    """
    CREATE TRIGGER product_export_media_inputs_no_update
    BEFORE UPDATE ON product_export_media_inputs
    BEGIN SELECT RAISE(ABORT, 'product export media inputs are immutable'); END
    """,
    """
    CREATE TRIGGER product_export_media_inputs_insert_unsealed
    BEFORE INSERT ON product_export_media_inputs
    WHEN NOT EXISTS (
        SELECT 1 FROM product_export_operations AS operation
        WHERE operation.project_id = NEW.project_id
          AND operation.operation_id = NEW.operation_id
          AND operation.status = 'CLAIMED' AND operation.inputs_sealed_at IS NULL
    )
    BEGIN SELECT RAISE(ABORT, 'product export media inputs are sealed'); END
    """,
    """
    CREATE TRIGGER product_export_subtitle_inputs_no_update
    BEFORE UPDATE ON product_export_subtitle_inputs
    BEGIN SELECT RAISE(ABORT, 'product export subtitle inputs are immutable'); END
    """,
    """
    CREATE TRIGGER product_export_subtitle_inputs_insert_unsealed
    BEFORE INSERT ON product_export_subtitle_inputs
    WHEN NOT EXISTS (
        SELECT 1 FROM product_export_operations AS operation
        JOIN artifact_versions AS version
          ON version.version_id = NEW.script_version_id
        JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
        WHERE operation.project_id = NEW.project_id
          AND operation.operation_id = NEW.operation_id
          AND operation.status = 'CLAIMED' AND operation.inputs_sealed_at IS NULL
          AND artifact.project_id = operation.project_id
          AND artifact.episode_id = operation.episode_id
          AND artifact.artifact_type = 'episode_script'
    )
    BEGIN SELECT RAISE(ABORT, 'product export subtitle script or seal is invalid'); END
    """,
    """
    CREATE TRIGGER product_export_operations_no_direct_delete
    BEFORE DELETE ON product_export_operations
    WHEN EXISTS (
        SELECT 1 FROM episodes AS episode
        WHERE episode.project_id = OLD.project_id AND episode.id = OLD.episode_id
    )
    BEGIN SELECT RAISE(ABORT, 'active product export operations cannot be deleted'); END
    """,
    """
    CREATE TRIGGER product_export_media_inputs_no_direct_delete
    BEFORE DELETE ON product_export_media_inputs
    WHEN EXISTS (
        SELECT 1 FROM product_export_operations AS operation
        WHERE operation.project_id = OLD.project_id
          AND operation.operation_id = OLD.operation_id
    )
    BEGIN SELECT RAISE(ABORT, 'active product export media inputs cannot be deleted'); END
    """,
    """
    CREATE TRIGGER product_export_subtitle_inputs_no_direct_delete
    BEFORE DELETE ON product_export_subtitle_inputs
    WHEN EXISTS (
        SELECT 1 FROM product_export_operations AS operation
        WHERE operation.project_id = OLD.project_id
          AND operation.operation_id = OLD.operation_id
    )
    BEGIN SELECT RAISE(ABORT, 'active product export subtitles cannot be deleted'); END
    """,
    """
    CREATE TRIGGER product_export_outputs_no_direct_delete
    BEFORE DELETE ON product_export_outputs
    WHEN EXISTS (
        SELECT 1 FROM product_export_operations AS operation
        WHERE operation.project_id = OLD.project_id
          AND operation.operation_id = OLD.operation_id
    )
    BEGIN SELECT RAISE(ABORT, 'active product export receipt cannot be deleted'); END
    """,
)
