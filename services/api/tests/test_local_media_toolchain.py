"""Host-safe selection persistence and authenticated shared capability tests.

These do not execute Windows media tools or claim native Windows acceptance.
"""

import hashlib
import json
import sys
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

import pytest
from aijian_api.local_media_toolchain import LocalMediaToolchainService, _available
from aijian_api.main import create_app
from aijian_api.media_toolchain import MediaToolchain, MediaToolchainError, MediaToolchainErrorCode
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient


def _toolchain(directory: Path) -> MediaToolchain:
    return MediaToolchain(
        profile_id="windows-x86_64-gyan-full-8.1.2-dev",
        version="8.1.2",
        ffmpeg_path=directory / "ffmpeg.exe",
        ffprobe_path=directory / "ffprobe.exe",
        ffmpeg_sha256="ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e",
        ffprobe_sha256="9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015",
        configuration_flags=("--enable-static", "--enable-gpl", "--enable-libx264"),
        license_class="GPL",
        spdx_license="GPL-3.0-or-later",
        distribution_status="DEVELOPMENT_ONLY",
        external_selected=True,
    )


def _missing():
    raise MediaToolchainError(MediaToolchainErrorCode.NOT_FOUND, "No tools")


def test_selection_persists_identity_and_reverifies_on_read_and_each_admission(tmp_path):
    checked = []
    changed = False

    def verifier(path):
        checked.append(path)
        if changed:
            raise OSError("Tool bytes changed")
        return _toolchain(path)

    settings = tmp_path / "machine" / "selection.json"
    directory = tmp_path / "媒体 工具" / "bin"
    service = LocalMediaToolchainService(settings, fallback=_missing, verifier=verifier)
    assert service.status().state == "NOT_CONFIGURED"
    assert service.select(str(directory)).can_draft_export
    saved = json.loads(settings.read_text())
    assert set(saved) == {
        "schema_version",
        "directory",
        "profile_id",
        "ffmpeg_sha256",
        "ffprobe_sha256",
    }
    reopened = LocalMediaToolchainService(settings, fallback=_missing, verifier=verifier)
    assert reopened.status().source == "EXTERNAL"
    admitted = reopened.discover()
    assert checked == [directory, directory, directory]
    assert admitted.distribution_status == "DEVELOPMENT_ONLY"
    assert reopened.status().formal_release_approved is False
    changed = True
    assert reopened.status().state == "INVALID"
    with pytest.raises(OSError):
        reopened.discover()


def test_invalid_new_selection_keeps_previous_and_clear_only_removes_settings(tmp_path):
    directory = tmp_path / "trusted"
    directory.mkdir()
    tool_file = directory / "ffmpeg.exe"
    tool_file.write_bytes(b"test-owned-placeholder-no-execution")

    def verifier(path):
        if path != directory:
            raise OSError("Untrusted candidate")
        return _toolchain(path)

    settings = tmp_path / "machine" / "selection.json"
    service = LocalMediaToolchainService(settings, fallback=_missing, verifier=verifier)
    assert service.select(str(directory)).state == "AVAILABLE"
    before = settings.read_bytes()
    assert service.select(str(tmp_path / "unsupported")).state == "INVALID"
    assert settings.read_bytes() == before
    assert service.status().state == "AVAILABLE"
    assert service.clear().state == "NOT_CONFIGURED"
    assert not settings.exists()
    assert tool_file.read_bytes() == b"test-owned-placeholder-no-execution"


def test_corrupt_saved_identity_fails_closed_without_fallback(tmp_path):
    settings = tmp_path / "selection.json"
    service = LocalMediaToolchainService(settings, fallback=_missing, verifier=_toolchain)
    service.select(str(tmp_path / "tools"))
    data = json.loads(settings.read_text())
    data["profile_id"] = "unapproved-other-profile"
    settings.write_text(json.dumps(data))
    assert service.status().state == "INVALID"
    with pytest.raises(MediaToolchainError):
        service.discover()


def test_configuration_change_does_not_retarget_admitted_job(tmp_path):
    service = LocalMediaToolchainService(
        tmp_path / "selection.json", fallback=_missing, verifier=_toolchain
    )
    service.select(str(tmp_path / "first"))
    admitted = service.discover()
    service.select(str(tmp_path / "second"))
    assert admitted.ffmpeg_path.parent == tmp_path / "first"
    assert service.discover().ffmpeg_path.parent == tmp_path / "second"


def test_frozen_environment_override_never_bypasses_selection(tmp_path, monkeypatch):
    called = []

    def verifier(path):
        called.append(path)
        return _toolchain(path)

    service = LocalMediaToolchainService(
        tmp_path / "selection.json", fallback=_missing, verifier=verifier
    )
    service.select(str(tmp_path / "tools"))
    called.clear()
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("AIJIAN_DRAFT_MEDIA_TOOL_ROOT", str(tmp_path / "other"))
    assert service.status().state == "INVALID"
    assert service.select(str(tmp_path / "tools")).state == "INVALID"
    with pytest.raises(MediaToolchainError):
        service.discover()
    assert called == []


