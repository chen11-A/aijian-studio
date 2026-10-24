"""Run one agent against an injected text function. No network in this module.

The text function is the signed-in model. Tests pass a fake. A bad JSON reply
is asked to repair once. After that the caller keeps the offline draft.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path

from aijian_api.film_project import Shot
from aijian_api.shot_plan import offline_rotation

AGENTS = ("writer", "director", "action", "performance", "art", "prompter", "qc")
_PROMPTS = Path(__file__).parent / "agents" / "prompts"
_VERSION = re.compile(r"^agent_version:\s*(\d+)\s*$", re.MULTILINE)


def prompt_path(agent_id: str) -> Path:
    if agent_id not in AGENTS:
        raise KeyError(agent_id)
    return _PROMPTS / f"{agent_id}.md"


def prompt_text(agent_id: str) -> str:
    return prompt_path(agent_id).read_text(encoding="utf-8")


def prompt_version(agent_id: str) -> int:
    match = _VERSION.search(prompt_text(agent_id))
    if match is None:
        raise ValueError(f"{agent_id} 的提示词没有版本号")
    return int(match.group(1))


def parse_json(text: str) -> object | None:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        start = raw.find("[")
        end = raw.rfind("]")
    if start < 0 or end <= start:
        return None
    try:
        value: object = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return None
    return value


def _problems(agent_id: str, value: object) -> list[str]:
    if agent_id == "director":
        if not isinstance(value, dict):
            return ["导演结果必须是一个 JSON 对象"]
        shots = value.get("shots")
        if not isinstance(shots, list) or not shots:
            return ["导演结果里没有镜头"]
        if not any(_shot_text(item) for item in shots if isinstance(item, dict)):
            return ["镜头里没有画面描述"]
        return []
    if agent_id == "writer":
        if not isinstance(value, dict) or not isinstance(value.get("scenes"), list):
            return ["编剧结果里没有场次"]
        return []
    if agent_id in {"action", "performance", "art", "prompter", "qc"}:
        if isinstance(value, dict | list):
            return []
        return ["结果不是 JSON"]
    return ["没有这个智能体"]


def _shot_text(item: dict[str, object]) -> str:
    for key in ("action", "picture", "narration", "description"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def shots_from_director(value: object, scene_id: str) -> list[Shot]:
    if not isinstance(value, dict):
        return []
    rows = value.get("shots")
    if not isinstance(rows, list):
        return []
    shots: list[Shot] = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        text = _shot_text(row)
        if not text:
            continue
        seconds = row.get("seconds")
        whole = seconds if isinstance(seconds, int) and not isinstance(seconds, bool) else 3
        names = row.get("characters")
        characters = (
            [item for item in names if isinstance(item, str)] if isinstance(names, list) else []
        )
        shots.append(
            Shot(
                id=str(row.get("id") or f"{scene_id}-shot-{index}"),
                scene_id=str(row.get("scene_id") or scene_id),
                no=index,
                size=str(row.get("size") or "中景"),
                angle=str(row.get("angle") or "平视"),
                move=str(row.get("move") or "固定"),
                seconds=max(1, min(int(whole), 15)),
                picture=text,
                action=text,
                characters=characters,
                source="agent:director",
                continuity_from_prev=row.get("continuity_from_prev") is True,
            )
        )
    return shots


def offline_shots(story: str, scene_id: str) -> list[Shot]:
    """Rotation table. Names come only from the user's lines."""

    planned = offline_rotation(story)
    return [
        Shot(
            id=f"{scene_id}-shot-{item.index}",
            scene_id=scene_id,
            no=item.index,
            size=item.shot_size,
            angle=item.camera,
            move="固定",
            seconds=min(item.duration_seconds, 5),
            picture=item.narration,
            action=item.action,
            performance=item.performance,
            source="offline:director",
        )
        for item in planned
    ]


def build_request(agent_id: str, context: str, user: str) -> str:
    system = prompt_text(agent_id).strip()
    body = f"{system}\n\n上下文：\n{context.strip()}\n\n用户：\n{user.strip()}"
    if len(body) > 7500:
        body = body[:7500]
    return body


def run_agent(
    agent_id: str,
    context: str,
    user: str,
    complete: Callable[[str], str],
) -> dict[str, object]:
    """Call ``complete`` at most twice. Never raises for a bad model reply."""

    version = prompt_version(agent_id)
    request = build_request(agent_id, context, user)
    reply = complete(request)
    value = parse_json(reply)
    problems = _problems(agent_id, value)
    if problems:
        repair = f"{request}\n\n上次输出不能用：{'；'.join(problems)}。只输出 JSON，不要解释。"
        if len(repair) > 7500:
            repair = repair[:7500]
        reply = complete(repair)
        value = parse_json(reply)
        problems = _problems(agent_id, value)
    if problems or value is None:
        return {
            "ok": False,
            "agent": agent_id,
            "agent_version": version,
            "reason": "模型没有按格式返回，已保留离线结果。"
            if agent_id == "director"
            else "模型没有按格式返回，这次没有改作品。",
            "value": None,
        }
    return {"ok": True, "agent": agent_id, "agent_version": version, "reason": "", "value": value}
