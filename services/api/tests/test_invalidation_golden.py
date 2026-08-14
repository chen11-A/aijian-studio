"""Focused acceptance tests for the real-Gate invalidation golden fixture."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from scripts.invalidation_golden import (
    CONTROL_LABEL,
    FIXTURE_ID,
    HUMAN_LABEL,
    PATH_DIRECTION,
    SCHEMA_VERSION,
    expected_golden_operation,
    run_invalidation_golden,
    run_invalidation_golden_bytes,
)
from scripts.invalidation_golden_oracle import (
    GoldenAffectedGroup,
    GoldenPathRecord,
    serialize_golden_result,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "invalidation_golden.py"
PYTHON = sys.executable


def test_real_gate_fixture_matches_hard_coded_oracle_for_ledger_and_report() -> None:
    result = run_invalidation_golden()
    expected = expected_golden_operation()

    assert result["fixture_id"] == FIXTURE_ID
    assert result["schema_version"] == SCHEMA_VERSION
    assert result["path_direction"] == PATH_DIRECTION
    assert result["operation_count"] == 1
    assert result["affected_group_count"] == len(expected.affected_groups)
    assert result["independent_path_count"] == sum(
        len(group.paths) for group in expected.affected_groups
    )
    assert result["control_absent"] is True
    assert result["human_authored_descendants_unchanged"] is True

    for source in ("ledger", "report"):
        projection = result[source]
        assert projection["missed_invalidation_count"] == 0
        assert projection["unexpected_invalidation_count"] == 0
        assert projection["missed_invalidations"] == []
        assert projection["unexpected_invalidations"] == []
        assert projection["human_authored_descendants_unchanged"] is True
        assert projection["affected_group_count"] == result["affected_group_count"]
        assert projection["independent_path_count"] == result["independent_path_count"]
        assert CONTROL_LABEL not in json.dumps(projection, ensure_ascii=False)

    labels = {group["label"] for group in result["ledger"]["affected_groups"]}
    assert CONTROL_LABEL not in labels
    assert HUMAN_LABEL in labels
    assert "direct_v1" in labels
    assert "mixed_v1" in labels
    assert "diamond_v1" in labels


def test_diamond_multiplicity_and_impact_algebra() -> None:
    result = run_invalidation_golden()
    groups = {
        group["label"]: group for group in result["ledger"]["affected_groups"]
    }

    diamond = groups["diamond_v1"]
    assert diamond["independent_path_count"] == 2
    assert len(diamond["paths"]) == 2
    assert diamond["strongest_effective_impact"] == "blocking"
    assert diamond["general_stale"] is True
    assert diamond["general_blocked"] is True
    assert diamond["render_blocked"] is True
    effective = {path["effective_impact"] for path in diamond["paths"]}
    assert effective == {"blocking", "advisory"}

    mixed = groups["mixed_v1"]
    assert mixed["paths"][0]["impact_sequence"] == ["render_only", "blocking"]
    assert mixed["paths"][0]["effective_impact"] == "render_only"
    assert mixed["strongest_effective_impact"] == "render_only"
    assert mixed["general_stale"] is False
    assert mixed["render_blocked"] is True

    mid_b = groups["mid_b_v1"]
    assert mid_b["strongest_effective_impact"] == "advisory"
    assert mid_b["general_stale"] is False
    assert mid_b["general_blocked"] is False
    assert mid_b["render_blocked"] is False

    direct = groups["direct_v1"]
    assert direct["paths"][0]["path_labels"] == ["direct_v1", "root_v1"]
    assert direct["paths"][0]["effective_impact"] == "blocking"


def test_expected_oracle_encodes_two_path_diamond_and_all_impact_classes() -> None:
    expected = expected_golden_operation()
    by_label = {group.label: group for group in expected.affected_groups}

    diamond = by_label["diamond_v1"]
    assert isinstance(diamond, GoldenAffectedGroup)
    assert diamond.independent_path_count == 2
    assert {path.effective_impact for path in diamond.paths} == {"blocking", "advisory"}

    impacts: set[str] = set()
    for group in expected.affected_groups:
        for path in group.paths:
            assert isinstance(path, GoldenPathRecord)
            impacts.update(path.impact_sequence)
            assert path.path_labels[0] == group.label
            assert path.path_labels[-1] == "root_v1"
    assert impacts == {"blocking", "render_only", "advisory"}
    assert CONTROL_LABEL not in by_label


def test_two_independent_runs_serialize_to_identical_bytes() -> None:
    first = run_invalidation_golden_bytes()
    second = run_invalidation_golden_bytes()
    assert first == second
    assert first == serialize_golden_result(run_invalidation_golden())
    assert first.endswith(b"\n")
    assert not first.endswith(b"\n\n")
    text = first.decode("utf-8")
    assert text.startswith("{\n")
    assert "workspace.db" not in text
    assert "aijian-invalidation-golden-" not in text


def test_cli_stdout_and_output_file_bytes_match(tmp_path: Path) -> None:
    output_path = tmp_path / "golden.json"
    stdout_proc = subprocess.run(
        [PYTHON, str(SCRIPT_PATH)],
        check=False,
        capture_output=True,
        cwd=str(REPO_ROOT),
    )
    assert stdout_proc.returncode == 0, stdout_proc.stderr.decode("utf-8", errors="replace")
    stdout_bytes = stdout_proc.stdout
    assert stdout_bytes.endswith(b"\n")
    assert stdout_bytes == run_invalidation_golden_bytes()

    file_proc = subprocess.run(
        [PYTHON, str(SCRIPT_PATH), "--output", str(output_path)],
        check=False,
        capture_output=True,
        cwd=str(REPO_ROOT),
    )
    assert file_proc.returncode == 0, file_proc.stderr.decode("utf-8", errors="replace")
    assert file_proc.stdout == b""
    file_bytes = output_path.read_bytes()
    assert file_bytes == stdout_bytes
    assert file_bytes.endswith(b"\n")
    assert file_bytes.count(b"\n") >= 1


def test_cli_requires_no_network_and_is_hermetic() -> None:
    proc = subprocess.run(
        [PYTHON, str(SCRIPT_PATH)],
        check=False,
        capture_output=True,
        cwd=str(REPO_ROOT),
    )
    assert proc.returncode == 0, proc.stderr.decode("utf-8", errors="replace")
    payload = json.loads(proc.stdout.decode("utf-8"))
    assert payload["fixture_id"] == FIXTURE_ID
    assert payload["operation_count"] == 1
    assert "http://" not in proc.stdout.decode("utf-8")
    assert "https://" not in proc.stdout.decode("utf-8")
