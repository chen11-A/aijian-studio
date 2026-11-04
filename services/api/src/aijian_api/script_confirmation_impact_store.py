"""Caller-transaction confirmation impact persistence and immutable exact reads."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from aijian_api.artifact_invalidation_domain import (
    ArtifactVersionIdentity,
    ExactVersionDependency,
    SourceVersionReplacementInput,
    assess_source_version_replacement,
)
from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import DependencyImpact
from aijian_api.episode_script_confirmation_contracts import (
    CreateEpisodeScriptConfirmationRequest,
    EpisodeScriptConfirmationData,
)
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.repository import StudioRepository
from aijian_api.script_confirmation_impact_contracts import (
    ALGORITHM,
    MAX_ASSESSMENT_BYTES,
    EventKind,
    ScriptConfirmationImpactAssessmentV1,
    ScriptConfirmationImpactLookupData,
    ScriptConfirmationImpactPageData,
    ScriptConfirmationImpactReportV1,
    ScriptConfirmationImpactSummaryV1,
    ScriptConfirmationOperationData,
    ScriptImpactAssemblyContextV1,
    ScriptImpactDependencyV1,
    ScriptImpactReasonV1,
    ScriptImpactTargetV1,
)
from aijian_api.script_confirmation_impact_projection import (
    ImpactMaterializationBudget,
    bounded_version_record,
    immutable_consumer_context,
)


class ScriptConfirmationImpactError(RuntimeError):
    pass


class ScriptConfirmationImpactNotFoundError(LookupError):
    pass


def _receipt(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    project_id: str,
    episode_id: str,
    confirmation_id: str,
) -> tuple[EpisodeScriptConfirmationData, int]:
    row = connection.execute(
        """SELECT * FROM episode_script_confirmations
           WHERE project_id = ? AND episode_id = ? AND confirmation_id = ?""",
        (project_id, episode_id, confirmation_id),
    ).fetchone()
    if row is None:
        raise ScriptConfirmationImpactNotFoundError("Exact confirmation was not found")
    record = bounded_version_record(
        repository,
        connection,
        project_id=project_id,
        episode_id=episode_id,
        artifact_type="episode_script",
        version_id=str(row["version_id"]),
    )
    script = EpisodeScriptStore(repository)._verified_version_data(
        record,
        project_id=project_id,
        episode_id=episode_id,
        connection=connection,
    )
    confirmed_at = datetime.fromisoformat(str(row["confirmed_at"]).replace("Z", "+00:00"))
    if (
        str(row["artifact_id"]) != record.version.artifact_id
        or str(row["content_hash"]) != script.content_hash
        or confirmed_at.tzinfo is None
        or confirmed_at.utcoffset() is None
    ):
        raise ScriptConfirmationImpactError("Confirmation does not bind its immutable source")
    data = EpisodeScriptConfirmationData(
        confirmation_id=str(row["confirmation_id"]),
        project_id=project_id,
        episode_id=episode_id,
        artifact_id=str(row["artifact_id"]),
        version_id=str(row["version_id"]),
        content_hash=str(row["content_hash"]),
        head_revision=int(row["head_revision"]),
        actor_id=str(row["actor_id"]),
        confirmed_at=confirmed_at,
    )
    return data, int(row["impact_coverage_version"])


def _dependency(row: sqlite3.Row, project_id: str) -> ExactVersionDependency:
    if row["up_project"] != project_id or row["down_project"] != project_id:
        raise ScriptConfirmationImpactError("Cross-project or dangling impact dependency")
    return ExactVersionDependency(
        id=str(row["dependency_id"]),
        project_id=project_id,
        upstream_artifact_id=str(row["upstream_artifact_id"]),
        upstream_version_id=str(row["upstream_version_id"]),
        downstream_artifact_id=str(row["downstream_artifact_id"]),
        downstream_version_id=str(row["downstream_version_id"]),
        relationship=str(row["relationship"]),
        impact=cast(DependencyImpact, str(row["impact"])),
    )


def _edge_model(edge: ExactVersionDependency) -> ScriptImpactDependencyV1:
    return ScriptImpactDependencyV1(
        dependency_id=edge.id,
        project_id=edge.project_id,
        upstream_artifact_id=edge.upstream_artifact_id,
        upstream_version_id=edge.upstream_version_id,
        downstream_artifact_id=edge.downstream_artifact_id,
        downstream_version_id=edge.downstream_version_id,
        relationship=edge.relationship,
        impact=edge.impact,
    )


_EDGE_SQL = """SELECT d.*, up.project_id AS up_project, down.project_id AS down_project,
                      down.episode_id AS down_episode
               FROM artifact_dependencies AS d
               LEFT JOIN artifacts AS up ON up.artifact_id = d.upstream_artifact_id
               LEFT JOIN artifacts AS down ON down.artifact_id = d.downstream_artifact_id"""


def _targets(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    old: EpisodeScriptConfirmationData,
    new: EpisodeScriptConfirmationData,
) -> tuple[ScriptImpactTargetV1, ...]:
    materialization = ImpactMaterializationBudget()
    rows = connection.execute(
        """SELECT a.project_id, a.artifact_id, a.artifact_type, a.episode_id, v.version_id
           FROM artifact_versions v JOIN artifacts a ON a.artifact_id = v.artifact_id
           WHERE a.project_id = ? ORDER BY a.artifact_id, v.version_id LIMIT 10001""",
        (old.project_id,),
    ).fetchall()
    if len(rows) > 10_000:
        raise ScriptConfirmationImpactError("Impact graph version budget exceeded")
    versions = tuple(
        ArtifactVersionIdentity(str(r["project_id"]), str(r["artifact_id"]), str(r["version_id"]))
        for r in rows
    )
    metadata = {str(r["version_id"]): r for r in rows}
    edges_rows = connection.execute(
        _EDGE_SQL
        + " WHERE up.project_id = ? OR down.project_id = ? ORDER BY d.dependency_id LIMIT 40001",
        (old.project_id, old.project_id),
    ).fetchall()
    if len(edges_rows) > 40_000:
        raise ScriptConfirmationImpactError("Impact graph edge budget exceeded")
    edges = tuple(_dependency(r, old.project_id) for r in edges_rows)
    for r in edges_rows:
        if r["upstream_version_id"] == old.version_id and r["down_episode"] != old.episode_id:
            raise ScriptConfirmationImpactError("Direct script consumer has a foreign episode")
    affected = assess_source_version_replacement(
        SourceVersionReplacementInput(
            project_id=old.project_id,
            versions=versions,
            dependencies=edges,
            artifact_id=old.artifact_id,
            old_version_id=old.version_id,
            new_version_id=new.version_id,
        )
    )
    by_edge = {e.id: e for e in edges}
    target_reasons = {
        item.version_id: tuple(
            ScriptImpactReasonV1(
                origin="EXACT_DEPENDENCY_PATH",
                effective_impact=path.effective_impact,
                edges=tuple(_edge_model(by_edge[i]) for i in path.dependency_ids),
            )
            for path in item.reason_paths
        )
        for item in affected
    }
    impacts = {item.version_id: item.aggregate_impact for item in affected}
    # Existing legacy content can truthfully refer to scripts without an explicit edge.
    assemblies = [r for r in rows if r["artifact_type"] == "episode_media_assembly"]
    if len(assemblies) > 1000:
        raise ScriptConfirmationImpactError("Legacy assembly scan count budget exceeded")
    scan_bytes = 0
    contexts = {}
    records = {}
    for row in assemblies:
        version_id = str(row["version_id"])
        size = connection.execute(
            "SELECT length(CAST(content_json AS BLOB)) FROM artifact_versions WHERE version_id = ?",
            (version_id,),
        ).fetchone()[0]
        scan_bytes += int(size)
        if scan_bytes > 32 * 1024 * 1024 or int(size) > 2_000_000:
            raise ScriptConfirmationImpactError("Legacy assembly scan byte budget exceeded")
        record = bounded_version_record(
            repository,
            connection,
            project_id=old.project_id,
            artifact_type="episode_media_assembly",
            episode_id=str(row["episode_id"]),
            version_id=version_id,
            budget=materialization,
        )
        context = immutable_consumer_context(
            repository,
            connection,
            record,
            old,
            artifact_type=str(row["artifact_type"]),
            episode_id=row["episode_id"],
            budget=materialization,
        )
        if not isinstance(context, ScriptImpactAssemblyContextV1):
            raise ScriptConfirmationImpactError("Assembly projection has wrong type")
        if context.segments and context.script_provenance is None:
            if row["episode_id"] != old.episode_id:
                raise ScriptConfirmationImpactError("Legacy script consumer has a foreign episode")
            target_reasons[version_id] = (
                *target_reasons.get(version_id, ()),
                ScriptImpactReasonV1(
                    origin="LEGACY_CONTENT_REFERENCE",
                    effective_impact="advisory",
                    edges=(),
                ),
            )
            impacts.setdefault(version_id, "advisory")
        if version_id in target_reasons:
            contexts[version_id], records[version_id] = context, record
    targets = []
    byte_budget = 0
    for version_id, reasons in target_reasons.items():
        row = metadata[version_id]
        record = records.get(version_id) or bounded_version_record(
            repository,
            connection,
            project_id=old.project_id,
            artifact_type=str(row["artifact_type"]),
            episode_id=row["episode_id"],
            version_id=version_id,
            budget=materialization,
        )
        context = contexts.get(version_id) or immutable_consumer_context(
            repository,
            connection,
            record,
            old,
            artifact_type=str(row["artifact_type"]),
            episode_id=row["episode_id"],
            budget=materialization,
        )
        size = len(canonical_content_bytes(context.model_dump(mode="json")))
        byte_budget += size
        if size > 2_000_000 or byte_budget > MAX_ASSESSMENT_BYTES:
            raise ScriptConfirmationImpactError("Impact projection budget exceeded")
        impact = impacts[version_id]
        legacy_only = all(r.origin == "LEGACY_CONTENT_REFERENCE" for r in reasons)
        targets.append(
            ScriptImpactTargetV1(
                artifact_id=str(row["artifact_id"]),
                version_id=version_id,
                artifact_type=str(row["artifact_type"]),
                episode_id=row["episode_id"],
                content_hash=record.version.content_hash,
                aggregate_impact=impact,
                classification="ADVISORY_LEGACY_REVIEW"
                if legacy_only
                else ("SOURCE_SUPERSEDED" if impact == "blocking" else "REVIEW_REQUIRED"),
                reasons=reasons,
                context=context,
            )
        )
    if len(targets) > 1000 or sum(len(t.reasons) for t in targets) > 10_000:
        raise ScriptConfirmationImpactError("Impact target/path budget exceeded")
    return tuple(sorted(targets, key=lambda target: (target.artifact_id, target.version_id)))


def record_confirmation_impact(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    *,
    project_id: str,
    episode_id: str,
    new_confirmation_id: str,
    old_confirmation_id: str | None,
) -> ScriptConfirmationImpactReportV1:
    new, coverage = _receipt(repository, connection, project_id, episode_id, new_confirmation_id)
    if coverage != 1:
        raise ScriptConfirmationImpactError("New confirmation has no impact coverage")
    old = (
        None
        if old_confirmation_id is None
        else _receipt(
            repository,
            connection,
            project_id,
            episode_id,
            old_confirmation_id,
        )[0]
    )
    kind: EventKind = (
        "BASELINE"
        if old is None
        else "SAME_SOURCE"
        if (old.version_id, old.content_hash) == (new.version_id, new.content_hash)
        else "SOURCE_REPLACED"
    )
    assessment = ScriptConfirmationImpactAssessmentV1(
        schema_version="1.0.0",
        algorithm_version=ALGORITHM,
        source_kind="EPISODE_SCRIPT_CONFIRMATION",
        project_id=project_id,
        episode_id=episode_id,
        event_kind=kind,
        old_confirmation=old,
        new_confirmation=new,
        targets=()
        if kind != "SOURCE_REPLACED" or old is None
        else _targets(repository, connection, old, new),
    )
    content = assessment.model_dump(mode="json")
    encoded = canonical_content_bytes(content)
    if len(encoded) > MAX_ASSESSMENT_BYTES:
        raise ScriptConfirmationImpactError("Confirmation impact exceeds its byte budget")
    report_id = "sci_" + uuid4().hex
    connection.execute(
        """INSERT INTO script_confirmation_impacts
           (report_id, project_id, episode_id, new_confirmation_id, old_confirmation_id,
            event_kind, assessment_hash, assessment_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            report_id,
            project_id,
            episode_id,
            new_confirmation_id,
            old_confirmation_id,
            kind,
            canonical_content_hash(content),
            encoded.decode("utf-8"),
            new.confirmed_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        ),
    )
    repository._transaction_step("script_confirmation_impact", "report_inserted")
    return _read_report(
        repository,
        connection,
        connection.execute(
            "SELECT * FROM script_confirmation_impacts WHERE report_id = ?",
            (report_id,),
        ).fetchone(),
    )


