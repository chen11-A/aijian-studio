"""Film model, agents, and the per-shot plan. No network."""

import json
from pathlib import Path

import pytest
from aijian_api.agent_runner import (
    offline_shots,
    prompt_version,
    run_agent,
    shots_from_director,
)
from aijian_api.film_project import (
    Shot,
    apply_agent_shots,
    empty_project,
    load_project,
    mark_user,
    migrate,
    save_project,
)
from aijian_api.model_config import (
    IMAGE_MODEL,
    IMAGE_MODEL_RETIRES_ON,
    VIDEO_DRAFT_MODEL,
    VIDEO_MODEL,
)
from aijian_api.shot_pipeline import keyframe_prompt, plan_shot, reference_url, video_prompt
from aijian_api.shot_plan import character_reference_prompt, offline_rotation, plan_shots
from aijian_api.style_bible import DEFAULT_PROMPT_ZH, PRESETS


def test_style_presets_keep_the_old_realism_line() -> None:
    names = [item.name for item in PRESETS]
    assert names[0] == "写实电影感"
    assert DEFAULT_PROMPT_ZH in names[0] or PRESETS[0].prompt_block_zh == DEFAULT_PROMPT_ZH
    assert len(names) == 8
    assert IMAGE_MODEL == "grok-imagine-image-2.0"
    assert IMAGE_MODEL_RETIRES_ON == "2026-11-02"
    assert VIDEO_MODEL == "grok-imagine-video-1.5"


def test_migration_fills_defaults_and_keeps_unknown_keys(tmp_path: Path) -> None:
    project = migrate({"title": "雾城", "future_note": "保留", "schema_version": 9})
    assert project.title == "雾城"
    assert project.scenes and project.scenes[0].title == "第 1 场"
    assert project.style.prompt_block_zh == DEFAULT_PROMPT_ZH
    assert project.extra["future_note"] == "保留"
    assert project.settings.takes_per_shot == 2
    path = tmp_path / "project.json"
    save_project(path, project)
    loaded = load_project(path)
    assert loaded.title == "雾城"
    assert loaded.extra["future_note"] == "保留"
    assert json.loads(path.read_text(encoding="utf-8"))["schema_version"] == 9


def test_a_saved_shot_keeps_a_15_second_length_and_its_fields(tmp_path: Path) -> None:
    project = migrate(
        {
            "schema_version": True,
            "preset": "古风武侠",
            "characters": [{}, {"name": "林骁", "identity": "短发", "voice_id": "leo"}],
            "scenes": [{"title": "巷口", "characters": ["林骁", 1], "tags": ["夜", None]}],
            "shots": [
                {},
                {"action": "他站住"},
                {
                    "id": "s1",
                    "picture": "雨停了",
                    "action": "抬头",
                    "performance": "眼神稳住",
                    "size": "近景",
                    "angle": "俯拍",
                    "move": "跟拍",
                    "seconds": 99,
                    "characters": ["林骁"],
                    "continuity_from_prev": True,
                },
            ],
            "takes": [{}, {"shot_id": "s1", "qc_total": True}, {"shot_id": "s1", "qc_total": 3}],
        }
    )
    assert project.schema_version == 1
    assert project.style.preset == "古风武侠"
    assert [item.name for item in project.characters] == ["林骁"]
    assert project.shots[0].picture == "他站住"
    assert project.shots[1].seconds == 15
    assert project.shots[1].performance == "眼神稳住"
    assert project.shots[1].angle == "俯拍"
    assert project.takes[0].qc_total is None
    assert project.takes[1].qc_total == 3
    assert project.shots[1].to_dict()["seconds"] == 15
    assert project.characters[0].to_dict()["name"] == "林骁"
    assert project.takes[1].to_dict()["shot_id"] == "s1"
    full = keyframe_prompt(
        "",
        style_zh="冷色",
        identity="林骁，短发",
        size="近景",
        angle="俯拍",
        move="跟拍",
        action="抬头",
        performance="眼神稳住。",
    )
    assert "动作要点抬头" in full
    assert "表演眼神稳住" in full
    assert "角度俯拍" in full
    assert "运镜跟拍" in full
    assert full.endswith("冷色。")
    assert video_prompt("抬眼", move="  ").endswith("运镜用固定。背景保持稳定。视频不要自己出声。")
    draft = empty_project()
    draft.settings.draft = True
    draft.shots = [
        Shot(id="a", scene_id="scene-1", no=1, picture="站住", action="站住", seconds=15)
    ]
    planned = plan_shot(draft, draft.shots[0], catalog={IMAGE_MODEL, VIDEO_DRAFT_MODEL})
    jobs = planned["jobs"]
    assert isinstance(jobs, list)
    assert jobs[1]["duration"] == 15
    assert jobs[1]["model"] == VIDEO_DRAFT_MODEL
    path = tmp_path / "missing" / "film.json"
    save_project(path, project)
    assert load_project(path).title


