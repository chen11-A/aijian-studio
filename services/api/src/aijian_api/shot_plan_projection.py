"""Loss-aware mapping into the existing integer-rate manual storyboard contract.

The immutable proposal retains every typed intention and block reference. The
V1 storyboard is an editable projection, never proof of generated media.
"""

import sqlite3
from typing import Literal

from aijian_api.artifacts import canonical_content_bytes
from aijian_api.episode_script_contracts import EpisodeScriptContentV1
from aijian_api.episode_storyboard_contracts import (
    MAX_STORYBOARD_BYTES,
    EpisodeStoryboardContent,
    EpisodeStoryboardContentV1,
    EpisodeStoryboardContentV2,
    EpisodeStoryboardShotV1,
)
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.repository import StudioRepository
from aijian_api.shot_plan_contracts import (
    ShotPlanContentV1,
    ShotPlanIssueV1,
    ShotPlanStoryboardBase,
)


def projection_schema_for_base(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    project: str,
    episode: str,
    base: ShotPlanStoryboardBase | None,
) -> Literal["1.0.0", "1.1.0"]:
    if base is None:
        return "1.0.0"
    record = repository._get_artifact_version_in_connection(
        connection,
        project_id=project,
        artifact_type="episode_storyboard",
        version_id=base.version_id,
        episode_id=episode,
    )
    content = (
        EpisodeStoryboardStore(repository)
        ._verified_version_data(
            record,
            project_id=project,
            episode_id=episode,
            connection=connection,
        )
        .content
    )
    if content.schema_version == "1.2.0":
        raise ValueError("A visual pin must not be silently discarded by whole-board projection")
    if content.schema_version in ("1.3.0", "1.4.0", "1.5.0"):
        raise ValueError("Whole-board projection cannot discard planning intent or visual basis")
    if content.schema_version == "1.1.0" and any(shot.character_bindings for shot in content.shots):
        raise ValueError("Whole-storyboard projection cannot silently remove character choices")
    return "1.1.0" if content.schema_version == "1.1.0" else "1.0.0"


def capability_losses(content: ShotPlanContentV1) -> tuple[ShotPlanIssueV1, ...]:
    losses = [
        ShotPlanIssueV1(
            code="MANUAL_STORYBOARD_PROJECTION",
            severity="WARNING",
            shot_id=None,
            message="人工导演意图和台词引用保留在提案中；分镜投影不表示画面、动作或声音已实现。",
        )
    ]
    if content.timebase.frame_rate.den != 1:
        losses.append(
            ShotPlanIssueV1(
                code="FRACTIONAL_STORYBOARD_TIMEBASE",
                severity="BLOCKING",
                shot_id=None,
                message="当前分镜 V1 仅支持整数帧率；此有理帧率不能采纳，未进行取整或改速。",
            )
        )
    return tuple(losses)


def project_storyboard(
    content: ShotPlanContentV1,
    script: EpisodeScriptContentV1,
    *,
    target_schema: Literal["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"] = "1.0.0",
) -> EpisodeStoryboardContent:
    if target_schema == "1.2.0":
        raise ValueError("Whole-board projection cannot discard an explicit G5 pin")
    if target_schema in ("1.3.0", "1.4.0", "1.5.0"):
        raise ValueError("Whole-board projection cannot discard planning intent or visual basis")
    if any(loss.severity == "BLOCKING" for loss in capability_losses(content)):
        raise ValueError("The existing storyboard cannot represent this timebase")
    blocks = {block.block_id: block for scene in script.scenes for block in scene.blocks}
    shots = []
    for shot in content.shots:
        description = "\n".join(
            (
                f"叙事目的：{shot.narrative_purpose}",
                f"覆盖用途：{', '.join(shot.coverage)}",
                f"构图：{shot.composition}",
                f"主体运动：{shot.movement.subject}",
                f"环境运动：{shot.movement.environment}",
                f"起始状态：{shot.start_state}",
                f"结束状态：{shot.end_state}",
                f"节奏：{shot.rhythm}",
                f"声音意图（未生成声音）：{shot.sound_intent}",
                f"手柄：{shot.handle_in_frames}/{shot.handle_out_frames} 帧；安全切区："
                f"[{shot.safe_cut_window.start_frame}, {shot.safe_cut_window.end_frame})",
            )
        )
        dialogue = "\n".join(
            f"{blocks[block_id].speaker}：{blocks[block_id].text}"
            for block_id in shot.dialogue_block_ids
        )
        shots.append(
            EpisodeStoryboardShotV1(
                shot_id=shot.shot_id,
                ordinal=shot.ordinal,
                duration_frames=shot.duration_frames,
                title=shot.title,
                description=description,
                action=shot.performance,
                dialogue=dialogue,
                camera=f"{shot.framing} · {shot.movement.camera}",
                script_scene_id=shot.script_scene_id,
                character_ids=(),
                location_id=None,
            )
        )
    result = EpisodeStoryboardContentV1(
        schema_version="1.0.0",
        project_id=content.project_id,
        episode_id=content.episode_id,
        fps=content.timebase.frame_rate.num,
        script_version_id=content.authority.script.version_id,
        creative_library_version_id=None,
        shots=tuple(shots),
    )
    if target_schema == "1.0.0":
        return result
    value = result.model_dump(mode="json")
    value["schema_version"] = "1.1.0"
    value["shots"] = [{**shot, "character_bindings": []} for shot in value["shots"]]
    return EpisodeStoryboardContentV2.model_validate(value)


def review_capability_losses(
    content: ShotPlanContentV1,
    script: EpisodeScriptContentV1,
) -> tuple[ShotPlanIssueV1, ...]:
    losses = capability_losses(content)
    if not any(loss.severity == "BLOCKING" for loss in losses):
        try:
            projected = project_storyboard(content, script)
            if (
                len(canonical_content_bytes(projected.model_dump(mode="json")))
                > MAX_STORYBOARD_BYTES
            ):
                raise ValueError("Projection exceeds storyboard byte limit")
        except ValueError:
            losses += (
                ShotPlanIssueV1(
                    code="STORYBOARD_PROJECTION_LIMIT",
                    severity="BLOCKING",
                    shot_id=None,
                    message="完整导演意图或对白超过当前分镜字段或文件限制；请修订，未截断内容。",
                ),
            )
    return losses