def _read_report(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    row: sqlite3.Row,
) -> ScriptConfirmationImpactReportV1:
    raw = str(row["assessment_json"])
    if len(raw.encode("utf-8")) > MAX_ASSESSMENT_BYTES:
        raise ScriptConfirmationImpactError("Stored impact byte budget exceeded")
    assessment = ScriptConfirmationImpactAssessmentV1.model_validate_json(raw)
    content = assessment.model_dump(mode="json")
    if (
        canonical_content_bytes(content).decode("utf-8") != raw
        or canonical_content_hash(content) != row["assessment_hash"]
        or assessment.project_id != row["project_id"]
        or assessment.episode_id != row["episode_id"]
        or assessment.event_kind != row["event_kind"]
        or assessment.new_confirmation.confirmation_id != row["new_confirmation_id"]
        or (assessment.old_confirmation.confirmation_id if assessment.old_confirmation else None)
        != row["old_confirmation_id"]
    ):
        raise ScriptConfirmationImpactError("Stored impact root failed integrity checks")
    new, coverage = _receipt(
        repository,
        connection,
        assessment.project_id,
        assessment.episode_id,
        str(row["new_confirmation_id"]),
    )
    if coverage != 1 or new != assessment.new_confirmation:
        raise ScriptConfirmationImpactError("Stored impact new receipt is inconsistent")
    prior = connection.execute(
        """SELECT confirmation_id FROM episode_script_confirmations
           WHERE project_id = ? AND episode_id = ? AND rowid < (
             SELECT rowid FROM episode_script_confirmations WHERE confirmation_id = ?
           ) ORDER BY rowid DESC LIMIT 1""",
        (assessment.project_id, assessment.episode_id, new.confirmation_id),
    ).fetchone()
    if (None if prior is None else prior[0]) != row["old_confirmation_id"]:
        raise ScriptConfirmationImpactError("Stored impact previous receipt is inconsistent")
    old = assessment.old_confirmation
    if (
        old is not None
        and _receipt(
            repository,
            connection,
            assessment.project_id,
            assessment.episode_id,
            old.confirmation_id,
        )[0]
        != old
    ):
        raise ScriptConfirmationImpactError("Stored impact old receipt is inconsistent")
    if sum(len(t.reasons) for t in assessment.targets) > 10_000:
        raise ScriptConfirmationImpactError("Stored impact path budget exceeded")
    materialization = ImpactMaterializationBudget()
    for target in assessment.targets:
        if old is None:
            raise ScriptConfirmationImpactError("Baseline impact cannot have consumers")
        record = bounded_version_record(
            repository,
            connection,
            project_id=assessment.project_id,
            artifact_type=target.artifact_type,
            episode_id=target.episode_id,
            version_id=target.version_id,
            budget=materialization,
        )
        if (
            record.version.artifact_id != target.artifact_id
            or record.version.content_hash != target.content_hash
            or immutable_consumer_context(
                repository,
                connection,
                record,
                old,
                artifact_type=target.artifact_type,
                episode_id=target.episode_id,
                budget=materialization,
            )
            != target.context
        ):
            raise ScriptConfirmationImpactError("Stored consumer projection is inconsistent")
        seen = set()
        weakest = {"advisory": 0, "render_only": 1, "blocking": 2}
        impacts = []
        for reason in target.reasons:
            signature = canonical_content_bytes(reason.model_dump(mode="json"))
            if signature in seen:
                raise ScriptConfirmationImpactError("Duplicate impact reason")
            seen.add(signature)
            if reason.origin == "LEGACY_CONTENT_REFERENCE":
                if (
                    not isinstance(target.context, ScriptImpactAssemblyContextV1)
                    or target.context.script_provenance is not None
                    or not target.context.segments
                    or target.episode_id != assessment.episode_id
                ):
                    raise ScriptConfirmationImpactError("Legacy reason lacks exact legacy segments")
            else:
                if reason.edges[0].downstream_version_id != target.version_id:
                    raise ScriptConfirmationImpactError("Impact path has a foreign consumer")
                if reason.edges[-1].upstream_version_id != old.version_id:
                    raise ScriptConfirmationImpactError("Impact path has a foreign source")
                for index, edge in enumerate(reason.edges):
                    actual = connection.execute(
                        _EDGE_SQL + " WHERE d.dependency_id = ?", (edge.dependency_id,)
                    ).fetchone()
                    if (
                        actual is None
                        or _edge_model(_dependency(actual, assessment.project_id)) != edge
                    ):
                        raise ScriptConfirmationImpactError(
                            "Impact path differs from its immutable edge"
                        )
                    if (
                        index
                        and reason.edges[index - 1].upstream_version_id
                        != edge.downstream_version_id
                    ):
                        raise ScriptConfirmationImpactError(
                            "Impact path endpoints are disconnected"
                        )
                    if (
                        edge.upstream_version_id == old.version_id
                        and actual["down_episode"] != old.episode_id
                    ):
                        raise ScriptConfirmationImpactError("Impact direct script scope is foreign")
                effective = min((e.impact for e in reason.edges), key=lambda i: weakest[i])
                if effective != reason.effective_impact:
                    raise ScriptConfirmationImpactError("Impact path strength is inconsistent")
            impacts.append(reason.effective_impact)
        strongest = max(impacts, key=lambda i: weakest[i])
        expected_class = (
            "ADVISORY_LEGACY_REVIEW"
            if all(r.origin == "LEGACY_CONTENT_REFERENCE" for r in target.reasons)
            else "SOURCE_SUPERSEDED"
            if strongest == "blocking"
            else "REVIEW_REQUIRED"
        )
        if strongest != target.aggregate_impact or expected_class != target.classification:
            raise ScriptConfirmationImpactError("Impact aggregate classification is inconsistent")
    created = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))
    if created != new.confirmed_at:
        raise ScriptConfirmationImpactError("Impact event time differs from its receipt")
    return ScriptConfirmationImpactReportV1(
        report_id=str(row["report_id"]),
        assessment_hash=str(row["assessment_hash"]),
        created_at=created,
        assessment=assessment,
    )


