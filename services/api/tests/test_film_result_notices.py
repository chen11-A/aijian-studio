"""Result fallback copy preserves complete diagnostics outside the short display message."""

from dataclasses import replace

import pytest
from aijian_api.story_film import FilmStatus, StoryFilmResult
from aijian_api.story_film_routes import _data


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("SUCCEEDED", "试做版已经保存，可以在播放器里打开看看。"),
        ("BLOCKED", "这一片被拦下了，没有生成。"),
        ("FAILED", "这一片没做成，可以再试一次。"),
    ],
)
def test_film_result_uses_short_approved_copy(status: FilmStatus, expected: str) -> None:
    detail = "完整原因与下一步。" * 12
    result = StoryFilmResult(
        status=status,
        message=detail,
        provider_label="会员",
        billing_label="会员额度",
        suggested_provider=None,
        fix=None,
        task_id=None,
        attempt_id=None,
        artifact_version_id=None,
        output_path=None,
        output_sha256=None,
        duration_seconds=None,
        has_video=False,
        has_audio=False,
        draft=True,
        live_call=False,
    )
    assert _data(result).user_message == {
        "code": f"FILM_{status}",
        "text": expected,
        "detail": detail,
    }
    explicit = {"code": "MULTI_VOICE_REQUIRED", "text": "先拆分配音。"}
    assert _data(replace(result, user_message=explicit)).user_message == explicit
