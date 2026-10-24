"""Per-shot still, then image-to-video. This module only plans jobs.

It does not call the network. Unproven subscription features are omitted and
the job carries a plain reason.
"""

from __future__ import annotations

from aijian_api.film_project import FilmProject, Shot
from aijian_api.model_config import IMAGE_MODEL, VIDEO_DRAFT_MODEL, VIDEO_MODEL
from aijian_api.style_bible import DEFAULT_PROMPT_ZH

REFERENCE_REASON = "定妆照在本机，没有可传的网址。这一镜把外貌写进提示词，不附参考图。"
QC_REASON = "审片要看画面。会员登录还没验证这项，先由你选版本。"
EDIT_REASON = "当前登录看不到 grok-imagine-video，不能改画面细节，也不能从片尾往后接。"


def keyframe_prompt(picture: str, *, style_zh: str = "", identity: str = "") -> str:
    style = (style_zh or DEFAULT_PROMPT_ZH).strip().rstrip("。")
    bits = ["这一镜的起始画面，不是角色定妆照"]
    if identity.strip():
        bits.append(identity.strip().rstrip("。"))
    bits.append(picture.strip().rstrip("。"))
    bits.append(style)
    return "。".join(bit for bit in bits if bit) + "。"


def video_prompt(picture: str, *, move: str = "固定") -> str:
    motion = picture.strip().rstrip("。")
    camera = move.strip() or "固定"
    return (
        f"从这张起始画面开始。{motion}。只做这一个动作，运镜用{camera}。"
        "背景保持稳定。视频不要自己出声。"
    )


def identities(project: FilmProject, shot: Shot) -> str:
    wanted = set(shot.characters)
    lines = [
        character.identity.strip()
        for character in project.characters
        if character.identity.strip() and (not wanted or character.name in wanted)
    ]
    if not lines and not wanted:
        lines = [
            character.identity.strip()
            for character in project.characters
            if character.identity.strip()
        ]
    return "。".join(lines)


def reference_url(source: str | None) -> str | None:
    if isinstance(source, str) and source.startswith("https://"):
        return source
    return None


def plan_shot(
    project: FilmProject, shot: Shot, *, catalog: set[str] | None = None
) -> dict[str, object]:
    ids = catalog
    style = project.style.prompt_block_zh
    who = identities(project, shot)
    still = keyframe_prompt(shot.picture or shot.action, style_zh=style, identity=who)
    motion = video_prompt(shot.picture or shot.action, move=shot.move)
    video_model = VIDEO_DRAFT_MODEL if project.settings.draft else VIDEO_MODEL
    image_ready = ids is None or IMAGE_MODEL in ids
    video_ready = ids is None or video_model in ids
    takes = project.settings.takes_per_shot
    request_seconds = max(shot.seconds, min(shot.seconds + 1, 15))
    jobs: list[dict[str, object]] = [
        {
            "kind": "keyframe",
            "shot_id": shot.id,
            "model": IMAGE_MODEL,
            "prompt": still,
            "enabled": image_ready,
            "reason": "" if image_ready else f"模型列表里没有 {IMAGE_MODEL}，先不生成起始画面。",
        }
    ]
    for index in range(1, takes + 1):
        jobs.append(
            {
                "kind": "video",
                "shot_id": shot.id,
                "take": index,
                "model": video_model,
                "prompt": motion,
                "image": "keyframe",
                "duration": request_seconds,
                "generate_audio": False,
                "reference_images": [],
                "enabled": video_ready and image_ready,
                "reason": ""
                if video_ready and image_ready
                else f"需要 {video_model}，并且先有这一镜自己的起始画面。",
                "reference_note": REFERENCE_REASON,
            }
        )
    jobs.append(
        {
            "kind": "qc",
            "shot_id": shot.id,
            "enabled": False,
            "reason": QC_REASON,
        }
    )
    return {
        "shot_id": shot.id,
        "parallelism": project.settings.parallelism,
        "max_retry_rounds": project.settings.max_retry_rounds,
        "edit_reason": EDIT_REASON,
        "jobs": jobs,
    }