class ScriptConfirmationImpactStore:
    def __init__(self, repository: StudioRepository) -> None:
        self.repository = repository

    def _open(self) -> sqlite3.Connection:
        connection = self.repository._open()
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        return connection

    def _require_project(self, connection: sqlite3.Connection, project_id: str) -> None:
        if (
            connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone()
            is None
        ):
            raise ScriptConfirmationImpactNotFoundError("Project was not found")
        coverage = connection.execute(
            "SELECT * FROM script_confirmation_impact_coverage"
        ).fetchall()
        if len(coverage) != 1 or coverage[0]["schema_version"] != 44:
            raise ScriptConfirmationImpactError("Impact migration coverage is inconsistent")
        inconsistent = connection.execute(
            """SELECT 1 FROM episode_script_confirmations c
               LEFT JOIN script_confirmation_impacts r ON r.new_confirmation_id = c.confirmation_id
               WHERE c.project_id = ? AND (
                 (c.impact_coverage_version = 1 AND
                   (r.report_id IS NULL OR r.project_id != c.project_id
                    OR r.episode_id != c.episode_id))
                 OR (c.impact_coverage_version = 0 AND r.report_id IS NOT NULL)
               ) LIMIT 1""",
            (project_id,),
        ).fetchone()
        if inconsistent is not None:
            raise ScriptConfirmationImpactError(
                "Covered confirmation has missing or inconsistent atomic report"
            )

    def get(self, project_id: str, report_id: str) -> ScriptConfirmationImpactReportV1:
        connection = self._open()
        try:
            self._require_project(connection, project_id)
            row = connection.execute(
                "SELECT * FROM script_confirmation_impacts WHERE project_id = ? AND report_id = ?",
                (project_id, report_id),
            ).fetchone()
            if row is None:
                raise ScriptConfirmationImpactNotFoundError("Report was not found")
            return _read_report(self.repository, connection, row)
        finally:
            connection.close()

    def list_page(
        self, project_id: str, *, cursor: str | None = None, limit: int = 20
    ) -> ScriptConfirmationImpactPageData:
        if not 1 <= limit <= 50:
            raise ValueError("Invalid impact page limit")
        connection = self._open()
        try:
            self._require_project(connection, project_id)
            sequence = 2**63 - 1
            if cursor is not None:
                row = connection.execute(
                    "SELECT sequence FROM script_confirmation_impacts "
                    "WHERE project_id = ? AND report_id = ?",
                    (project_id, cursor),
                ).fetchone()
                if row is None:
                    raise ScriptConfirmationImpactNotFoundError(
                        "Exact project cursor was not found"
                    )
                sequence = int(row[0])
            rows = connection.execute(
                "SELECT * FROM script_confirmation_impacts "
                "WHERE project_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?",
                (project_id, sequence, limit + 1),
            ).fetchall()
            summaries = []
            for row in rows[:limit]:
                report = _read_report(self.repository, connection, row)
                assessment = report.assessment
                old = assessment.old_confirmation
                summaries.append(
                    ScriptConfirmationImpactSummaryV1(
                        report_id=report.report_id,
                        project_id=project_id,
                        episode_id=assessment.episode_id,
                        new_confirmation_id=assessment.new_confirmation.confirmation_id,
                        old_confirmation_id=None if old is None else old.confirmation_id,
                        new_version_id=assessment.new_confirmation.version_id,
                        old_version_id=None if old is None else old.version_id,
                        event_kind=assessment.event_kind,
                        assessment_hash=report.assessment_hash,
                        target_count=len(assessment.targets),
                        reason_path_count=sum(len(t.reasons) for t in assessment.targets),
                        segment_count=sum(
                            len(t.context.segments)
                            for t in assessment.targets
                            if isinstance(t.context, ScriptImpactAssemblyContextV1)
                        ),
                        created_at=report.created_at,
                    )
                )
            legacy_count = int(
                connection.execute(
                    "SELECT count(*) FROM episode_script_confirmations "
                    "WHERE project_id = ? AND impact_coverage_version = 0",
                    (project_id,),
                ).fetchone()[0]
            )
            return ScriptConfirmationImpactPageData(
                project_id=project_id,
                items=tuple(summaries),
                next_cursor=summaries[-1].report_id if len(rows) > limit else None,
                preexisting_confirmation_count=legacy_count,
            )
        finally:
            connection.close()

    def _lookup(
        self, connection: sqlite3.Connection, project_id: str, episode_id: str, confirmation_id: str
    ) -> ScriptConfirmationImpactLookupData:
        self._require_project(connection, project_id)
        receipt, coverage = _receipt(
            self.repository, connection, project_id, episode_id, confirmation_id
        )
        row = connection.execute(
            "SELECT * FROM script_confirmation_impacts "
            "WHERE project_id = ? AND new_confirmation_id = ?",
            (project_id, confirmation_id),
        ).fetchone()
        if coverage == 0:
            if row is not None:
                raise ScriptConfirmationImpactError(
                    "Legacy confirmation has a synthetic event report"
                )
            return ScriptConfirmationImpactLookupData(
                coverage="UNCOVERED_LEGACY", confirmation=receipt, report=None
            )
        if coverage != 1 or row is None:
            raise ScriptConfirmationImpactError("Covered confirmation is missing its atomic report")
        return ScriptConfirmationImpactLookupData(
            coverage="RECORDED",
            confirmation=receipt,
            report=_read_report(self.repository, connection, row),
        )

    def lookup(
        self, project_id: str, episode_id: str, confirmation_id: str
    ) -> ScriptConfirmationImpactLookupData:
        connection = self._open()
        try:
            return self._lookup(connection, project_id, episode_id, confirmation_id)
        finally:
            connection.close()

    def operation(
        self,
        project_id: str,
        episode_id: str,
        operation_id: str,
        payload: CreateEpisodeScriptConfirmationRequest,
        actor_id: str,
    ) -> ScriptConfirmationOperationData:
        UUID(operation_id)  # Validate without rewriting the original key bytes.
        connection = self._open()
        try:
            self._require_project(connection, project_id)
            key_hash = canonical_content_hash({"value": operation_id})
            request_hash = canonical_content_hash(
                {
                    "project_id": project_id,
                    "episode_id": episode_id,
                    "actor_id": actor_id,
                    "payload": payload.model_dump(mode="json"),
                }
            )
            row = connection.execute(
                "SELECT * FROM episode_script_confirmations "
                "WHERE project_id = ? AND episode_id = ? AND idempotency_key_hash = ?",
                (project_id, episode_id, key_hash),
            ).fetchone()
            if row is None:
                raise ScriptConfirmationImpactNotFoundError(
                    "Original operation is not yet attributable"
                )
            if row["request_hash"] != request_hash or row["actor_id"] != actor_id:
                raise ScriptConfirmationImpactError(
                    "Original operation input or trusted actor differs"
                )
            lookup = self._lookup(connection, project_id, episode_id, str(row["confirmation_id"]))
            if (
                lookup.confirmation.version_id,
                lookup.confirmation.content_hash,
                lookup.confirmation.head_revision,
            ) != (
                payload.version_id,
                payload.expected_content_hash,
                payload.expected_head_revision,
            ):
                raise ScriptConfirmationImpactError(
                    "Original operation receipt differs from full input"
                )
            return ScriptConfirmationOperationData(
                operation_id=operation_id,
                project_id=project_id,
                episode_id=episode_id,
                payload=payload,
                lookup=lookup,
            )
        finally:
            connection.close()
