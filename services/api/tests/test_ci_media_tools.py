"""Network-free CI preparation contracts; real tool admission is separate."""

import hashlib
import io
import urllib.error
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
        assert not path.exists(), "invalid bytes must never become the cached archive"
        staged = list(tmp_path.glob(".archive.7z.download-*"))
        if fault == "redirect":
            assert staged == [], "an insecure redirect must be rejected before writing"
        else:
            assert len(staged) == 1, "invalid input stays in its staging file for diagnosis"


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


def test_transient_http_failure_retries_then_publishes_verified_archive(
    tmp_path, monkeypatch, archive
):
    path = tmp_path / "archive.7z"
    response = io.BytesIO(archive)
    response.url = prepare.WINDOWS_ARCHIVE_URL
    network = Mock(
        side_effect=[
            urllib.error.HTTPError(prepare.WINDOWS_ARCHIVE_URL, 503, "unavailable", {}, None),
            response,
        ]
    )
    sleep = Mock()
    monkeypatch.setattr(prepare.urllib.request, "urlopen", network)
    monkeypatch.setattr(prepare.time, "sleep", sleep)
    prepare.download_archive(path)
    assert network.call_count == 2
    assert [call.args[0].full_url for call in network.call_args_list] == [
        prepare.WINDOWS_ARCHIVE_URL,
        prepare.WINDOWS_ARCHIVE_MIRROR_URL,
    ]
    sleep.assert_called_once_with(2)
    assert path.read_bytes() == archive
    assert list(tmp_path.glob(".archive.7z.download-*")) == []


def test_interrupted_stream_retries_without_publishing_partial_bytes(
    tmp_path, monkeypatch, archive
):
    path = tmp_path / "archive.7z"

    class Interrupted(io.BytesIO):
        url = prepare.WINDOWS_ARCHIVE_URL
        reads = 0

        def read(self, size=-1):
            self.reads += 1
            assert not path.exists()
            if self.reads == 1:
                return b"partial"
            raise ConnectionResetError("interrupted")

    good = io.BytesIO(archive)
    good.url = prepare.WINDOWS_ARCHIVE_URL
    network = Mock(side_effect=[Interrupted(), good])
    monkeypatch.setattr(prepare.urllib.request, "urlopen", network)
    monkeypatch.setattr(prepare.time, "sleep", Mock())
    prepare.download_archive(path)
    assert path.read_bytes() == archive
    assert network.call_count == 2
    assert list(tmp_path.glob(".archive.7z.download-*")) == []


@pytest.mark.parametrize("status, attempts", [(503, 3), (403, 1), (404, 1)])
def test_http_retries_are_bounded_and_permission_failures_are_not_retried(
    tmp_path, monkeypatch, status, attempts
):
    path = tmp_path / "archive.7z"
    network = Mock(
        side_effect=urllib.error.HTTPError(prepare.WINDOWS_ARCHIVE_URL, status, "failure", {}, None)
    )
    sleep = Mock()
    monkeypatch.setattr(prepare.urllib.request, "urlopen", network)
    monkeypatch.setattr(prepare.time, "sleep", sleep)
    with pytest.raises(urllib.error.HTTPError) as raised:
        prepare.download_archive(path)
    assert raised.value.code == status
    assert network.call_count == attempts
    assert [call.args[0].full_url for call in network.call_args_list] == [
        prepare.WINDOWS_ARCHIVE_URL,
        *([prepare.WINDOWS_ARCHIVE_MIRROR_URL] * (attempts - 1)),
    ]
    assert sleep.call_count == attempts - 1
    assert not path.exists()


def test_hash_failure_is_not_retried_or_admitted(tmp_path, monkeypatch, archive):
    path = tmp_path / "archive.7z"
    response = io.BytesIO(b"wrong")
    response.url = prepare.WINDOWS_ARCHIVE_URL
    network = Mock(return_value=response)
    monkeypatch.setattr(prepare.urllib.request, "urlopen", network)
    monkeypatch.setattr(prepare.time, "sleep", Mock(side_effect=AssertionError("must not retry")))
    with pytest.raises(ValueError, match="pinned bytes"):
        prepare.download_archive(path)
    assert network.call_count == 1
    assert not path.exists()
    staged = list(tmp_path.glob(".archive.7z.download-*"))
    assert len(staged) == 1
    assert staged[0].read_bytes() == b"wrong"


def test_mirror_bytes_must_still_match_the_original_hash(tmp_path, monkeypatch, archive):
    path = tmp_path / "archive.7z"
    response = io.BytesIO(b"wrong mirror bytes")
    response.url = prepare.WINDOWS_ARCHIVE_MIRROR_URL
    network = Mock(
        side_effect=[
            urllib.error.HTTPError(prepare.WINDOWS_ARCHIVE_URL, 503, "unavailable", {}, None),
            response,
        ]
    )
    monkeypatch.setattr(prepare.urllib.request, "urlopen", network)
    sleep = Mock()
    monkeypatch.setattr(prepare.time, "sleep", sleep)
    with pytest.raises(ValueError, match="pinned bytes"):
        prepare.download_archive(path)
    assert network.call_count == 2
    sleep.assert_called_once_with(2)
    assert not path.exists()
    staged = list(tmp_path.glob(".archive.7z.download-*"))
    assert len(staged) == 1
    assert staged[0].read_bytes() == b"wrong mirror bytes"
