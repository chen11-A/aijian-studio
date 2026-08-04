import json
from pathlib import Path

from scripts.check_python_coverage import coverage_percentages, main


def write_report(
    path: Path,
    *,
    statements: int = 100,
    missing_lines: int = 5,
    branches: int = 100,
    covered_branches: int = 84,
) -> None:
    path.write_text(
        json.dumps(
            {
                "totals": {
                    "num_statements": statements,
                    "missing_lines": missing_lines,
                    "num_branches": branches,
                    "covered_branches": covered_branches,
                }
            }
        ),
        encoding="utf-8",
    )


def test_coverage_gate_calculates_line_and_branch_independently(tmp_path: Path) -> None:
    report = tmp_path / "coverage.json"
    write_report(report)

    assert coverage_percentages(report) == (95.0, 84.0)
    assert main([str(report)]) == 0


def test_coverage_gate_rejects_each_threshold_independently(tmp_path: Path) -> None:
    low_line = tmp_path / "low-line.json"
    write_report(low_line, missing_lines=11)
    assert main([str(low_line)]) == 1

    low_branch = tmp_path / "low-branch.json"
    write_report(low_branch, covered_branches=83)
    assert main([str(low_branch)]) == 1


def test_coverage_gate_rejects_malformed_or_inconsistent_reports(tmp_path: Path) -> None:
    malformed = tmp_path / "malformed.json"
    malformed.write_text("{}", encoding="utf-8")
    assert main([str(malformed)]) == 2

    inconsistent = tmp_path / "inconsistent.json"
    write_report(inconsistent, missing_lines=101)
    assert main([str(inconsistent)]) == 2

    assert main([]) == 2
