"""Enforce independent Python line and branch coverage thresholds."""

import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

LINE_THRESHOLD = 90.0
BRANCH_THRESHOLD = 83.5
CRITICAL_FULL_COVERAGE_MODULES = (
    "services/api/src/aijian_api/credential_vault.py",
    "services/api/src/aijian_api/local_executor.py",
    "services/api/src/aijian_api/provider_connection_repository.py",
    "services/api/src/aijian_api/provider_connection_routes.py",
    "services/api/src/aijian_api/provider_connections.py",
    "services/api/src/aijian_api/provider_contracts.py",
    "services/api/src/aijian_api/task_ledger.py",
    "services/api/src/aijian_api/task_ledger_completion.py",
    "services/api/src/aijian_api/task_ledger_enqueue.py",
    "services/api/src/aijian_api/task_ledger_events.py",
    "services/api/src/aijian_api/task_ledger_models.py",
    "services/api/src/aijian_api/task_ledger_recovery.py",
)


def _required_count(totals: Mapping[str, object], key: str) -> int:
    value = totals.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"coverage totals field {key!r} must be a non-negative integer")
    return value


def _percentage(covered: int, total: int) -> float:
    return 100.0 if total == 0 else covered * 100.0 / total


def _report(report_path: Path) -> dict[str, object]:
    payload: object = json.loads(report_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("coverage report root must be an object")
    meta = payload.get("meta")
    if not isinstance(meta, dict) or meta.get("branch_coverage") is not True:
        raise ValueError("coverage report must include enabled branch coverage")
    return payload


def _summary_percentages(summary: Mapping[str, object]) -> tuple[float, float]:
    statement_count = _required_count(summary, "num_statements")
    missing_line_count = _required_count(summary, "missing_lines")
    branch_count = _required_count(summary, "num_branches")
    covered_branch_count = _required_count(summary, "covered_branches")
    if missing_line_count > statement_count or covered_branch_count > branch_count:
        raise ValueError("coverage report counts are inconsistent")
    return (
        _percentage(statement_count - missing_line_count, statement_count),
        _percentage(covered_branch_count, branch_count),
    )


def coverage_percentages(report_path: Path) -> tuple[float, float]:
    payload = _report(report_path)
    totals_value = payload.get("totals")
    if not isinstance(totals_value, dict):
        raise ValueError("coverage report must contain totals")
    totals: Mapping[str, object] = totals_value
    branch_count = _required_count(totals, "num_branches")
    if branch_count == 0:
        raise ValueError("coverage report did not collect any branches")
    return _summary_percentages(totals)


def critical_coverage_failures(report_path: Path) -> list[str]:
    payload = _report(report_path)
    files_value = payload.get("files")
    if not isinstance(files_value, dict):
        return list(CRITICAL_FULL_COVERAGE_MODULES)
    files = {str(path).replace("\\", "/"): value for path, value in files_value.items()}
    failures: list[str] = []
    for module in CRITICAL_FULL_COVERAGE_MODULES:
        file_value = files.get(module)
        if not isinstance(file_value, dict):
            failures.append(f"{module} (missing)")
            continue
        summary = file_value.get("summary")
        if not isinstance(summary, dict):
            failures.append(f"{module} (missing summary)")
            continue
        line_coverage, branch_coverage = _summary_percentages(summary)
        if line_coverage < 100.0 or branch_coverage < 100.0:
            failures.append(f"{module} (line={line_coverage:.2f}%, branch={branch_coverage:.2f}%)")
    return failures


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        print("usage: check_python_coverage.py <coverage.json>", file=sys.stderr)
        return 2
    try:
        report_path = Path(arguments[0])
        line_coverage, branch_coverage = coverage_percentages(report_path)
        critical_failures = critical_coverage_failures(report_path)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"invalid coverage report: {error}", file=sys.stderr)
        return 2

    print(
        f"Python coverage: line={line_coverage:.2f}% (min {LINE_THRESHOLD:.1f}%), "
        f"branch={branch_coverage:.2f}% (min {BRANCH_THRESHOLD:.1f}%)"
    )
    if critical_failures:
        print("Critical modules below 100% line/branch coverage:", file=sys.stderr)
        for failure in critical_failures:
            print(f"- {failure}", file=sys.stderr)
    failed = (
        line_coverage < LINE_THRESHOLD
        or branch_coverage < BRANCH_THRESHOLD
        or bool(critical_failures)
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