def test_agent_does_not_overwrite_a_user_field() -> None:
    project = empty_project()
    owned = Shot(
        id="scene-1-shot-1",
        scene_id="scene-1",
        no=1,
        picture="用户写的雨",
        action="用户写的雨",
        source="user",
        user_fields=["picture"],
    )
    project.shots = [owned]
    incoming = [
        Shot(
            id="scene-1-shot-1",
            scene_id="scene-1",
            no=1,
            picture="模型想改",
            action="模型想改",
            source="agent:director",
        ),
        Shot(
            id="scene-1-shot-2",
            scene_id="scene-1",
            no=2,
            picture="新镜头",
            action="新镜头",
            source="agent:director",
        ),
    ]
    apply_agent_shots(project, incoming, "scene-1")
    pictures = [shot.picture for shot in project.shots]
    assert "用户写的雨" in pictures
    assert "新镜头" in pictures
    assert "模型想改" not in pictures
    mark_user(owned, "action")
    assert "action" in owned.user_fields


def test_offline_director_uses_the_users_lines_not_the_fight_cast() -> None:
    story = "雨夜巷战\n巷口只有一个人站住。"
    shots = offline_rotation(story)
    blob = " ".join(shot.narration for shot in shots)
    assert "林夏" not in blob and "阿凯" not in blob
    assert "巷口只有一个人站住" in blob
    curated = plan_shots("雨夜巷战")
    assert any("林夏" in shot.narration for shot in curated)
    assert prompt_version("director") == 1
    assert prompt_version("writer") == 1


def test_director_repairs_once_then_reports_a_plain_reason() -> None:
    calls: list[str] = []

    def complete(text: str) -> str:
        calls.append(text)
        return "不是 JSON"

    result = run_agent("director", "画风：写实", "把这一场拆开", complete)
    assert result["ok"] is False
    assert "没有按格式" in str(result["reason"])
    assert len(calls) == 2
    assert "你是短剧导演" in calls[0]


def test_director_json_becomes_shots_and_names_only_from_the_reply() -> None:
    payload = json.dumps(
        {
            "scene_id": "scene-1",
            "rhythm": "快",
            "shots": [
                {"size": "远景", "seconds": 2, "action": "巷口积水。", "characters": ["林骁"]},
                {"size": "近景", "seconds": 3, "action": "他抬眼。", "characters": ["林骁"]},
            ],
        }
    )

    def complete(text: str) -> str:
        return payload

    result = run_agent("director", "人物：林骁", "拆开", complete)
    assert result["ok"] is True
    shots = shots_from_director(result["value"], "scene-1")
    assert [shot.picture for shot in shots] == ["巷口积水。", "他抬眼。"]
    assert shots[0].characters == ["林骁"]
    fallback = offline_shots("只有风。", "scene-1")
    assert fallback and "林夏" not in fallback[0].picture


def test_each_shot_gets_its_own_keyframe_and_unproven_refs_stay_off() -> None:
    project = empty_project(title="雨夜")
    project.characters = []
    from aijian_api.film_project import Character

    project.characters = [
        Character(id="c1", name="林骁", identity="林骁，短发，黑外套，眉上有疤"),
    ]
    project.shots = [
        Shot(
            id="a",
            scene_id="scene-1",
            no=1,
            picture="远景看巷口",
            action="远景看巷口",
            characters=["林骁"],
        ),
        Shot(
            id="b",
            scene_id="scene-1",
            no=2,
            picture="近景抬眼",
            action="近景抬眼",
            move="跟拍",
            characters=["林骁"],
        ),
    ]
    first = plan_shot(project, project.shots[0], catalog={IMAGE_MODEL, VIDEO_MODEL})
    second = plan_shot(project, project.shots[1], catalog={IMAGE_MODEL, VIDEO_MODEL})
    jobs_a = first["jobs"]
    jobs_b = second["jobs"]
    assert isinstance(jobs_a, list) and isinstance(jobs_b, list)
    still_a = str(jobs_a[0]["prompt"])
    still_b = str(jobs_b[0]["prompt"])
    assert still_a != still_b
    assert "起始画面" in still_a and "林骁，短发" in still_a
    assert "近景抬眼" in still_b
    cast = character_reference_prompt("林骁在雨里")
    assert still_a != cast
    video = jobs_b[1]
    assert video["generate_audio"] is False
    assert video["reference_images"] == []
    assert "没有可传的网址" in str(video["reference_note"])
    assert jobs_b[-1]["enabled"] is False
    assert reference_url("file:///tmp/a.png") is None
    assert reference_url("https://api.x.ai/a.png") == "https://api.x.ai/a.png"
    assert "视频不要自己出声" in video_prompt("抬眼", move="跟拍")
    bare = keyframe_prompt("抬眼")
    assert "起始画面" in bare
    assert "写实" not in bare
    wrapped = "这一镜的起始画面，不是角色定妆照。抬眼。写实电影感。"
    assert keyframe_prompt(wrapped, style_zh="写实电影感") == wrapped
    partial = "这一镜的起始画面，不是角色定妆照。抬眼。"
    assert keyframe_prompt(partial, style_zh="冷色") == f"{partial}冷色。"
    once = keyframe_prompt("抬眼", style_zh="写实电影感", size="中景", action="抬眼")
    assert once.count("这一镜的起始画面") == 1
    assert once.count("写实电影感") == 1
    assert "景别中景" in once
    assert "动作要点" not in once


def test_missing_video_model_disables_the_job() -> None:
    project = empty_project()
    project.shots = [
        Shot(id="a", scene_id="scene-1", no=1, picture="一个人站住", action="一个人站住")
    ]
    plan = plan_shot(project, project.shots[0], catalog=set())
    jobs = plan["jobs"]
    assert isinstance(jobs, list)
    assert jobs[0]["enabled"] is False
    with pytest.raises(KeyError):
        prompt_version("missing")
