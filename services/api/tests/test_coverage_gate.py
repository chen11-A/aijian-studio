import json
from pathlib import Path

from scripts.check_python_coverage import (
    CRITICAL_FULL_COVERAGE_MODULES,
    coverage_percentages,
    main,
)

CRITICAL_MODULES = CRITICAL_FULL_COVERAGE_MODULES


def write_report(
    path: Path,
    *,
    statements: int = 100,
    missing_lines: int = 5,
    branches: int = 100,
    covered_branches: int = 84,
    branch_coverage: bool = True,
    critical_covered: bool = True,
) -> None:
    critical_summary = {
        "num_statements": 10,
        "missing_lines": 0 if critical_covered else 1,
        "num_branches": 4,
        "covered_branches": 4,
    }
    path.write_text(
        json.dumps(
            {
                "meta": {"branch_coverage": branch_coverage},
                "totals": {
                    "num_statements": statements,
                    "missing_lines": missing_lines,
                    "num_branches": branches,
                    "covered_branches": covered_branches,
                },
                "files": {module: {"summary": critical_summary} for module in CRITICAL_MODULES},
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


def test_coverage_gate_rejects_disabled_or_empty_branch_collection(tmp_path: Path) -> None:
    disabled = tmp_path / "disabled.json"
    write_report(disabled, branch_coverage=False)
    assert main([str(disabled)]) == 2

    empty = tmp_path / "empty.json"
    write_report(empty, branches=0, covered_branches=0)
    assert main([str(empty)]) == 2


def test_coverage_gate_enforces_each_critical_ledger_module(tmp_path: Path) -> None:
    report = tmp_path / "critical.json"
    write_report(report, critical_covered=False)

    assert main([str(report)]) == 1

    payload = json.loads(report.read_text(encoding="utf-8"))
    del payload["files"][CRITICAL_MODULES[0]]
    report.write_text(json.dumps(payload), encoding="utf-8")
    assert main([str(report)]) == 1
