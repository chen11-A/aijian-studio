"""Atomic explicit adoption of immutable model text into an editable script draft."""

from __future__ import annotations

from uuid import NAMESPACE_URL, uuid5

from aijian_api.artifacts import canonical_content_bytes
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_script_contracts import MAX_SCRIPT_BYTES, EpisodeScriptContentV1
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.official_text_contracts import AdoptOfficialTextRequest, OfficialTextOperation
from aijian_api.official_text_store import OfficialTextError, OfficialTextStore, timestamp


def adopt_text(
    store: OfficialTextStore,
    project: str,
    episode: str,
    operation_id: str,
    payload: AdoptOfficialTextRequest,
    actor_id: str,
) -> tuple[OfficialTextOperation, bool]:
    with store.connection(write=True) as connection:
        operation = store.read_in_connection(connection, project, episode, operation_id)
        proposal = operation.proposal
        if (
            proposal is None
            or proposal.version_id != payload.proposal_version_id
            or proposal.content_hash != payload.proposal_content_hash
        ):
            raise OfficialTextError("OFFICIAL_TEXT_PROPOSAL_MISMATCH")
        if operation.adoption:
            return operation, True
        base = store.script_base(connection, project, episode, operation.request.base)
        content = EpisodeScriptContentV1.model_validate(
            base.version.content
            if base
            else {
                "schema_version": "1.0.0",
                "project_id": project,
                "episode_id": episode,
                "scenes": [],
            }
        ).model_dump(mode="json")
        if len(content["scenes"]) >= 1_000:
            raise OfficialTextError("OFFICIAL_TEXT_SCRIPT_FULL", 422)
        # Keep bytes/whitespace exactly; split only to satisfy the existing block size bound.
        text = proposal.result.text
        chunks = [text[index : index + 20_000] for index in range(0, len(text), 20_000)]
        if any(not chunk.strip() for chunk in chunks):
            raise OfficialTextError("OFFICIAL_TEXT_UNSUPPORTED_TEXT_LAYOUT", 422)
        content["scenes"].append(
            {
                "scene_id": "scn_"
                + uuid5(NAMESPACE_URL, f"official-text:{operation_id}:scene").hex,
                "ordinal": len(content["scenes"]) + 1,
                "heading": "ChatGPT 文本建议（待人工编排）",
                "blocks": [
                    {
                        "block_id": "sblk_"
                        + uuid5(NAMESPACE_URL, f"official-text:{operation_id}:block:{index}").hex,
                        "ordinal": index + 1,
                        "kind": "ACTION",
                        "text": chunk,
                        "speaker": None,
                        "delivery": None,
                    }
                    for index, chunk in enumerate(chunks)
                ],
            }
        )
        content = EpisodeScriptContentV1.model_validate(content).model_dump(mode="json")
        if len(canonical_content_bytes(content)) > MAX_SCRIPT_BYTES:
            raise OfficialTextError("OFFICIAL_TEXT_SCRIPT_FULL", 422)
        script_store = EpisodeScriptStore(store.repository)

        def verify(candidate: ArtifactVersionRecord) -> None:
            script_store._verified_version_data(
                candidate, project_id=project, episode_id=episode, connection=connection
            )

        record = store.repository.create_artifact_version(
            project_id=project,
            episode_id=episode,
            artifact_type="episode_script",
            schema_version="1.0.0",
            content=content,
            author_actor_type="human",
            author_actor_id=actor_id,
            change_summary=f"采纳官方文本建议 {operation_id}",
            parent_version_id=base.version.id if base else None,
            expected_revision=operation.request.base.head_revision
            if operation.request.base
            else None,
            dependencies=tuple(
                ArtifactDependencyDraft(
                    upstream_version_id=version, relationship="derived_from", impact="blocking"
                )
                for version in (
                    content["production_brief_version_id"],
                    content["story_bible_version_id"],
                    content["source_extraction_version_id"],
                )
                if version is not None
            ),
            record_validator=verify,
            _transaction_connection=connection,
            _manage_transaction=False,
        )
        connection.execute(
            """INSERT INTO official_text_adoptions(operation_id, proposal_version_id,
            proposal_content_hash, script_version_id, script_content_hash, actor_id, adopted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                operation_id,
                proposal.version_id,
                proposal.content_hash,
                record.version.id,
                record.version.content_hash,
                actor_id,
                timestamp(),
            ),
        )
        return store.read_in_connection(connection, project, episode, operation_id), False
