"""Explicit additive-54 test fixtures; never remove or filter any older schema object."""

PREPARED_TABLES = (
    "prepared_generation_video_arm",
    "prepared_generation_retired_slot",
    "prepared_generation_slot",
    "prepared_generation_dependency",
    "prepared_generation_stage",
    "prepared_generation_target",
    "prepared_generation_execution",
)


def assert_prepared_tables_empty(connection):
    actual = {
        row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert set(PREPARED_TABLES) <= actual
    for table in PREPARED_TABLES:
        assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def remove_empty_prepared_tables(connection):
    assert_prepared_tables_empty(connection)
    for table in PREPARED_TABLES:
        connection.execute(f"DROP TABLE {table}")
