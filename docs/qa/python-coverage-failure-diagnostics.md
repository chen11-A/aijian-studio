# Safe Python coverage failure diagnostics

The original local b9 full API gate passed its tests but failed branch coverage. Its exact checker line was `Python coverage: line=92.03% (min 90.0%), branch=83.25% (min 83.5%)`. The previous CI diagnostic parser returned no supported metadata for that line. The old remote d010 Linux Test also failed without supported metadata, but its original public step log returned 404; its particular cause remains unconfirmed.

The diagnostic-only leaf 3ff9b3f recognizes the exact current Python checker format with bounded 0..100 metrics, assigns the Python phase, and reports only metrics below their own minimum. Malformed, NaN, out-of-range, suffixed and otherwise nonmatching text is rejected. Original Vitest and safe failure formats remain intact. This changes neither coverage thresholds nor subprocess output/exit status, and never appends original assertion values, variables or raw errors to annotations.

Root integrated d438a463a95c4657d8b757338f156afe489d3028 independently passed all 33 diagnostic tests in 1.178 seconds plus owned ESLint/Prettier/diff checks. Tests include actual child processes preserving stdout/stderr bytes and exit codes 0, 1 and 7. Logs: `/tmp/aivora-python-coverage-diagnostics-root-*`. This is diagnostic verification, not a claim that a complete Python coverage gate has recovered.
