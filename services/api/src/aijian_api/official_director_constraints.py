"""Deterministic AI proposal constraints derived from the pinned production brief."""

from aijian_api.episode_script_contracts import EpisodeScriptContentV1
from aijian_api.official_director_contracts import OfficialDirectorContentV1
from aijian_api.production_brief import ProductionBriefContentV1
from aijian_api.shot_plan_contracts import ShotPlanIssueV1
from aijian_api.shot_plan_projection import review_capability_losses


def review_director_losses(
    content: OfficialDirectorContentV1,
    script: EpisodeScriptContentV1,
    brief: ProductionBriefContentV1,
) -> tuple[ShotPlanIssueV1, ...]:
    losses = tuple(
        ShotPlanIssueV1(
            code=loss.code,
            severity=loss.severity,
            shot_id=loss.shot_id,
            message=(
                "AI 导演意图与剧本对白引用保留在不可变提案中；人工采纳仅建立可编辑分镜版本，"
                "不表示画面、动作或声音已实现。"
                if loss.code == "MANUAL_STORYBOARD_PROJECTION"
                else loss.message
            ),
        )
        for loss in review_capability_losses(content.projection_input(), script)
    )
    rate = content.timebase.frame_rate
    delivery = brief.delivery.frame_rate
    if rate.num * delivery.den != delivery.num * rate.den:
        losses += (
            ShotPlanIssueV1(
                code="OFFICIAL_DIRECTOR_DELIVERY_RATE_MISMATCH",
                severity="BLOCKING",
                shot_id=None,
                message="提案帧率与固定制作简报交付帧率不同，不能采纳；未取整、改速或重算帧。",
            ),
        )
    duration = brief.duration_intent
    if duration.episode_mode == "per_episode" and duration.episode_seconds is not None:
        frames = sum(shot.duration_frames for shot in content.shots)
        if frames * rate.den != duration.episode_seconds * rate.num:
            losses += (
                ShotPlanIssueV1(
                    code="OFFICIAL_DIRECTOR_DURATION_INTENT_MISMATCH",
                    severity="WARNING",
                    shot_id=None,
                    message="提案总帧数与固定制作简报中明确的单集时长不同，请人工审查；未截断或改速。",
                ),
            )
    return losses
