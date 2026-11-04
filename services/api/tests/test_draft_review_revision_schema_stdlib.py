"""Executable stdlib-only migration isolation checks, not a full 40→42 upgrade."""

import importlib.util
import sqlite3
import unittest
from pathlib import Path

SOURCE = Path(__file__).parents[1] / "src/aijian_api/draft_review_revision_schema.py"
spec = importlib.util.spec_from_file_location("revision_schema_isolated", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PREREQUISITES = """
CREATE TABLE episodes(project_id TEXT, id TEXT, PRIMARY KEY(project_id,id));
CREATE TABLE draft_export_jobs(operation_id TEXT PRIMARY KEY, project_id TEXT, episode_id TEXT);
CREATE TABLE draft_review_notes(
    note_id TEXT PRIMARY KEY, project_id TEXT, episode_id TEXT, operation_id TEXT);
INSERT INTO episodes VALUES('p','e'),('p','other');
INSERT INTO draft_export_jobs VALUES
    ('source','p','e'),('candidate','p','e'),('foreign','p','other');
INSERT INTO draft_review_notes VALUES
    ('note','p','e','source'),('foreign-note','p','other','foreign');
"""


class RevisionSchemaIsolation(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.executescript(PREREQUISITES)
        self.connection.execute("BEGIN IMMEDIATE")
        for statement in module.DRAFT_REVIEW_REVISION_MIGRATION:
            self.connection.execute(statement)
        self.connection.commit()

    def tearDown(self):
        self.connection.close()

    def plan(self):
        self.connection.execute(
            "INSERT INTO draft_review_revision_plans "
            "VALUES('plan','p','e','source','{}','h','{}','h')"
        )
        self.connection.execute(
            "INSERT INTO draft_review_revision_plan_notes VALUES('plan','note','p','e','source')"
        )

    def test_scoped_note_and_candidate_foreign_keys(self):
        self.plan()
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO draft_review_revision_plan_notes "
                "VALUES('plan','foreign-note','p','e','source')"
            )
        self.connection.execute(
            "INSERT INTO draft_review_revision_approvals VALUES('approve','plan','{}','h','{}','h')"
        )
        self.connection.execute(
            "INSERT INTO draft_review_revision_candidates "
            "VALUES('candidate-event','plan','approve','candidate','p','e','{}','h','{}','h')"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO draft_review_revision_candidates "
                "VALUES('wrong','plan','approve','foreign','p','e','{}','h','{}','h')"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO draft_review_revision_candidates "
                "VALUES('unapproved','plan','missing','candidate','p','e','{}','h','{}','h')"
            )
        self.assertEqual(self.connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_history_immutable_preserved_and_single_final_events(self):
        self.plan()
        self.connection.execute(
            "INSERT INTO draft_review_revision_approvals VALUES('approve','plan','{}','h','{}','h')"
        )
        self.connection.execute(
            "INSERT INTO draft_review_revision_candidates "
            "VALUES('candidate-event','plan','approve','candidate','p','e','{}','h','{}','h')"
        )
        self.connection.execute(
            "INSERT INTO draft_review_revision_rechecks "
            "VALUES('check','candidate-event','{}','h','{}','h')"
        )
        for table in ("plans", "plan_notes", "approvals", "candidates", "rechecks"):
            table = "draft_review_revision_" + table
            with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                self.connection.execute(
                    f"UPDATE {table} SET "
                    f"{'plan_id' if table.endswith('plan_notes') else 'event_id'}='changed'"
                )
            with self.assertRaisesRegex(sqlite3.IntegrityError, "preserved"):
                self.connection.execute(f"DELETE FROM {table}")
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO draft_review_revision_approvals "
                "VALUES('other','plan','{}','h','{}','h')"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO draft_review_revision_rechecks "
                "VALUES('other','candidate-event','{}','h','{}','h')"
            )
        self.assertEqual(
            self.connection.execute("SELECT COUNT(*) FROM draft_review_notes").fetchone()[0], 2
        )

    def test_transaction_rollback_and_reopen(self):
        other = sqlite3.connect(":memory:")
        other.executescript(PREREQUISITES)
        other.execute("BEGIN IMMEDIATE")
        try:
            for statement in module.DRAFT_REVIEW_REVISION_MIGRATION:
                other.execute(statement)
            other.execute("INVALID SQL")
        except sqlite3.DatabaseError:
            other.rollback()
        self.assertIsNone(
            other.execute(
                "SELECT name FROM sqlite_master WHERE name='draft_review_revision_plans'"
            ).fetchone()
        )
        self.assertEqual(other.execute("SELECT COUNT(*) FROM draft_review_notes").fetchone()[0], 2)
        other.close()


if __name__ == "__main__":
    unittest.main()
