"""Local shot list for a longer film. No model call and no network.

grok-imagine-video-1.5 accepts a clip of 1–15 seconds. A film of 30–60 seconds
is several of those clips, not one request. The director, action, and
performance lines are an editable draft the user can change before generating.
"""

from __future__ import annotations

from dataclasses import dataclass

MAX_CLIP_SECONDS = 15
STYLE_REALISM = "写实电影感：自然光、真实镜头、人物有重量，动作遵守重力，不要卡通，不要血腥。"
AI_GENERATED_NOTE = "画面和声音由 AI 生成，不是实拍。"

_BEATS = (
    ("全景", "平视", "慢", "叠化", "人物入画，步伐稳定", "表情平静，眼神看向前方，语速慢"),
    ("中景", "侧面", "中", "硬切", "转身，重心留在前脚", "眉头微动，视线转向同伴，语气压低"),
    ("近景", "过肩", "快", "硬切", "抬手示意，停在身侧", "眼睛睁大一点，短句，不喊叫"),
    ("中景", "低机位", "中", "叠化", "向前一步，然后停住", "呼吸可见，看着对方的眼睛"),
    ("全景", "高机位", "慢", "叠化", "两人拉开距离", "表情放松，把话说完"),
    ("近景", "平视", "慢", "硬切", "点头，手放下", "眼神稳住，语气放轻"),
    ("中景", "侧面", "中", "叠化", "回头看一眼来路", "嘴角不动，停顿一下"),
    ("全景", "平视", "慢", "叠化", "一起走向画面深处", "表情收住，不再开口"),
    ("近景", "过肩", "中", "硬切", "侧过脸，避开正对镜头", "说话前先吸气"),
    ("中景", "低机位", "慢", "叠化", "停下，站稳", "看向镜头外，语气平静"),
)

_FIGHT = (
    (
        "雨夜巷口",
        "林夏把阿凯推进巷口。",
        "全景",
        "低机位",
        "快",
        "硬切",
        "林夏从画面左侧推一把，阿凯退到墙边，两人都站着",
        "林夏咬着牙，阿凯睁大眼，短促的一句",
    ),
    (
        "躲开",
        "阿凯侧身躲开第一拳。",
        "中景",
        "侧面",
        "快",
        "硬切",
        "直拳落空，阿凯向右闪，拳风不碰到脸",
        "阿凯专注，林夏的眼神追着他",
    ),
    (
        "上步",
        "林夏踏水上步，直拳打向肩侧。",
        "中景",
        "平视",
        "快",
        "硬切",
        "上步，拳打向肩膀，不打头部",
        "林夏呼吸急，阿凯盯着来拳",
    ),
    (
        "格开",
        "阿凯格开手臂，退了半步。",
        "近景",
        "过肩",
        "中",
        "硬切",
        "小臂格挡，向后半步，脚踩在水里",
        "阿凯咬唇，林夏皱眉",
    ),
    (
        "对撞",
        "两人同时向前，肩撞在一起。",
        "中景",
        "平视",
        "快",
        "硬切",
        "肩对肩撞上，然后分开，没有倒地",
        "两人都吃痛，仍看着对方",
    ),
    (
        "低身",
        "林夏低身扫过，阿凯跳开。",
        "全景",
        "低机位",
        "快",
        "硬切",
        "低扫腿，阿凯跳起避开，落在两脚上",
        "林夏不抬头，阿凯落地时睁眼",
    ),
    (
        "对视",
        "雨更大了，他们停在对视里。",
        "近景",
        "平视",
        "慢",
        "叠化",
        "两人都放下重心，不再出招",
        "雨水顺着脸，眼神不再凶",
    ),
    (
        "离开",
        "阿凯放下手，说先离开这里。",
        "中景",
        "侧面",
        "慢",
        "叠化",
        "阿凯把手放下，林夏后退一步",
        "阿凯语气放轻，林夏点一下头",
    ),
)


@dataclass(frozen=True, slots=True)
class ShotPlan:
    index: int
    narration: str
    subtitle: str
    prompt: str
    duration_seconds: int
    shot_size: str
    camera: str
    rhythm: str
    transition: str
    action: str
    performance: str


def fight_sample() -> str:
    return "雨夜巷战\n" + "\n".join(line[1] for line in _FIGHT)


def character_reference_prompt(story: str) -> str:
    names = [name for name in ("林夏", "阿凯") if name in story]
    who = "、".join(names) if names else "这一场的人物"
    return f"{who}的角色定妆照，同一套衣服，脸部清楚，全身站在夜雨里。{STYLE_REALISM}"


def plan_shots(story: str) -> list[ShotPlan]:
    text = " ".join(story.split())
    if not text:
        raise ValueError("需要一段故事才能拆镜")
    if "雨夜巷战" in text:
        rows = [
            (title, line, size, camera, rhythm, transition, action, performance, 5)
            for title, line, size, camera, rhythm, transition, action, performance in _FIGHT
        ]
        rows[4] = (*rows[4][:8], 6)
        rows[5] = (*rows[5][:8], 6)
        return [_shot(index, row) for index, row in enumerate(rows, start=1)]
    pieces = _pieces(text)
    count = min(10, max(6, len(pieces)))
    while len(pieces) < count:
        pieces.append(pieces[-1])
    pieces = pieces[:count]
    duration = 5 if count < 10 else 5
    return [
        _shot(
            index,
            (
                f"镜头{index}",
                piece,
                *_BEATS[(index - 1) % len(_BEATS)],
                duration,
            ),
        )
        for index, piece in enumerate(pieces, start=1)
    ]


def _pieces(text: str) -> list[str]:
    cleaned = text
    for mark in "。！？；\n":
        cleaned = cleaned.replace(mark, "。")
    parts = [part.strip() for part in cleaned.split("。") if part.strip()]
    return parts or [text.strip()]


def _shot(index: int, row: tuple[object, ...]) -> ShotPlan:
    title, line, size, camera, rhythm, transition, action, performance, duration = row
    narration = str(line).strip()
    if isinstance(duration, bool) or not isinstance(duration, int):
        raise ValueError("镜头时长不对")
    seconds = max(1, min(duration, MAX_CLIP_SECONDS))
    subtitle = narration if len(narration) <= 28 else narration[:28]
    prompt = (
        f"{title}。{narration}景别{size}，机位{camera}，节奏{rhythm}，转场{transition}。"
        f"动作：{action}。表演：{performance}。{STYLE_REALISM}"
    )
    return ShotPlan(
        index=index,
        narration=narration,
        subtitle=subtitle,
        prompt=prompt,
        duration_seconds=seconds,
        shot_size=str(size),
        camera=str(camera),
        rhythm=str(rhythm),
        transition=str(transition),
        action=str(action),
        performance=str(performance),
    )