def test_unknown_settings_write_does_not_claim_availability(tmp_path, monkeypatch):
    service = LocalMediaToolchainService(
        tmp_path / "selection.json", fallback=_missing, verifier=_toolchain
    )

    def fail(_selection):
        raise OSError("Persistence failed")

    monkeypatch.setattr(service, "_write", fail)
    with pytest.raises(OSError):
        service.select(str(tmp_path / "tools"))


def test_linked_settings_rejected_without_touching_target(tmp_path):
    target = tmp_path / "target.json"
    target.write_text("{}")
    linked = tmp_path / "selection.json"
    linked.symlink_to(target)
    service = LocalMediaToolchainService(linked, fallback=_missing, verifier=_toolchain)
    assert service.status().state == "INVALID"
    with pytest.raises(ValueError):
        service.clear()
    assert target.read_text() == "{}"


def test_unsupported_platform_can_keep_existing_verified_development_fallback(
    tmp_path, monkeypatch
):
    monkeypatch.delenv("AIJIAN_DRAFT_MEDIA_TOOL_ROOT", raising=False)
    monkeypatch.delenv("AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK", raising=False)
    fallback = replace(_toolchain(tmp_path / "tools"), external_selected=False)
    service = LocalMediaToolchainService(None, fallback=lambda: fallback)
    status = service.status()
    assert status.state == "AVAILABLE" and status.source == "DEVELOPMENT_LOCAL"
    assert status.formal_release_approved is False
    assert service.select(str(tmp_path)).state == "UNSUPPORTED"
    assert LocalMediaToolchainService(None, fallback=_missing).status().state == "UNSUPPORTED"


def test_available_provenance_distinguishes_development_override_local_and_bundle(
    tmp_path, monkeypatch
):
    fallback = replace(_toolchain(tmp_path / "tools"), external_selected=False)
    service = LocalMediaToolchainService(None, fallback=lambda: fallback)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.delenv("AIJIAN_DRAFT_MEDIA_TOOL_ROOT", raising=False)
    monkeypatch.delenv("AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK", raising=False)
    assert service.status().source == "DEVELOPMENT_LOCAL"
    monkeypatch.setenv("AIJIAN_DRAFT_MEDIA_TOOL_ROOT", str(tmp_path / "tools"))
    monkeypatch.setenv("AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK", str(tmp_path / "dev-lock.json"))
    assert service.status().source == "DEVELOPMENT_OVERRIDE"
    monkeypatch.setattr(sys, "frozen", True)
    assert service.status().state == "INVALID"
    monkeypatch.delenv("AIJIAN_DRAFT_MEDIA_TOOL_ROOT")
    monkeypatch.delenv("AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK")
    assert service.status().source == "BUNDLED"
    assert _available(_toolchain(tmp_path)).source == "EXTERNAL"


def test_tool_settings_routes_are_native_authenticated_and_strict(tmp_path):
    service = LocalMediaToolchainService(
        tmp_path / "selection.json", fallback=_missing, verifier=_toolchain
    )
    token = "m" * 43
    host = "127.0.0.1:43123"
    app = create_app(
        sidecar_security=SidecarSecurity(token=token, host=host), local_media_toolchain=service
    )
    headers = {"Authorization": f"Bearer {token}", "Origin": "app://aijian"}
    base = "/api/v1/local-media-toolchain"
    with TestClient(app, base_url=f"http://{host}", client=("127.0.0.1", 1234)) as client:
        assert client.get(base + "/status").status_code == 401
        assert (
            client.get(
                base + "/status", headers={**headers, "Origin": "https://evil.invalid"}
            ).status_code
            == 403
        )
        assert client.get(base + "/status", headers=headers).json()["state"] == "NOT_CONFIGURED"
        assert (
            client.put(
                base + "/selection",
                headers=headers,
                json={"directory": str(tmp_path), "lock_path": "/arbitrary"},
            ).status_code
            == 422
        )
        selected = client.put(
            base + "/selection", headers=headers, json={"directory": str(tmp_path / "tools")}
        )
        assert selected.status_code == 200
        assert selected.json() == _available(_toolchain(tmp_path / "tools")).model_dump(mode="json")
        assert (
            client.delete(base + "/selection", headers=headers).json()["state"] == "NOT_CONFIGURED"
        )
    with TestClient(create_app()) as client:
        assert client.get(base + "/status").status_code == 404
        assert client.put(base + "/selection", json={"directory": str(tmp_path)}).status_code == 404


