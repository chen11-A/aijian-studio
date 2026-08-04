"""Enforce independent Python line and branch coverage thresholds."""

import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

LINE_THRESHOLD = 90.0
BRANCH_THRESHOLD = 83.5


def _required_count(totals: Mapping[str, object], key: str) -> int:
    value = totals.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"coverage totals field {key!r} must be a non-negative integer")
    return value


def _percentage(covered: int, total: int) -> float:
    return 100.0 if total == 0 else covered * 100.0 / total


def coverage_percentages(report_path: Path) -> tuple[float, float]:
    payload: object = json.loads(report_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("coverage report root must be an object")
    totals_value = payload.get("totals")
    if not isinstance(totals_value, dict):
        raise ValueError("coverage report must contain totals")
    totals: Mapping[str, object] = totals_value
    statement_count = _required_count(totals, "num_statements")
    missing_line_count = _required_count(totals, "missing_lines")
    branch_count = _required_count(totals, "num_branches")
    covered_branch_count = _required_count(totals, "covered_branches")
    if missing_line_count > statement_count or covered_branch_count > branch_count:
        raise ValueError("coverage report counts are inconsistent")
    return (
        _percentage(statement_count - missing_line_count, statement_count),
        _percentage(covered_branch_count, branch_count),
    )


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        print("usage: check_python_coverage.py <coverage.json>", file=sys.stderr)
        return 2
    try:
        line_coverage, branch_coverage = coverage_percentages(Path(arguments[0]))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"invalid coverage report: {error}", file=sys.stderr)
        return 2

    print(
        f"Python coverage: line={line_coverage:.2f}% (min {LINE_THRESHOLD:.1f}%), "
        f"branch={branch_coverage:.2f}% (min {BRANCH_THRESHOLD:.1f}%)"
    )
    failed = line_coverage < LINE_THRESHOLD or branch_coverage < BRANCH_THRESHOLD
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
