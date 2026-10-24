"""Shot lists stay local. These tests do not call a model."""

import pytest
from aijian_api.shot_plan import (
    MAX_CLIP_SECONDS,
    fight_sample,
    plan_shots,
)


def test_a_story_becomes_six_to_ten_shots_inside_half_a_minute_to_a_minute():
    shots = plan_shots("雾还没散。灯塔亮着。她没有回头。")
    assert 6 <= len(shots) <= 10
    total = sum(shot.duration_seconds for shot in shots)
    assert 30 <= total <= 60
    assert all(1 <= shot.duration_seconds <= MAX_CLIP_SECONDS for shot in shots)
    assert all(shot.shot_size and shot.camera and shot.rhythm and shot.transition for shot in shots)
    assert all(shot.action and shot.performance for shot in shots)


def test_changed_story_text_changes_the_shot_narration():
    first = plan_shots("雾散之前，不要回头。")
    second = plan_shots("天亮以后，再往前走。")
    assert [shot.narration for shot in first] != [shot.narration for shot in second]


def test_fight_sample_is_about_forty_five_seconds_and_names_both_people():
    script = fight_sample()
    shots = plan_shots(script)
    assert "林夏" in script and "阿凯" in script
    assert len(shots) == 8
    total = sum(shot.duration_seconds for shot in shots)
    assert 40 <= total <= 50
    assert any("拳" in shot.action or "肩" in shot.action for shot in shots)
    assert all("血腥" not in shot.action for shot in shots)


def test_empty_story_is_refused():
    with pytest.raises(ValueError, match="故事"):
        plan_shots("   ")