def test_serialized_backend_status_matches_native_and_ui_fixture():
    from aijian_api.local_media_toolchain import LocalMediaToolchainStatus

    fixture = (
        Path(__file__).resolve().parents[3]
        / "packages/contracts/fixtures/local-media-toolchain-status.json"
    )
    payload = json.loads(fixture.read_text())
    for item in payload:
        assert LocalMediaToolchainStatus.model_validate(item).model_dump(mode="json") == item
    assert payload[0] == _available(_toolchain(Path("/synthetic/local media/bin"))).model_dump(
        mode="json"
    )


def test_external_probe_always_uses_the_guarded_runner(tmp_path, monkeypatch):
    from aijian_api import external_media_process
    from aijian_api.media_probe import _run_probe

    source = tmp_path / "input.mkv"
    source.write_bytes(b"synthetic-test-bytes-not-executed")
    seen = []

    def guarded(executable, arguments, timeout):
        seen.append((executable, arguments, timeout))
        return b'{"streams":[]}'

    def unguarded(*_args):
        raise AssertionError("External operation must not use a generic command runner")

    monkeypatch.setattr(external_media_process, "run_external_command", guarded)
    tools = _toolchain(tmp_path / "tools")
    result = _run_probe(
        tools,
        source,
        hashlib.sha256(source.read_bytes()).hexdigest(),
        ("-show_streams",),
        unguarded,
    )
    assert result == {"streams": []}
    assert seen[0][0] == tools.ffprobe_path


def test_external_draft_holds_pair_and_private_session_through_process(tmp_path, monkeypatch):
    from aijian_api import external_media_process
    from aijian_api.draft_export_encoder import DraftEncodeError, _Runner

    events = []
    private = tmp_path / "private"

    @contextmanager
    def pair(root):
        events.append(("lock", root))
        yield
        events.append(("unlock", root))

    @contextmanager
    def session():
        events.append("session-open")
        yield private, {"TEMP": str(private)}
        events.append("session-close")

    monkeypatch.setattr(external_media_process, "guarded_external_pair", pair)
    monkeypatch.setattr(external_media_process, "external_process_session", session)
    runner = _Runner(_toolchain(tmp_path / "tools"), None, lambda: False)

    def run(_arguments, **kwargs):
        assert events == [("lock", tmp_path / "tools"), "session-open"]
        assert kwargs["work_directory"] == private
        assert kwargs["external_environment"] == {"TEMP": str(private)}
        return b"guarded"

    monkeypatch.setattr(runner, "_run", run)
    assert runner.run(["-version"]) == b"guarded"
    assert events[-2:] == ["session-close", ("unlock", tmp_path / "tools")]
    with pytest.raises(DraftEncodeError, match="safe execution"):
        runner.run(["-version"], work_directory=tmp_path / "untrusted")


def test_external_provider_requires_current_features_before_admission(tmp_path, monkeypatch):
    from aijian_api import local_media_toolchain as module

    @contextmanager
    def guard(_root):
        yield

    flags = ("--enable-static", "--enable-gpl", "--enable-libx264")
    tools = replace(_toolchain(tmp_path), external_selected=False, configuration_flags=flags)
    monkeypatch.setattr(module, "guarded_external_pair", guard)
    monkeypatch.setattr(module, "discover_media_toolchain", lambda *_args, **_kwargs: tools)
    replies = {
        ("-hide_banner", "-encoders"): b" V..... libx264 test\n A..... aac test\n",
        ("-hide_banner", "-filters"): b"\n".join(
            f"... {name} test".encode()
            for name in ("drawtext", "trim", "atrim", "concat", "amix", "scale")
        ),
    }
    monkeypatch.setattr(
        module, "run_external_command", lambda _path, args, *_rest, **_kwargs: replies[args]
    )
    assert module.verify_external_toolchain(tmp_path).external_selected
    replies[("-hide_banner", "-encoders")] = b" V..... libx264 test\n"
    with pytest.raises(MediaToolchainError) as error:
        module.verify_external_toolchain(tmp_path)
    assert error.value.code == MediaToolchainErrorCode.CONFIGURATION_MISMATCH


def test_changed_installed_profile_rejected_before_any_external_execution(tmp_path, monkeypatch):
    from aijian_api import local_media_toolchain as module
    from aijian_api.media_toolchain import load_media_toolchain_lock

    lock = load_media_toolchain_lock(Path("config/media-toolchain-lock.json"))
    changed = lock.model_copy(
        update={"profiles": (lock.profiles[0].model_copy(update={"ffmpeg_sha256": "0" * 64}),)}
    )
    monkeypatch.setattr(module, "load_media_toolchain_lock", lambda _path: changed)

    def forbidden(*_args):
        raise AssertionError("Changed profile cannot reach process admission")

    monkeypatch.setattr(module, "guarded_external_pair", forbidden)
    with pytest.raises(MediaToolchainError) as error:
        module.verify_external_toolchain(tmp_path)
    assert error.value.code == MediaToolchainErrorCode.LOCK_INVALID
