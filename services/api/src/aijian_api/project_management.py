"""Revision-guarded project metadata changes on the existing projects table."""

from __future__ import annotations

import sqlite3

from pydantic import ValidationError

from aijian_api.contracts import ProjectData
from aijian_api.domain import Project
from aijian_api.project_management_contracts import UpdateProjectRequest
from aijian_api.repository import ProjectNotFoundError, StudioRepository
from aijian_api.task_ledger_models import timestamp


class ProjectPreconditionFailedError(ValueError):
    """The supplied project revision no longer matches persisted truth."""


class ProjectManagementConflictError(RuntimeError):
    """Persisted project metadata or its compare-and-swap result is inconsistent."""


def update_project(
    repository: StudioRepository,
    *,
    project_id: str,
    payload: UpdateProjectRequest,
    expected_revision: int,
) -> Project:
    """Change name/status atomically; equal values at the current revision are a no-op."""
    try:
        with repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if row is None:
                raise ProjectNotFoundError("Project was not found")
            current = repository._project_from_row(row)
            ProjectData.model_validate(current)
            if current.revision != expected_revision:
                raise ProjectPreconditionFailedError
            name = payload.name if "name" in payload.model_fields_set else current.name
            status = payload.status if "status" in payload.model_fields_set else current.status
            if name is None or status is None:
                raise ProjectManagementConflictError
            if name == current.name and status == current.status:
                connection.commit()
                return current
            updated = connection.execute(
                """UPDATE projects
                   SET name = ?, status = ?, revision = revision + 1, updated_at = ?
                   WHERE id = ? AND revision = ?
                   RETURNING *""",
                (name, status, timestamp(repository._clock()), project_id, expected_revision),
            ).fetchone()
            if updated is None:
                raise ProjectManagementConflictError
            project = repository._project_from_row(updated)
            ProjectData.model_validate(project)
            connection.commit()
            return project
    except (ProjectNotFoundError, ProjectPreconditionFailedError, ProjectManagementConflictError):
        raise
    except (sqlite3.Error, ValidationError, ValueError, TypeError, KeyError) as error:
        raise ProjectManagementConflictError from error
