"""Per-shot still, then image-to-video. This module only plans jobs.

It does not call the network. Unproven subscription features are omitted and
the job carries a plain reason.
"""

from __future__ import annotations

from aijian_api.film_project import FilmProject, Shot
from aijian_api.model_config import IMAGE_MODEL, VIDEO_DRAFT_MODEL, VIDEO_MODEL

REFERENCE_REASON = "定妆照在本机，没有可传的网址。这一镜把外貌写进提示词，不附参考图。"
QC_REASON = "审片要看画面。会员登录还没验证这项，先由你选版本。"
EDIT_REASON = "当前登录看不到 grok-imagine-video，不能改画面细节，也不能从片尾往后接。"


def keyframe_prompt(
    picture: str,
    *,
    style_zh: str = "",
    identity: str = "",
    size: str = "",
    angle: str = "",
    move: str = "",
    action: str = "",
    performance: str = "",
) -> str:
    """Wrap a shot once. An empty style stays empty; 写实 is not filled in."""

    text = picture.strip()
    style = style_zh.strip().rstrip("。")
    if text.startswith("这一镜的起始画面"):
        if style and style not in text:
            base = text if text.endswith("。") else f"{text}。"
            return _with_identity_lock(f"{base}{style}。", identity)
        return _with_identity_lock(text if text.endswith("。") else f"{text}。", identity)
    bits = ["这一镜的起始画面，不是角色定妆照"]
    if identity.strip():
        bits.append(identity.strip().rstrip("。"))
    if text:
        bits.append(text.rstrip("。"))
    if size.strip():
        bits.append(f"景别{size.strip()}")
    if angle.strip():
        bits.append(f"角度{angle.strip()}")
    if move.strip():
        bits.append(f"运镜{move.strip()}")
    action_text = action.strip().rstrip("。")
    if action_text and action_text != text.rstrip("。") and not _is_beat_list(action_text):
        bits.append(f"动作要点{action_text}")
    performance_text = performance.strip().rstrip("。")
    if performance_text and not _is_beat_list(performance_text):
        bits.append(f"表演{performance_text}")
    joined = "。".join(bit for bit in bits if bit)
    if style and style not in joined:
        joined = f"{joined}。{style}" if joined else style
    return _with_identity_lock(f"{joined}。", identity)


def _with_identity_lock(text: str, identity: str) -> str:
    lock = identity.strip()
    if not lock:
        return text
    if not lock.endswith("。"):
        lock = f"{lock}。"
    if lock in text:
        return text
    base = text if text.endswith("。") else f"{text}。"
    return f"{base}{lock}"


def _is_beat_list(text: str) -> bool:
    return "时长" in text and "镜头" in text


def video_prompt(picture: str, *, move: str = "固定", line: str = "") -> str:
    motion = picture.strip().rstrip("。")
    camera = move.strip() or "固定"
    spoken = f"台词原句：「{line.strip()}」。不要背景音乐。" if line.strip() else ""
    return (
        f"从这张起始画面开始。{motion}。只做这一个动作，运镜用{camera}。"
        f"背景保持稳定。视频不要自己出声。{spoken}"
    )


def missing_identity_locks(prompt: str, identities: list[str]) -> list[str]:
    """Shots whose prompt dropped a fixed appearance sentence."""

    missing: list[str] = []
    for raw in identities:
        lock = raw.strip()
        if not lock:
            continue
        if not lock.endswith("。"):
            lock = f"{lock}。"
        if lock not in prompt:
            missing.append(lock)
    return missing


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
    still = keyframe_prompt(
        shot.picture or shot.action,
        style_zh=style,
        identity=who,
        size=shot.size,
        angle=shot.angle,
        move=shot.move,
        action=shot.action,
        performance=shot.performance,
    )
    motion = video_prompt(shot.picture or shot.action, move=shot.move)
    video_model = VIDEO_DRAFT_MODEL if project.settings.draft else VIDEO_MODEL
    image_ready = ids is None or IMAGE_MODEL in ids
    video_ready = ids is None or video_model in ids
    takes = project.settings.takes_per_shot
    request_seconds = max(1, min(int(shot.seconds), 15))
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
