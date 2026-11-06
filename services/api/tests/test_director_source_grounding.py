"""Source-order instructions are bounded claims, not live-provider verification."""

from pathlib import Path

from aijian_api.agent_runner import prompt_text, prompt_version


def test_director_requires_event_evidence_not_just_an_existing_prop() -> None:
    text = prompt_text("director")
    assert prompt_version("director") == 4
    assert "原文是情节事实的唯一来源" in text
    assert "不等于允许新造与它有关的事件" in text
    assert "不能在后面的打斗中重演或倒插" in text
    assert "不得用来源段号存在冒充该情节已经核实" in text


def test_supplied_novel_has_a_van_but_not_the_reported_parking_sentence() -> None:
    root = Path(__file__).resolve().parents[3]
    text = (root / "packages/aivora-prompts/fixtures/test-novel-2000.txt").read_text(
        encoding="utf-8"
    )
    assert "沈砚开着书店那辆旧面包车，一路跟了过来。" in text
    assert "面包车停在仓库外" not in text
