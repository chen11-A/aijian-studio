"""Network-free CI preparation contracts; real tool admission is separate."""

import hashlib
import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts import ci_media_tools as prepare


@pytest.fixture
def archive(monkeypatch):
    body = b"synthetic archive"
    monkeypatch.setattr(prepare, "WINDOWS_ARCHIVE_SHA256", hashlib.sha256(body).hexdigest())
    return body


def test_exact_cached_archive_never_downloads(tmp_path, monkeypatch, archive):
    path = tmp_path / "archive.7z"
    path.write_bytes(archive)
    network = Mock(side_effect=AssertionError("network must not be used"))
    monkeypatch.setattr(prepare.urllib.request, "urlopen", network)
    prepare.download_archive(path)
    network.assert_not_called()


def test_changed_cached_archive_is_preserved_and_rejected(tmp_path, monkeypatch, archive):
    path = tmp_path / "archive.7z"
    path.write_bytes(b"changed")
    network = Mock()
    monkeypatch.setattr(prepare.urllib.request, "urlopen", network)
    with pytest.raises(ValueError, match="pinned bytes"):
        prepare.download_archive(path)
    assert path.read_bytes() == b"changed"
    network.assert_not_called()


def test_oversize_cached_archive_is_rejected_before_reading(tmp_path, monkeypatch):
    path = tmp_path / "archive.7z"
    path.write_bytes(b"oversize")
    monkeypatch.setattr(prepare, "MAX_ARCHIVE_BYTES", 1)

    def unexpected_read(*_args, **_kwargs):
        pytest.fail("oversize archive must fail before reading its bytes")

    monkeypatch.setattr(Path, "open", unexpected_read)
    with pytest.raises(ValueError, match="pinned bytes"):
        prepare.verify_archive(path)


@pytest.mark.parametrize("fault", ["hash", "oversize", "redirect", "none"])
def test_download_is_bounded_https_and_hash_checked(tmp_path, monkeypatch, archive, fault):
    response = io.BytesIO(b"wrong" if fault == "hash" else archive)
    response.url = "http://invalid.test/" if fault == "redirect" else prepare.WINDOWS_ARCHIVE_URL
    monkeypatch.setattr(prepare.urllib.request, "urlopen", lambda *_args, **_kwargs: response)
    if fault == "oversize":
        monkeypatch.setattr(prepare, "MAX_ARCHIVE_BYTES", 2)
    path = tmp_path / "archive.7z"
    if fault == "none":
        prepare.download_archive(path)
        assert path.read_bytes() == archive
    else:
        with pytest.raises(ValueError):
            prepare.download_archive(path)
        assert path.exists(), "failed input remains available for diagnosis"


def test_only_two_locked_executables_are_requested_from_archive(tmp_path, monkeypatch, archive):
    root = tmp_path / "tools"
    root.mkdir()
    (root / "ffmpeg.7z").write_bytes(archive)
    extractor = tmp_path / "7z.exe"
    extractor.write_bytes(b"not executed")
    run = Mock()
    monkeypatch.setattr(prepare.subprocess, "run", run)
    result = prepare.prepare_windows(root, extractor)
    assert result == root / prepare.WINDOWS_ARCHIVE_ROOT / "bin"
    assert run.call_args.args[0][-2:] == [
        f"{prepare.WINDOWS_ARCHIVE_ROOT}/bin/ffmpeg.exe",
        f"{prepare.WINDOWS_ARCHIVE_ROOT}/bin/ffprobe.exe",
    ]
    assert run.call_args.kwargs["check"] is True


def test_relative_destination_is_rejected_before_download(monkeypatch):
    download = Mock()
    monkeypatch.setattr(prepare, "download_archive", download)
    with pytest.raises(ValueError, match="absolute plain directory"):
        prepare.prepare_windows(Path("relative"), Path("7z.exe"))
    download.assert_not_called()


def test_distribution_profile_is_never_admitted(tmp_path, monkeypatch):
    discovery = Mock()
    module = SimpleNamespace(
        load_media_toolchain_lock=lambda _path: SimpleNamespace(
            profiles=[SimpleNamespace(distribution_status="RELEASE_REVIEW_REQUIRED")]
        ),
        discover_media_toolchain=discovery,
    )
    monkeypatch.setattr(prepare, "import_module", lambda _name: module)
    with pytest.raises(ValueError, match="cannot authorize distribution"):
        prepare.verify_tools(tmp_path, windows=True)
    discovery.assert_not_called()
