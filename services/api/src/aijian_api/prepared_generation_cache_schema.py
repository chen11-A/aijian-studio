"""Immutable per-slot preparation choices; not transferable media authorization."""

PREPARED_GENERATION_CACHE_MIGRATION = (
    """
    CREATE TABLE prepared_generation_slot_preparation (
        execution_id TEXT NOT NULL,
        target_key TEXT NOT NULL,
        slot_index INTEGER NOT NULL CHECK(slot_index BETWEEN 0 AND 2),
        preparation TEXT NOT NULL CHECK(preparation IN ('CLIENT_IMAGES','STORYFILM_CACHE')),
        cache_snapshot_json TEXT,
        cache_snapshot_sha256 TEXT,
        PRIMARY KEY(execution_id,target_key,slot_index),
        FOREIGN KEY(execution_id,target_key)
            REFERENCES prepared_generation_target(execution_id,target_key) ON DELETE CASCADE,
        CHECK (
            (preparation='CLIENT_IMAGES' AND cache_snapshot_json IS NULL
                AND cache_snapshot_sha256 IS NULL)
            OR (preparation='STORYFILM_CACHE' AND cache_snapshot_json IS NOT NULL
                AND cache_snapshot_sha256 IS NOT NULL AND length(cache_snapshot_sha256)=64)
        )
    )
    """,
)
