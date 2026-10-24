"""Local film project: scenes, shots, characters, takes, style.

Files are JSON. Unknown future keys are kept. Missing keys get defaults.
A field listed in ``user_fields`` is never replaced by an agent re-run.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import cast

from aijian_api.style_bible import DEFAULT_PRESET, DEFAULT_PROMPT_ZH, preset_or_default

SCHEMA_VERSION = 1


@dataclass
class StyleBible:
    preset: str = DEFAULT_PRESET
    prompt_block_zh: str = DEFAULT_PROMPT_ZH
    prompt_block_en: str = ""
    era: str = ""
    lighting: str = ""
    lens: str = ""
    grain: str = "轻"
    aspect: str = "16:9"
    avoid: list[str] = field(default_factory=list)
    source: str = "preset"

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class Character:
    id: str
    name: str
    identity: str
    voice_id: str = "leo"
    source: str = "user"
    user_fields: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class Scene:
    id: str
    no: int
    title: str
    place: str = ""
    interior: bool = False
    time: str = "夜"
    weather: str = ""
    characters: list[str] = field(default_factory=list)
    mood: str = ""
    key_event: str = ""
    tags: list[str] = field(default_factory=list)
    text: str = ""
    source: str = "user"
    user_fields: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class Shot:
    id: str
    scene_id: str
    no: int
    size: str = "中景"
    angle: str = "平视"
    move: str = "固定"
    seconds: int = 3
    picture: str = ""
    action: str = ""
    performance: str = ""
    characters: list[str] = field(default_factory=list)
    source: str = "agent:director"
    user_fields: list[str] = field(default_factory=list)
    continuity_from_prev: bool = False

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class Take:
    id: str
    shot_id: str
    kind: str
    selected: bool = False
    status: str = "queued"
    qc_total: int | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class FilmSettings:
    takes_per_shot: int = 2
    parallelism: int = 2
    max_retry_rounds: int = 2
    draft: bool = False

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class FilmProject:
    id: str
    title: str
    style: StyleBible = field(default_factory=StyleBible)
    characters: list[Character] = field(default_factory=list)
    scenes: list[Scene] = field(default_factory=list)
    shots: list[Shot] = field(default_factory=list)
    takes: list[Take] = field(default_factory=list)
    settings: FilmSettings = field(default_factory=FilmSettings)
    schema_version: int = SCHEMA_VERSION
    extra: dict[str, object] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        body: dict[str, object] = {
            "schema_version": self.schema_version,
            "id": self.id,
            "title": self.title,
            "style": self.style.to_dict(),
            "characters": [item.to_dict() for item in self.characters],
            "scenes": [item.to_dict() for item in self.scenes],
            "shots": [item.to_dict() for item in self.shots],
            "takes": [item.to_dict() for item in self.takes],
            "settings": self.settings.to_dict(),
        }
        for key, value in self.extra.items():
            if key not in body:
                body[key] = value
        return body


def empty_project(project_id: str = "film-local", title: str = "未命名作品") -> FilmProject:
    chosen = preset_or_default(DEFAULT_PRESET)
    return FilmProject(
        id=project_id,
        title=title,
        style=StyleBible(
            preset=chosen.name,
            prompt_block_zh=chosen.prompt_block_zh,
            prompt_block_en=chosen.prompt_block_en,
            grain=chosen.grain,
            aspect=chosen.aspect,
        ),
        scenes=[
            Scene(id="scene-1", no=1, title="第 1 场", place="", time="夜", text="", source="user")
        ],
    )


def _text(value: object, fallback: str = "") -> str:
    if isinstance(value, str):
        return value
    return fallback


def _int(value: object, fallback: int, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return fallback
    return max(low, min(value, high))


def _bool(value: object, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    return fallback


def _str_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _mapping(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return cast(dict[str, object], value)
    return {}


def _style(raw: object) -> StyleBible:
    data = _mapping(raw)
    name = _text(data.get("preset"), DEFAULT_PRESET) or DEFAULT_PRESET
    chosen = preset_or_default(name)
    block = _text(data.get("prompt_block_zh"), chosen.prompt_block_zh) or chosen.prompt_block_zh
    return StyleBible(
        preset=chosen.name,
        prompt_block_zh=block,
        prompt_block_en=_text(data.get("prompt_block_en"), chosen.prompt_block_en),
        era=_text(data.get("era")),
        lighting=_text(data.get("lighting")),
        lens=_text(data.get("lens")),
        grain=_text(data.get("grain"), chosen.grain) or chosen.grain,
        aspect=_text(data.get("aspect"), chosen.aspect) or chosen.aspect,
        avoid=_str_list(data.get("avoid")),
        source=_text(data.get("source"), "preset") or "preset",
    )


def _character(raw: object, index: int) -> Character | None:
    data = _mapping(raw)
    name = _text(data.get("name")).strip()
    if not name:
        return None
    return Character(
        id=_text(data.get("id"), f"char-{index}") or f"char-{index}",
        name=name,
        identity=_text(data.get("identity")),
        voice_id=_text(data.get("voice_id"), "leo") or "leo",
        source=_text(data.get("source"), "user") or "user",
        user_fields=_str_list(data.get("user_fields")),
    )


def _scene(raw: object, index: int) -> Scene | None:
    data = _mapping(raw)
    title = _text(data.get("title")).strip() or f"第 {index} 场"
    return Scene(
        id=_text(data.get("id"), f"scene-{index}") or f"scene-{index}",
        no=_int(data.get("no"), index, 1, 99),
        title=title,
        place=_text(data.get("place")),
        interior=_bool(data.get("interior")),
        time=_text(data.get("time"), "夜") or "夜",
        weather=_text(data.get("weather")),
        characters=_str_list(data.get("characters")),
        mood=_text(data.get("mood")),
        key_event=_text(data.get("key_event")),
        tags=_str_list(data.get("tags")),
        text=_text(data.get("text")),
        source=_text(data.get("source"), "user") or "user",
        user_fields=_str_list(data.get("user_fields")),
    )


def _shot(raw: object, index: int) -> Shot | None:
    data = _mapping(raw)
    picture = _text(data.get("picture")) or _text(data.get("action"))
    if not picture.strip() and not _text(data.get("id")):
        return None
    return Shot(
        id=_text(data.get("id"), f"shot-{index}") or f"shot-{index}",
        scene_id=_text(data.get("scene_id"), "scene-1") or "scene-1",
        no=_int(data.get("no"), index, 1, 200),
        size=_text(data.get("size"), "中景") or "中景",
        angle=_text(data.get("angle"), "平视") or "平视",
        move=_text(data.get("move"), "固定") or "固定",
        seconds=_int(data.get("seconds"), 3, 1, 15),
        picture=picture,
        action=_text(data.get("action"), picture),
        performance=_text(data.get("performance")),
        characters=_str_list(data.get("characters")),
        source=_text(data.get("source"), "agent:director") or "agent:director",
        user_fields=_str_list(data.get("user_fields")),
        continuity_from_prev=_bool(data.get("continuity_from_prev")),
    )


def _take(raw: object, index: int) -> Take | None:
    data = _mapping(raw)
    shot_id = _text(data.get("shot_id"))
    if not shot_id:
        return None
    qc = data.get("qc_total")
    return Take(
        id=_text(data.get("id"), f"take-{index}") or f"take-{index}",
        shot_id=shot_id,
        kind=_text(data.get("kind"), "video") or "video",
        selected=_bool(data.get("selected")),
        status=_text(data.get("status"), "queued") or "queued",
        qc_total=qc if isinstance(qc, int) and not isinstance(qc, bool) else None,
    )


def _settings(raw: object) -> FilmSettings:
    data = _mapping(raw)
    return FilmSettings(
        takes_per_shot=_int(data.get("takes_per_shot"), 2, 1, 4),
        parallelism=_int(data.get("parallelism"), 2, 1, 4),
        max_retry_rounds=_int(data.get("max_retry_rounds"), 2, 0, 2),
        draft=_bool(data.get("draft")),
    )


_KNOWN = {
    "schema_version",
    "id",
    "title",
    "style",
    "characters",
    "scenes",
    "shots",
    "takes",
    "settings",
}


def migrate(raw: object) -> FilmProject:
    """Accept a missing or older document. Keep unknown keys."""

    data = _mapping(raw)
    version = data.get("schema_version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        version = SCHEMA_VERSION
    title = _text(data.get("title"), "未命名作品") or "未命名作品"
    project_id = _text(data.get("id"), "film-local") or "film-local"
    characters = [
        item
        for index, item in enumerate(
            (_character(row, index + 1) for index, row in enumerate(_list(data.get("characters")))),
            start=1,
        )
        if item is not None
    ]
    scenes = [
        item
        for index, item in enumerate(
            (_scene(row, index + 1) for index, row in enumerate(_list(data.get("scenes")))),
            start=1,
        )
        if item is not None
    ]
    if not scenes:
        scenes = [Scene(id="scene-1", no=1, title="第 1 场")]
    shots = [
        item
        for index, item in enumerate(
            (_shot(row, index + 1) for index, row in enumerate(_list(data.get("shots")))),
            start=1,
        )
        if item is not None
    ]
    takes = [
        item
        for index, item in enumerate(
            (_take(row, index + 1) for index, row in enumerate(_list(data.get("takes")))),
            start=1,
        )
        if item is not None
    ]
    extra = {key: value for key, value in data.items() if key not in _KNOWN}
    style = _style(data.get("style")) if "style" in data else StyleBible()
    if data.get("preset") and "style" not in data:
        style = _style({"preset": data.get("preset")})
    return FilmProject(
        id=project_id,
        title=title,
        style=style,
        characters=characters,
        scenes=scenes,
        shots=shots,
        takes=takes,
        settings=_settings(data.get("settings")),
        schema_version=version,
        extra=extra,
    )


def _list(value: object) -> list[object]:
    if isinstance(value, list):
        return cast(list[object], value)
    return []


def apply_agent_shots(project: FilmProject, incoming: list[Shot], scene_id: str) -> FilmProject:
    """Replace agent-owned shots in one scene. Keep shots the user edited."""

    kept = [
        shot
        for shot in project.shots
        if shot.scene_id != scene_id or shot.user_fields or shot.source == "user"
    ]
    locked = {shot.id for shot in kept if shot.scene_id == scene_id}
    fresh = [
        shot for shot in incoming if shot.scene_id == scene_id and shot.id not in locked
    ]
    project.shots = kept + fresh
    return project


def mark_user(shot: Shot, field_name: str) -> None:
    shot.source = "user"
    if field_name not in shot.user_fields:
        shot.user_fields.append(field_name)


def save_project(path: Path, project: FilmProject) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(project.to_dict(), ensure_ascii=False, indent=2) + "\n"
    descriptor, temporary = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.replace(temporary, path)
    except Exception:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def load_project(path: Path) -> FilmProject:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return migrate(raw)
