"""Private native-origin prerequisite lineage; never a portable grant or paid allowance."""

PREPARED_GENERATION_MIGRATION = (
    """
    CREATE TABLE prepared_generation_execution (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        account_sha256 TEXT NOT NULL CHECK(length(account_sha256)=64),
        execution_key_sha256 TEXT NOT NULL CHECK(length(execution_key_sha256)=64),
        retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1)),
        UNIQUE(project_id,execution_key_sha256)
    )
    """,
    """
    CREATE TABLE prepared_generation_target (
        execution_id TEXT NOT NULL REFERENCES prepared_generation_execution(id) ON DELETE CASCADE,
        target_key TEXT NOT NULL,
        input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
        original_recipe_json TEXT NOT NULL,
        slot_count INTEGER NOT NULL CHECK(slot_count BETWEEN 1 AND 3),
        first_regenerate INTEGER NOT NULL CHECK(first_regenerate IN (0,1)),
        original_body_json TEXT NOT NULL,
        PRIMARY KEY(execution_id,target_key)
    )
    """,
    """
    CREATE TABLE prepared_generation_stage (
        execution_id TEXT NOT NULL REFERENCES prepared_generation_execution(id) ON DELETE CASCADE,
        stage_key TEXT NOT NULL,
        native_stage_json TEXT NOT NULL,
        body_sha256 TEXT CHECK(body_sha256 IS NULL OR length(body_sha256)=64),
        output_sha256 TEXT CHECK(output_sha256 IS NULL OR length(output_sha256)=64),
        status TEXT NOT NULL
            CHECK(status IN ('UNSENT','PENDING','UNKNOWN','READABLE','CLOSED_UNSENT')),
        PRIMARY KEY(execution_id,stage_key)
    )
    """,
    """
    CREATE TABLE prepared_generation_dependency (
        execution_id TEXT NOT NULL,
        stage_key TEXT NOT NULL,
        target_key TEXT NOT NULL,
        PRIMARY KEY(execution_id,stage_key,target_key),
        FOREIGN KEY(execution_id,stage_key)
            REFERENCES prepared_generation_stage(execution_id,stage_key) ON DELETE CASCADE,
        FOREIGN KEY(execution_id,target_key)
            REFERENCES prepared_generation_target(execution_id,target_key) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE prepared_generation_slot (
        execution_id TEXT NOT NULL,
        target_key TEXT NOT NULL,
        slot_index INTEGER NOT NULL CHECK(slot_index BETWEEN 0 AND 2),
        attempt_id TEXT NOT NULL REFERENCES story_creation_failure_attempt(id),
        take_key TEXT,
        child_state TEXT NOT NULL DEFAULT 'UNSENT'
            CHECK(child_state IN (
                'UNSENT','IN_FLIGHT','KNOWN_COMPLETE','UNKNOWN','VIDEO_READABLE'
            )),
        PRIMARY KEY(execution_id,target_key,slot_index),
        FOREIGN KEY(execution_id,target_key)
            REFERENCES prepared_generation_target(execution_id,target_key) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE prepared_generation_retired_slot (
        execution_id TEXT NOT NULL,
        target_key TEXT NOT NULL,
        slot_index INTEGER NOT NULL CHECK(slot_index BETWEEN 0 AND 2),
        PRIMARY KEY(execution_id,target_key,slot_index),
        FOREIGN KEY(execution_id,target_key)
            REFERENCES prepared_generation_target(execution_id,target_key) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE prepared_generation_video_arm (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        target_key TEXT NOT NULL,
        slot_index INTEGER NOT NULL CHECK(slot_index BETWEEN 0 AND 2),
        take_key TEXT NOT NULL,
        body_sha256 TEXT NOT NULL CHECK(length(body_sha256)=64),
        runtime_recipe_json TEXT NOT NULL,
        runtime_sources_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        claimed_key_sha256 TEXT CHECK(claimed_key_sha256 IS NULL
            OR length(claimed_key_sha256)=64),
        UNIQUE(execution_id,target_key,slot_index),
        FOREIGN KEY(execution_id,target_key)
            REFERENCES prepared_generation_target(execution_id,target_key) ON DELETE CASCADE
    )
    """,
    """
    CREATE INDEX prepared_generation_artifact
        ON prepared_generation_stage(output_sha256,status)
    """,
)
