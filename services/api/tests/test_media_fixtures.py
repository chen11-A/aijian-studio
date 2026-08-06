import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from scripts.media_fixtures import (
    CANONICAL_RECIPE_ARGUMENTS,
    FixtureExpectationData,
    GoldenMediaFixtureData,
    GoldenMediaManifestData,
    MediaFixtureError,
    _assert_probe_matches,
    _generation_arguments,
    verify_fixture_files,
)


def _fixture(path: str, payload: bytes = b"fixture") -> GoldenMediaFixtureData:
    return GoldenMediaFixtureData(
        fixture_id="cfr-24-48000",
        relative_path=path,
        sha256=hashlib.sha256(payload).hexdigest(),
        media_kind="CFR",
        generation_arguments=CANONICAL_RECIPE_ARGUMENTS["cfr-24-48000"],
        expected=FixtureExpectationData(
            frame_rate_num=24,
            frame_rate_den=1,
            frame_count=48,
            audio_sample_rate_hz=48_000,
            audio_sample_count=96_000,
            variable_frame_rate=False,
            video_time_base_num=1,
            video_time_base_den=1000,
            video_pts_sha256=hashlib.sha256(b"[0]").hexdigest(),
        ),
    )


def test_verify_fixture_files_accepts_a_matching_content_hash(tmp_path: Path) -> None:
    payload = b"fixture"
    fixture_path = tmp_path / "cfr-24-48000.mkv"
    fixture_path.write_bytes(payload)
    manifest = GoldenMediaManifestData(fixtures=(_fixture(fixture_path.name, payload),))

    verified = verify_fixture_files(manifest, tmp_path)

    assert verified == {"cfr-24-48000": f"sha256:{hashlib.sha256(payload).hexdigest()}"}


def test_verify_fixture_files_rejects_hash_drift(tmp_path: Path) -> None:
    fixture_path = tmp_path / "cfr-24-48000.mkv"
    fixture_path.write_bytes(b"changed")
    manifest = GoldenMediaManifestData(fixtures=(_fixture(fixture_path.name),))

    with pytest.raises(MediaFixtureError, match="hash mismatch"):
        verify_fixture_files(manifest, tmp_path)


@pytest.mark.parametrize(
    "relative_path",
    [
        "../escape.mkv",
        "/absolute.mkv",
        "folder\\file.mkv",
        "C:/outside/fixture.mkv",
        "C:drive-relative.mkv",
        "//server/share/fixture.mkv",
    ],
)
def test_manifest_rejects_non_canonical_fixture_paths(relative_path: str) -> None:
    with pytest.raises(ValidationError):
        _fixture(relative_path)


def test_manifest_rejects_duplicate_fixture_ids_and_paths() -> None:
    fixture = _fixture("cfr-24-48000.mkv")
    with pytest.raises(ValidationError):
        GoldenMediaManifestData(fixtures=(fixture, fixture))


def test_vfr_fixture_requires_a_variable_frame_rate_expectation() -> None:
    with pytest.raises(ValidationError):
        GoldenMediaFixtureData(
            **{
                **_fixture("cfr-24-48000.mkv").model_dump(),
                "media_kind": "VFR",
                "expected": {
                    **_fixture("cfr-24-48000.mkv").expected.model_dump(),
                    "variable_frame_rate": False,
                },
            }
        )


def test_manifest_rejects_a_generation_recipe_that_differs_from_runtime() -> None:
    with pytest.raises(ValidationError, match="recipe is not canonical"):
        GoldenMediaFixtureData(
            **{
                **_fixture("cfr-24-48000.mkv").model_dump(),
                "generation_arguments": ("untrusted-recipe",),
            }
        )


def test_probe_evidence_rejects_a_post_verification_hash_change() -> None:
    fixture = _fixture("cfr-24-48000.mkv")
    rational = SimpleNamespace(num=1, den=1000)
    result = SimpleNamespace(
        source_asset_sha256="sha256:" + "b" * 64,
        video=SimpleNamespace(
            average_frame_rate=SimpleNamespace(num=24, den=1),
            time_base=rational,
            frames=(SimpleNamespace(pts=SimpleNamespace(ticks=0)),),
            is_variable_frame_rate=False,
        ),
        audio=SimpleNamespace(sample_rate_hz=48_000, total_samples=96_000),
    )

    with pytest.raises(MediaFixtureError, match="probe expectation mismatch"):
        _assert_probe_matches(fixture, result, "sha256:" + "a" * 64)


def test_generator_rejects_fixture_ids_without_a_reviewed_recipe(tmp_path: Path) -> None:
    with pytest.raises(MediaFixtureError, match="no generator"):
        _generation_arguments("unreviewed-fixture", tmp_path / "output.mkv")
