"""Atomic AgentRun/SkillRun state alignment for Agent/Skill workflow attempts."""

import json
import sqlite3
from typing import cast

from aijian_api.agent_skill_contracts import AttemptSnapshotV1


def mark_agent_skill_run_running(
    connection: sqlite3.Connection,
    snapshot: AttemptSnapshotV1,
    *,
    now_text: str,
) -> None:
    """Move a persisted run bundle to RUNNING."""

    row = _read_run_pair(connection, snapshot)
    agent_status = str(row["agent_status"])
    skill_status = str(row["skill_status"])
    if agent_status == skill_status == "RUNNING":
        return
    if agent_status != "PENDING" or skill_status != "PENDING":
        raise ValueError("Agent and Skill runs are not startable together")
    agent = connection.execute(
        """
        UPDATE agent_runs
        SET status = 'RUNNING', revision = revision + 1, updated_at = ?
        WHERE project_id = ? AND agent_run_id = ?
          AND status = 'PENDING' AND revision = ?
        """,
        (
            now_text,
            snapshot.project_id,
            snapshot.agent_run_id,
            int(row["agent_revision"]),
        ),
    )
    skill = connection.execute(
        """
        UPDATE skill_runs
        SET status = 'RUNNING', revision = revision + 1, updated_at = ?
        WHERE project_id = ? AND skill_run_id = ?
          AND status = 'PENDING' AND proposal_id IS NULL AND revision = ?
        """,
        (
            now_text,
            snapshot.project_id,
            snapshot.skill_run_id,
            int(row["skill_revision"]),
        ),
    )
    if agent.rowcount != 1 or skill.rowcount != 1:
        raise ValueError("Agent or Skill run changed while starting")


def mark_agent_skill_run_needs_review(
    connection: sqlite3.Connection,
    snapshot: AttemptSnapshotV1,
    *,
    proposal_id: str,
    now_text: str,
) -> None:
    """Bind the immutable proposal and move a persisted run bundle to human review."""

    row = _read_run_pair(connection, snapshot)
    if str(row["agent_status"]) != "RUNNING" or str(row["skill_status"]) != "RUNNING":
        raise ValueError("Agent and Skill runs are not running together")
    agent = connection.execute(
        """
        UPDATE agent_runs
        SET status = 'NEEDS_REVIEW', revision = revision + 1, updated_at = ?
        WHERE project_id = ? AND agent_run_id = ?
          AND status = 'RUNNING' AND revision = ?
        """,
        (
            now_text,
            snapshot.project_id,
            snapshot.agent_run_id,
            int(row["agent_revision"]),
        ),
    )
    skill = connection.execute(
        """
        UPDATE skill_runs
        SET status = 'NEEDS_REVIEW', proposal_id = ?,
            revision = revision + 1, updated_at = ?
        WHERE project_id = ? AND skill_run_id = ?
          AND status = 'RUNNING' AND proposal_id IS NULL AND revision = ?
        """,
        (
            proposal_id,
            now_text,
            snapshot.project_id,
            snapshot.skill_run_id,
            int(row["skill_revision"]),
        ),
    )
    if agent.rowcount != 1 or skill.rowcount != 1:
        raise ValueError("Agent or Skill run changed while entering review")


def mark_agent_skill_run_failed(
    connection: sqlite3.Connection,
    snapshot: AttemptSnapshotV1,
    *,
    now_text: str,
) -> None:
    """Move an exhausted persisted run bundle to its terminal failure state."""

    row = _read_run_pair(connection, snapshot)
    agent_status = str(row["agent_status"])
    skill_status = str(row["skill_status"])
    if agent_status != skill_status or agent_status not in {"PENDING", "RUNNING"}:
        raise ValueError("Agent and Skill runs cannot fail together")
    agent = connection.execute(
        """
        UPDATE agent_runs
        SET status = 'FAILED', revision = revision + 1, updated_at = ?
        WHERE project_id = ? AND agent_run_id = ?
          AND status = ? AND revision = ?
        """,
        (
            now_text,
            snapshot.project_id,
            snapshot.agent_run_id,
            agent_status,
            int(row["agent_revision"]),
        ),
    )
    skill = connection.execute(
        """
        UPDATE skill_runs
        SET status = 'FAILED', revision = revision + 1, updated_at = ?
        WHERE project_id = ? AND skill_run_id = ?
          AND status = ? AND proposal_id IS NULL AND revision = ?
        """,
        (
            now_text,
            snapshot.project_id,
            snapshot.skill_run_id,
            skill_status,
            int(row["skill_revision"]),
        ),
    )
    if agent.rowcount != 1 or skill.rowcount != 1:
        raise ValueError("Agent or Skill run changed while failing")


def _read_run_pair(
    connection: sqlite3.Connection,
    snapshot: AttemptSnapshotV1,
) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT agent.status AS agent_status, agent.revision AS agent_revision,
               agent.agent_definition_id, agent.agent_definition_version,
               agent.delegated_skill_run_ids_json,
               skill.status AS skill_status, skill.revision AS skill_revision,
               skill.skill_definition_id, skill.skill_definition_version,
               skill.proposal_id
        FROM agent_runs AS agent
        JOIN skill_runs AS skill
          ON skill.project_id = agent.project_id
         AND skill.agent_run_id = agent.agent_run_id
        WHERE agent.project_id = ? AND agent.agent_run_id = ?
          AND skill.skill_run_id = ?
        """,
        (snapshot.project_id, snapshot.agent_run_id, snapshot.skill_run_id),
    ).fetchone()
    if row is None:
        raise ValueError("Agent or Skill run is detached from the attempt snapshot")
    try:
        delegated = json.loads(str(row["delegated_skill_run_ids_json"]))
    except json.JSONDecodeError as error:
        raise ValueError("Agent delegated Skill run identifiers are invalid") from error
    if (
        delegated != [snapshot.skill_run_id]
        or str(row["agent_definition_id"]) != snapshot.agent_definition_id
        or str(row["agent_definition_version"]) != snapshot.agent_version
        or str(row["skill_definition_id"]) != snapshot.skill_definition_id
        or str(row["skill_definition_version"]) != snapshot.skill_version
        or row["proposal_id"] is not None
    ):
        raise ValueError("Agent or Skill run does not match the attempt snapshot")
    return cast(sqlite3.Row, row)
