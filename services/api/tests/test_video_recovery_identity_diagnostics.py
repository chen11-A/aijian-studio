"""Actual read transparency and closed diagnostic facts, without fixing a guessed platform cause."""

import hashlib
import json

from aijian_api.video_recovery import VideoRecoveryService
from recovery_read_diagnostics import BOOLEAN_FIELDS
from recovery_read_diagnostics import (
    recovery_read_identity_observer as recovery_read_identity_observer,
)


def test_read_observation_keeps_real_result_and_bytes_and_never_prints_private_stat_values(
    tmp_path, capsys
):
    data = b"synthetic private media body"
    path = tmp_path / "private-token-and-path.mp4"
    path.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    reader = VideoRecoveryService._read_path
    baseline = reader.__wrapped__(path, digest, len(data))
    assert reader(path, digest, len(data)) == baseline
    assert reader(path, "f" * 64, len(data)) is None
    assert path.read_bytes() == data
    output = capsys.readouterr().out
    assert all(secret not in output for secret in (str(path), path.name, data.decode(), digest))
    messages = output.splitlines()
    assert 1 <= len(messages) <= 3
    for line in messages:
        assert line.startswith("CI_VIDEO_RECOVERY_IDENTITY ")
        row = json.loads(line.split(" ", 1)[1])
        assert set(row) == {"schemaVersion", "stage", *BOOLEAN_FIELDS}
        assert row["schemaVersion"] == 1 and row["stage"] == "read-path"
        assert all(type(row[field]) is bool for field in BOOLEAN_FIELDS)
