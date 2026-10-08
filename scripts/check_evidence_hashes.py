"""Verify every checked-in quality-evidence file against SHA256SUMS."""

import hashlib
import sys
from pathlib import Path


def main() -> int:
    repository_root = Path(__file__).resolve().parents[1]
    evidence_directory = repository_root / "docs" / "quality" / "evidence"
    manifest_path = evidence_directory / "SHA256SUMS"
    expected: dict[str, str] = {}
    for line_number, raw_line in enumerate(
        manifest_path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not raw_line.strip():
            continue
        digest, separator, filename = raw_line.partition("  ")
        if separator != "  " or len(digest) != 64 or not filename:
            print(f"invalid SHA256SUMS line {line_number}", file=sys.stderr)
            return 2
        if filename in expected:
            print(f"duplicate evidence entry: {filename}", file=sys.stderr)
            return 2
        expected[filename] = digest

    actual_files = {
        path.name: path
        for path in evidence_directory.iterdir()
        if path.is_file() and path.name != manifest_path.name
    }
    if expected.keys() != actual_files.keys():
        missing = sorted(actual_files.keys() - expected.keys())
        stale = sorted(expected.keys() - actual_files.keys())
        if missing:
            print(f"evidence files missing from manifest: {', '.join(missing)}", file=sys.stderr)
        if stale:
            print(f"manifest entries missing files: {', '.join(stale)}", file=sys.stderr)
        return 1

    mismatches = []
    for filename, path in actual_files.items():
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected[filename]:
            mismatches.append(filename)
    if mismatches:
        print(f"evidence hash mismatch: {', '.join(sorted(mismatches))}", file=sys.stderr)
        return 1
    print(f"Evidence SHA-256: PASS ({len(actual_files)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
