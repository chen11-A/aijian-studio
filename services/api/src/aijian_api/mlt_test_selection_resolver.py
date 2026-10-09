"""Bind the one QA02 five-input TEST to real selected media and approvals.

This read-only composition runs after the QA sidecar closes normally. It does
not import media, make rights decisions, create probe rows, or execute MLT.
Every use of a media reference re-reads the selected version and latest rights.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import stat
import time
from collections.abc import Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NoReturn

from aijian_api.domain import ArtifactVersionRecord
from aijian_api.episode_media_execution_plan import (
    ART04_MLT_TEST_SPEC_SHA256,
    build_art04_synthetic_execution_plan,
)
from aijian_api.episode_script_contracts import EpisodeScriptContentV1
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_asset_audio_inspection import (
    VerifiedTestAudio,
    _managed_path,
    inspect_selected_test_wav,
)
from aijian_api.media_asset_probe_store import (
    MediaAssetProbeEvidence,
    MediaAssetProbeEvidenceError,
    _from_row,
)
from aijian_api.media_asset_rights_contracts import AuthoritativeRightsDecision
from aijian_api.media_asset_rights_reader import read_latest_rights_decision
from aijian_api.media_asset_selected_reader import (
    MAX_DATABASE_BYTES,
    MAX_READ_SECONDS,
    SelectedMediaAssetVersion,
    _hash_stream,
    _plain_directory,
    _ReadBudgetExceeded,
    _sidecar_state,
    read_selected_media_asset_version,
)
from aijian_api.media_execution_plan_contracts import (
    ExecutionMediaRefV1,
    FrozenEngineeringTestBindingsV1,
    MediaExecutionPlanV1,
)
from aijian_api.media_probe import _is_remote_windows_path, _open_local_source
from aijian_api.mlt_execution_adapter import MltResolvedSelection
from aijian_api.mlt_execution_worker import MltFileIdentity
from aijian_api.repository import StudioRepository

QA02_FIVE_INPUT_MANIFEST_SHA256 = "ee2166d379c1000d65138c12023209a9d535aee17d707c04bb907b7823fb04e3"
_FILE_NAMES = (
    "v1-blue.webm",
    "v2-red.webm",
    "dialogue-test.wav",
    "bgm-test.wav",
    "subtitle-test.srt",
)
_HEX = re.compile(r"[0-9a-fA-F]{64}\Z")
_MAX_MANIFEST_BYTES = 1024 * 1024
_MAX_FIXTURE_FILE_BYTES = 1024 * 1024
_MAX_PLAIN_WINDOWS_PATH_CHARS = 259


class TestSelectionError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class AssetVersionSelector:
    asset_id: str
    version_id: str


@dataclass(frozen=True, slots=True)
class TestSubtitleStyle:
    """A QA reviewed rendering choice, sealed by the derived plan hash."""

    font_family: str
    font_size_px: int
    color_rgba: str


@dataclass(frozen=True, slots=True)
class TestSelectionRequest:
    database_path: Path
    manifest_path: Path
    blue_video: AssetVersionSelector
    red_video: AssetVersionSelector
    dialogue_tone: AssetVersionSelector
    bgm_tone: AssetVersionSelector
    subtitle_style: TestSubtitleStyle


@dataclass(frozen=True, slots=True)
class _FixtureFile:
    path: Path
    sha256: str
    byte_size: int


@dataclass(frozen=True, slots=True)
class _FixtureManifest:
    project_id: str
    episode_id: str
    script_version_id: str
    script_content_hash: str
    first_block_id: str
    second_block_id: str
    files: dict[str, _FixtureFile]
    ffmpeg_sha256: str
    ffprobe_sha256: str


@dataclass(frozen=True, slots=True)
class _VerifiedMedia:
    ref: ExecutionMediaRefV1
    file: MltFileIdentity
    rights: AuthoritativeRightsDecision
    probe: MediaAssetProbeEvidence | None = None
    audio: VerifiedTestAudio | None = None


@dataclass(frozen=True, slots=True)
class ResolvedEngineeringTest:
    request: TestSelectionRequest
    bindings: FrozenEngineeringTestBindingsV1
    plan: MediaExecutionPlanV1
    fixture_manifest: MltFileIdentity
    subtitle_file: MltFileIdentity
    selected_media: tuple[_VerifiedMedia, ...]

    def resolve_selected(self, ref: ExecutionMediaRefV1) -> MltResolvedSelection:
        """Adapter callback: compare one current DB/rights/inspection read to plan."""
        names = _selector_names(self.request)
        original = next((item for item in self.selected_media if item.ref == ref), None)
        if original is None:
            raise TestSelectionError("PLAN_MEDIA_UNKNOWN", "Plan has an unselected media version")
        name = next(
            (
                candidate
                for candidate, selector in names.items()
                if (selector.asset_id, selector.version_id) == (ref.asset_id, ref.asset_version_id)
            ),
            None,
        )
        if name is None:
            raise TestSelectionError("PLAN_MEDIA_UNKNOWN", "Plan media is not a TEST selection")
        with _frozen_database(self.request.database_path):
            manifest = _load_manifest(self.request.manifest_path)
            current = _verified_media(
                self.request.database_path,
                manifest,
                name,
                names[name],
            )
            if current.ref != ref or current.rights != original.rights:
                raise TestSelectionError("PLAN_MEDIA_CHANGED", "Selected media authority changed")
            if current.file != original.file:
                raise TestSelectionError("PLAN_FILE_CHANGED", "Selected media path changed")
            return MltResolvedSelection(media=ref, file=current.file)

    def revalidate(
        self,
        plan: MediaExecutionPlanV1,
        resources: tuple[MltFileIdentity, ...],
    ) -> None:
        """Rebuild from current truth immediately before a TEST worker starts."""
        current = prepare_test_selection(self.request)
        if (
            current.fixture_manifest != self.fixture_manifest
            or current.subtitle_file != self.subtitle_file
        ):
            raise TestSelectionError("FIXTURE_CHANGED", "Frozen TEST manifest or subtitle changed")
        if current.bindings != self.bindings:
            raise TestSelectionError(
                "BINDINGS_CHANGED",
                "Frozen TEST selections or subtitle style changed",
            )
        if current.selected_media != self.selected_media:
            raise TestSelectionError(
                "SELECTION_CHANGED",
                "Selected ASV, rights, probe, or audio inspection changed",
            )
        if current.plan != plan or current.plan != self.plan:
            raise TestSelectionError(
                "PLAN_CHANGED",
                "Frozen TEST plan no longer matches current authority",
            )
        expected = {item.file for item in current.selected_media}
        expected.add(current.subtitle_file)
        if set(resources) != expected or len(resources) != len(expected):
            raise TestSelectionError(
                "RESOURCE_CHANGED",
                "MLT resources differ from revalidated sources",
            )


def _reject(code: str, message: str) -> NoReturn:
    raise TestSelectionError(code, message)


def _same_stat(before: os.stat_result, after: os.stat_result) -> bool:
    return (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    ) == (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    )


def _windows_path_units(path: Path) -> int:
    return len(str(path).encode("utf-16-le", errors="surrogatepass")) // 2


@contextmanager
def _frozen_database(database_path: Path) -> Iterator[None]:
    """Hold a Windows deny-write DB handle across all independent readers."""
    if (
        os.name != "nt"
        or not database_path.is_absolute()
        or _is_remote_windows_path(database_path)
        # The SQLite URI and sidecar readers still use this logical spelling.
        # Keep that boundary short until those readers have independent proof.
        or _windows_path_units(database_path) + len("-journal") > _MAX_PLAIN_WINDOWS_PATH_CHARS
        or not _plain_directory(database_path.parent)
        or database_path.is_symlink()
    ):
        _reject("DATABASE_UNAVAILABLE", "TEST selection requires a local closed Windows DB")
    sidecars_ok, sidecars_before = _sidecar_state(database_path)
    if not sidecars_ok:
        _reject("DATABASE_BUSY", "TEST DB is not checkpointed and quiescent")
    try:
        with _open_local_source(database_path) as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_DATABASE_BYTES:
                _reject("DATABASE_UNAVAILABLE", "TEST DB size or type is unsupported")
            deadline = time.monotonic() + MAX_READ_SECONDS
            original_hash, original_size = _hash_stream(
                stream,
                maximum=MAX_DATABASE_BYTES,
                deadline=deadline,
            )
            if original_size != before.st_size:
                _reject("DATABASE_CHANGED", "TEST DB size changed before selection")
            yield
            stream.seek(0)
            final_hash, final_size = _hash_stream(
                stream,
                maximum=MAX_DATABASE_BYTES,
                deadline=time.monotonic() + MAX_READ_SECONDS,
            )
            after = os.fstat(stream.fileno())
            path_after = database_path.stat()
            sidecars_ok, sidecars_after = _sidecar_state(database_path)
            if (
                not sidecars_ok
                or sidecars_after != sidecars_before
                or final_hash != original_hash
                or final_size != original_size
                or not _same_stat(before, after)
                or not _same_stat(before, path_after)
            ):
                _reject("DATABASE_CHANGED", "TEST DB changed during selection")
    except (_ReadBudgetExceeded, OSError):
        _reject("DATABASE_UNAVAILABLE", "TEST DB could not be held as one read snapshot")


def _unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate manifest key")
        result[key] = value
    return result


def _file_bytes(path: Path, *, maximum: int) -> bytes:
    if (
        not path.is_absolute()
        or _is_remote_windows_path(path)
        # Frozen QA fixtures are external inputs, outside the managed helper.
        or (os.name == "nt" and _windows_path_units(path) > _MAX_PLAIN_WINDOWS_PATH_CHARS)
        or not _plain_directory(path.parent)
        or path.is_symlink()
    ):
        _reject("FIXTURE_PATH_UNSAFE", "TEST fixture path is not a plain local file")
    try:
        with _open_local_source(path) as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum:
                _reject("FIXTURE_SIZE_UNSUPPORTED", "TEST fixture file size is unsupported")
            data = stream.read(maximum + 1)
            after = os.fstat(stream.fileno())
        current = path.stat()
    except OSError:
        _reject("FIXTURE_READ_UNKNOWN", "TEST fixture file could not be read")
    if (
        len(data) != before.st_size
        or path.is_symlink()
        or not _same_stat(before, after)
        or not _same_stat(before, current)
    ):
        _reject("FIXTURE_CHANGED", "TEST fixture file identity changed")
    return data


def _load_manifest(path: Path) -> _FixtureManifest:
    data = _file_bytes(path, maximum=_MAX_MANIFEST_BYTES)
    if hashlib.sha256(data).hexdigest() != QA02_FIVE_INPUT_MANIFEST_SHA256:
        _reject("MANIFEST_CHANGED", "QA02 manifest is not the frozen five-input version")
    try:
        raw = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_pairs)
    except (UnicodeDecodeError, ValueError, TypeError):
        _reject("MANIFEST_INVALID", "QA02 manifest JSON is invalid")
    if not isinstance(raw, dict) or (
        raw.get("kind") != "QA02_MLT_SYNTHETIC_FIVE_INPUT_MANIFEST"
        or raw.get("status") != "FIVE_INPUTS_FROZEN_NO_MLT"
        or raw.get("usage") != "SYNTHETIC_TEST_ONLY"
        or not isinstance(raw.get("spec_sha256"), str)
        or raw["spec_sha256"].lower() != ART04_MLT_TEST_SPEC_SHA256
        or raw.get("output_directory") != str(path.parent)
    ):
        _reject("MANIFEST_INVALID", "QA02 manifest scope or specification differs")
    entries = raw.get("files")
    if not isinstance(entries, list) or len(entries) != 5:
        _reject("MANIFEST_INVALID", "QA02 manifest needs exactly five inputs")
    files: dict[str, _FixtureFile] = {}
    file_content: dict[str, bytes] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            _reject("MANIFEST_INVALID", "QA02 file entry is invalid")
        name, digest, size, text_path = (
            entry.get("name"),
            entry.get("sha256"),
            entry.get("bytes"),
            entry.get("path"),
        )
        if (
            not isinstance(name, str)
            or name not in _FILE_NAMES
            or name in files
            or entry.get("usage") != "SYNTHETIC_TEST_ONLY"
            or not isinstance(digest, str)
            or _HEX.fullmatch(digest) is None
            or isinstance(size, bool)
            or not isinstance(size, int)
            or not 0 < size <= _MAX_FIXTURE_FILE_BYTES
            or not isinstance(text_path, str)
            or Path(text_path) != path.parent / name
        ):
            _reject("MANIFEST_INVALID", "QA02 file identity is incomplete")
        source = Path(text_path)
        content = _file_bytes(source, maximum=_MAX_FIXTURE_FILE_BYTES)
        if len(content) != size or hashlib.sha256(content).hexdigest() != digest.lower():
            _reject("FIXTURE_CHANGED", "QA02 input bytes differ from their manifest")
        files[name] = _FixtureFile(source, digest.lower(), size)
        file_content[name] = content
    if set(files) != set(_FILE_NAMES):
        _reject("MANIFEST_INVALID", "QA02 manifest names are incomplete")
    try:
        subtitle = file_content["subtitle-test.srt"].decode("utf-8")
    except UnicodeDecodeError:
        _reject("SUBTITLE_INVALID", "TEST SRT is not readable UTF-8")
    expected_srt = (
        "1\n00:00:01,000 --> 00:00:02,000\nTEST 提示音一（非语音）\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\nTEST 提示音二（非语音）"
    )
    if subtitle.replace("\r\n", "\n") != expected_srt:
        _reject("SUBTITLE_INVALID", "TEST SRT differs from the two exact cues")
    for key in (
        "project_id",
        "episode_id",
        "test_script_version_id",
        "test_script_content_hash",
        "first_script_block_id",
        "second_script_block_id",
        "ffmpeg_sha256",
        "ffprobe_sha256",
    ):
        if not isinstance(raw.get(key), str) or not raw[key]:
            _reject("MANIFEST_INVALID", "QA02 script or tool identity is missing")
    return _FixtureManifest(
        project_id=raw["project_id"],
        episode_id=raw["episode_id"],
        script_version_id=raw["test_script_version_id"],
        script_content_hash=raw["test_script_content_hash"],
        first_block_id=raw["first_script_block_id"],
        second_block_id=raw["second_script_block_id"],
        files=files,
        ffmpeg_sha256=raw["ffmpeg_sha256"].lower(),
        ffprobe_sha256=raw["ffprobe_sha256"].lower(),
    )


def _read_script_record(
    database_path: Path,
    manifest: _FixtureManifest,
) -> ArtifactVersionRecord:
    uri = f"{database_path.as_uri()}?mode=ro&immutable=1&cache=private"
    try:
        with closing(sqlite3.connect(uri, uri=True, timeout=0)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            version_row = connection.execute(
                """SELECT version.* FROM artifact_versions AS version
                   JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
                   WHERE artifact.project_id = ? AND artifact.episode_id = ?
                     AND artifact.artifact_type = 'episode_script'
                     AND version.version_id = ?""",
                (manifest.project_id, manifest.episode_id, manifest.script_version_id),
            ).fetchone()
            if version_row is None:
                _reject("SCRIPT_NOT_FOUND", "QA02 script version is absent from the selected DB")
            head_row = connection.execute(
                "SELECT * FROM artifact_heads WHERE artifact_id = ?",
                (version_row["artifact_id"],),
            ).fetchone()
            if head_row is None or head_row["latest_version_id"] != manifest.script_version_id:
                _reject("SCRIPT_CHANGED", "QA02 script head differs from the frozen version")
            span_rows = connection.execute(
                "SELECT * FROM artifact_source_spans WHERE version_id = ? "
                "ORDER BY fact_id, start_byte, span_id",
                (manifest.script_version_id,),
            ).fetchall()
            dependency_rows = connection.execute(
                "SELECT * FROM artifact_dependencies WHERE downstream_version_id = ? "
                "ORDER BY dependency_id",
                (manifest.script_version_id,),
            ).fetchall()
            record = ArtifactVersionRecord(
                version=StudioRepository._artifact_version_from_row(version_row),
                head=StudioRepository._artifact_head_from_row(head_row),
                source_spans=tuple(
                    StudioRepository._artifact_source_span_from_row(row) for row in span_rows
                ),
                dependencies=tuple(
                    StudioRepository._artifact_dependency_from_row(row) for row in dependency_rows
                ),
            )
            connection.commit()
    except TestSelectionError:
        raise
    except (sqlite3.Error, ValueError, TypeError, KeyError):
        _reject("SCRIPT_READ_UNKNOWN", "QA02 script could not be read authoritatively")
    if (
        record.version.content_hash != manifest.script_content_hash
        or record.version.schema_version != "1.0.0"
        or record.version.artifact_id != record.head.artifact_id
    ):
        _reject("SCRIPT_CHANGED", "QA02 script identity differs from its manifest")
    try:
        content = EpisodeScriptContentV1.model_validate(record.version.content)
    except ValueError:
        _reject("SCRIPT_INVALID", "QA02 script content is not a valid EpisodeScript")
    if content.project_id != manifest.project_id or content.episode_id != manifest.episode_id:
        _reject("SCRIPT_CHANGED", "QA02 script belongs to another episode")
    blocks = {block.block_id: block for scene in content.scenes for block in scene.blocks}
    first = blocks.get(manifest.first_block_id)
    second = blocks.get(manifest.second_block_id)
    if (
        first is None
        or second is None
        or first.kind != "DIALOGUE"
        or second.kind != "DIALOGUE"
        or first.text != "TEST 提示音一（非语音）"
        or second.text != "TEST 提示音二（非语音）"
        or first.speaker != "TEST 提示音（非人声）"
        or second.speaker != "TEST 提示音（非人声）"
        or first.delivery != "OFF_SCREEN"
        or second.delivery != "OFF_SCREEN"
    ):
        _reject("SCRIPT_CHANGED", "QA02 script blocks differ from the frozen TEST fixture")
    return record


def _read_video_probe(
    database_path: Path,
    selected: SelectedMediaAssetVersion,
) -> MediaAssetProbeEvidence:
    uri = f"{database_path.as_uri()}?mode=ro&immutable=1&cache=private"
    try:
        with closing(sqlite3.connect(uri, uri=True, timeout=0)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            row = connection.execute(
                """SELECT * FROM media_asset_probe_evidence
                   WHERE project_id = ? AND asset_id = ? AND version_id = ?""",
                (selected.project_id, selected.asset_id, selected.version_id),
            ).fetchone()
            if row is None:
                _reject("VIDEO_PROBE_MISSING", "Selected video has no persisted probe")
            probe = _from_row(row)
            connection.commit()
    except TestSelectionError:
        raise
    except (sqlite3.Error, MediaAssetProbeEvidenceError, ValueError, TypeError):
        _reject("VIDEO_PROBE_UNKNOWN", "Persisted video probe is invalid")
    if probe.asset_sha256 != selected.sha256 or probe.byte_size != selected.byte_size:
        _reject("VIDEO_PROBE_CHANGED", "Video probe differs from the selected ASV")
    return probe


def _selector_names(request: TestSelectionRequest) -> dict[str, AssetVersionSelector]:
    return {
        "v1-blue.webm": request.blue_video,
        "v2-red.webm": request.red_video,
        "dialogue-test.wav": request.dialogue_tone,
        "bgm-test.wav": request.bgm_tone,
    }


def _verified_media(
    database_path: Path,
    manifest: _FixtureManifest,
    name: str,
    selector: AssetVersionSelector,
) -> _VerifiedMedia:
    entry = manifest.files[name]
    read = read_selected_media_asset_version(
        database_path,
        manifest.project_id,
        selector.asset_id,
        selector.version_id,
    )
    selected = read.version
    expected_kind: Literal["video", "audio"] = "video" if name.endswith(".webm") else "audio"
    if (
        read.status != "VERIFIED"
        or selected is None
        or selected.kind != expected_kind
        or selected.sha256 != entry.sha256
        or selected.byte_size != entry.byte_size
    ):
        _reject("ASSET_SELECTION_CONFLICT", "Selected ASV differs from the frozen QA source")
    rights_read = read_latest_rights_decision(
        database_path,
        manifest.project_id,
        selector.asset_id,
        selector.version_id,
    )
    rights = rights_read.decision
    if (
        rights_read.status != "VERIFIED"
        or rights is None
        or rights.decision != "CLEARED"
        or not rights.chain_integrity
        or rights.asset_sha256 != selected.sha256
        or rights.revision != rights_read.current_revision
    ):
        _reject("RIGHTS_NOT_CLEARED", "Selected ASV lacks latest verified CLEARED rights")
    path = _managed_path(database_path, selected.sha256)
    try:
        # The readbacks above verified bytes. Check the managed I/O spelling
        # once more while retaining the logical path in MltFileIdentity.
        managed_io = managed_local_io_path(database_path.parent, path)
        if not managed_io.is_file() or managed_io.stat().st_size != selected.byte_size:
            _reject("ASSET_SELECTION_CONFLICT", "Selected managed media is unavailable")
    except TestSelectionError:
        raise
    except (OSError, ValueError):
        _reject("ASSET_SELECTION_CONFLICT", "Selected managed media path is unsafe")
    probe: MediaAssetProbeEvidence | None = None
    audio: VerifiedTestAudio | None = None
    if expected_kind == "video":
        probe = _read_video_probe(database_path, selected)
        video = probe.probe.video
        if (
            probe.ffmpeg_sha256 != manifest.ffmpeg_sha256
            or probe.ffprobe_sha256 != manifest.ffprobe_sha256
            or video.is_variable_frame_rate
            or (video.average_frame_rate.num, video.average_frame_rate.den) != (25, 1)
            or (video.width, video.height, len(video.frames)) != (320, 568, 75)
            or probe.probe.audio is not None
        ):
            _reject("VIDEO_PROBE_CONFLICT", "Selected video differs from the frozen CFR test")
        ref = ExecutionMediaRefV1(
            asset_id=selected.asset_id,
            asset_version_id=selected.version_id,
            sha256=selected.sha256,
            byte_size=selected.byte_size,
            rights_status="CLEARED",
            rights_decision_id=rights.decision_id,
            probe_evidence_id=probe.id,
            probe_sha256=probe.probe_sha256,
        )
    else:
        expected_samples: Literal[48000, 240000] = 48000 if name == "dialogue-test.wav" else 240000
        audio = inspect_selected_test_wav(
            database_path,
            manifest.project_id,
            selected.asset_id,
            selected.version_id,
            expected_samples=expected_samples,
        )
        if audio.selected != selected or audio.managed_path != path:
            _reject("AUDIO_SELECTION_CHANGED", "Selected WAV changed during inspection")
        ref = ExecutionMediaRefV1(
            asset_id=selected.asset_id,
            asset_version_id=selected.version_id,
            sha256=selected.sha256,
            byte_size=selected.byte_size,
            rights_status="CLEARED",
            rights_decision_id=rights.decision_id,
            inspection_sha256=audio.inspection.inspection_sha256,
        )
    return _VerifiedMedia(
        ref=ref,
        file=MltFileIdentity(path=path, sha256=selected.sha256),
        rights=rights,
        probe=probe,
        audio=audio,
    )


def prepare_test_selection(request: TestSelectionRequest) -> ResolvedEngineeringTest:
    """Resolve only the fixed QA02 TEST; all selectors must name real readbacks."""
    names = _selector_names(request)
    if len({(item.asset_id, item.version_id) for item in names.values()}) != 4:
        _reject("ASSET_SELECTION_CONFLICT", "Four named TEST inputs need distinct ASV selectors")
    with _frozen_database(request.database_path):
        manifest = _load_manifest(request.manifest_path)
        script_record = _read_script_record(request.database_path, manifest)
        verified = {
            name: _verified_media(request.database_path, manifest, name, selector)
            for name, selector in names.items()
        }
        if len({item.ref.sha256 for item in verified.values()}) != 4:
            _reject("ASSET_SELECTION_CONFLICT", "The four TEST media bytes must be distinct")
        blue, red = verified["v1-blue.webm"], verified["v2-red.webm"]
        dialogue, bgm = verified["dialogue-test.wav"], verified["bgm-test.wav"]
        if blue.probe is None or red.probe is None or dialogue.audio is None or bgm.audio is None:
            _reject("INSPECTION_MISSING", "TEST source inspection is incomplete")
        bindings = FrozenEngineeringTestBindingsV1(
            test_spec_sha256=ART04_MLT_TEST_SPEC_SHA256,
            fixture_manifest_sha256=QA02_FIVE_INPUT_MANIFEST_SHA256,
            project_id=manifest.project_id,
            episode_id=manifest.episode_id,
            blue_video=blue.ref,
            red_video=red.ref,
            dialogue_tone=dialogue.ref,
            bgm_tone=bgm.ref,
            test_script_version_id=manifest.script_version_id,
            test_script_content_hash=manifest.script_content_hash,
            first_script_block_id=manifest.first_block_id,
            second_script_block_id=manifest.second_block_id,
            subtitle_file_sha256=manifest.files["subtitle-test.srt"].sha256,
            dialogue_gain_millidb=0,
            bgm_gain_millidb=0,
            subtitle_font_family=request.subtitle_style.font_family,
            subtitle_font_size_px=request.subtitle_style.font_size_px,
            subtitle_color_rgba=request.subtitle_style.color_rgba,
        )
        plan = build_art04_synthetic_execution_plan(
            bindings,
            test_script_record=script_record,
            blue_probe=blue.probe,
            red_probe=red.probe,
            dialogue_inspection=dialogue.audio.inspection,
            bgm_inspection=bgm.audio.inspection,
        )
        return ResolvedEngineeringTest(
            request=request,
            bindings=bindings,
            plan=plan,
            fixture_manifest=MltFileIdentity(
                path=request.manifest_path,
                sha256=QA02_FIVE_INPUT_MANIFEST_SHA256,
            ),
            subtitle_file=MltFileIdentity(
                path=manifest.files["subtitle-test.srt"].path,
                sha256=manifest.files["subtitle-test.srt"].sha256,
            ),
            selected_media=tuple(verified[name] for name in names),
        )
