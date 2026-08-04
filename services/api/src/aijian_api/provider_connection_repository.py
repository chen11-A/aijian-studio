"""SQLite metadata repository for model-provider connections."""

import json
import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal, cast

from aijian_api.task_ledger_models import new_id, parse_datetime, timestamp, utc_now

type ProviderKind = Literal["OPENAI", "XAI", "OPENAI_COMPATIBLE", "OLLAMA"]
type ProviderCapability = Literal["TEXT", "IMAGE", "VIDEO", "SPEECH"]


class ProviderConnectionConflictError(RuntimeError):
    """Raised when a display name is already used."""


class ProviderConnectionNotFoundError(LookupError):
    """Raised when a provider connection does not exist."""


@dataclass(frozen=True, slots=True)
class ProviderModel:
    model_id: str
    capabilities: tuple[ProviderCapability, ...]


@dataclass(frozen=True, slots=True)
class ProviderConnection:
    id: str
    provider_kind: ProviderKind
    display_name: str
    base_url: str
    enabled: bool
    models: tuple[ProviderModel, ...]
    revision: int
    created_at: datetime
    updated_at: datetime


class ProviderConnectionRepository:
    def __init__(
        self,
        database_path: Path,
        *,
        clock: Callable[[], datetime] = utc_now,
        id_factory: Callable[[str], str] = new_id,
    ) -> None:
        self._database_path = database_path
        self._clock = clock
        self._id_factory = id_factory

    def list(self) -> tuple[ProviderConnection, ...]:
        with self._open() as connection:
            rows = connection.execute(
                """
                SELECT * FROM provider_connections
                ORDER BY enabled DESC, display_name COLLATE NOCASE
                """
            ).fetchall()
        return tuple(_connection_from_row(row) for row in rows)

    def get(self, connection_id: str) -> ProviderConnection:
        with self._open() as connection:
            row = connection.execute(
                "SELECT * FROM provider_connections WHERE connection_id = ?",
                (connection_id,),
            ).fetchone()
        if row is None:
            raise ProviderConnectionNotFoundError("provider connection not found")
        return _connection_from_row(row)

    def create(
        self,
        *,
        provider_kind: ProviderKind,
        display_name: str,
        base_url: str,
        enabled: bool,
        models: Sequence[ProviderModel],
    ) -> ProviderConnection:
        connection_id = self._id_factory("pcn")
        now_text = timestamp(self._clock())
        models_json = _models_json(models)
        try:
            with self._open() as connection:
                connection.execute(
                    """
                    INSERT INTO provider_connections (
                        connection_id, provider_kind, display_name, base_url, enabled,
                        models_json, revision, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                    """,
                    (
                        connection_id,
                        provider_kind,
                        display_name,
                        base_url,
                        int(enabled),
                        models_json,
                        now_text,
                        now_text,
                    ),
                )
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise ProviderConnectionConflictError("provider display name already exists") from error
        return ProviderConnection(
            id=connection_id,
            provider_kind=provider_kind,
            display_name=display_name,
            base_url=base_url,
            enabled=enabled,
            models=tuple(models),
            revision=1,
            created_at=parse_datetime(now_text),
            updated_at=parse_datetime(now_text),
        )

    def delete(self, connection_id: str) -> None:
        with self._open() as connection:
            cursor = connection.execute(
                "DELETE FROM provider_connections WHERE connection_id = ?",
                (connection_id,),
            )
            if cursor.rowcount != 1:
                raise ProviderConnectionNotFoundError("provider connection not found")
            connection.commit()

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection


def _models_json(models: Sequence[ProviderModel]) -> str:
    return json.dumps(
        [
            {"model_id": model.model_id, "capabilities": list(model.capabilities)}
            for model in models
        ],
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _connection_from_row(row: sqlite3.Row) -> ProviderConnection:
    raw_models = json.loads(str(row["models_json"]))
    models = tuple(
        ProviderModel(
            model_id=str(item["model_id"]),
            capabilities=tuple(item["capabilities"]),
        )
        for item in raw_models
    )
    return ProviderConnection(
        id=str(row["connection_id"]),
        provider_kind=cast(ProviderKind, str(row["provider_kind"])),
        display_name=str(row["display_name"]),
        base_url=str(row["base_url"]),
        enabled=bool(row["enabled"]),
        models=models,
        revision=int(row["revision"]),
        created_at=parse_datetime(str(row["created_at"])),
        updated_at=parse_datetime(str(row["updated_at"])),
    )
