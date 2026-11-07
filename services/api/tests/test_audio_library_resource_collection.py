"""All collectors delegate to the same reviewed bundle builder; compile once per test session."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
REAL_RUN = subprocess.run


@pytest.fixture(scope="module")
def built_audio(tmp_path_factory: pytest.TempPathFactory) -> Path:
    destination = tmp_path_factory.mktemp("actual-audio-builder") / "audio-library"
    REAL_RUN(
        [
            "node",
            str(ROOT / "scripts/build-audio-library-resources.mjs"),
            "--out-dir",
            str(destination),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return destination


@pytest.mark.parametrize(
    ("script", "mode"),
    [
        ("packaging/windows/freeze-sidecar.py", "packaged"),
        ("packaging/linux/package-desktop.py", "portable"),
        ("scripts/package-native-linux-checkpoint.py", "portable"),
        (None, "development"),
    ],
)
def test_audio_collection_uses_the_same_actual_runtime_and_public_evidence(
    script: str | None,
    mode: str,
    built_audio: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = tmp_path / "layout"
    resources = output / "resources"
    main_dir = (
        resources / "app/apps/desktop/dist" if mode == "packaged" else output / "apps/desktop/dist"
    )
    main_dir.mkdir(parents=True)
    parent = resources if mode == "packaged" else main_dir if mode == "development" else output
    destination = parent / "audio-library"
    calls: list[list[str]] = []

    def staged(command: list[str], **options: object) -> subprocess.CompletedProcess[str]:
        assert command == [
            "node",
            str(ROOT / "scripts/build-audio-library-resources.mjs"),
            "--out-dir",
            str(destination.resolve()),
        ]
        assert options == {"cwd": ROOT, "check": True, "capture_output": True, "text": True}
        calls.append(command)
        # Reuse the one genuinely compiled bundle; do not compile/re-hash 206 sources
        # three times merely to exercise identical packaging delegation.
        shutil.copytree(built_audio, destination)
        return subprocess.CompletedProcess(command, 0, "", "")

    if script:
        spec = importlib.util.spec_from_file_location("audio_collector_fixture", ROOT / script)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        monkeypatch.setattr(module.subprocess, "run", staged)
        module.stage_audio_library_resources(destination)
        assert len(calls) == 1
    else:
        shutil.copytree(built_audio, destination)
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    index = json.loads((destination / "resource-index.json").read_text(encoding="utf-8"))
    assert len(manifest) == index["assetCount"] == 206
    assert (
        hashlib.sha256((destination / "manifest.json").read_bytes()).hexdigest()
        == index["manifestSha256"]
    )
    for module, field in (
        ("audio-picker.mjs", "pickerSha256"),
        ("audio-picker-synonyms.mjs", "synonymsSha256"),
    ):
        assert hashlib.sha256((destination / module).read_bytes()).hexdigest() == index[field]
    picker_digest = hashlib.sha256(
        json.dumps(
            ["audio-picker-runtime-v1", index["pickerSha256"], index["synonymsSha256"]],
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    assert (destination / "LICENSES.md").read_bytes() == (
        ROOT / "assets/audio-library/LICENSES.md"
    ).read_bytes()
    for row in index["files"]:
        assert hashlib.sha256((destination / row["path"]).read_bytes()).hexdigest() == row["sha256"]
    assert not list(destination.rglob("*.mp3"))
    assert not list(destination.rglob("*.wav"))
    assert not list(destination.rglob("*.py"))
    # Execute the actual main-owned resolver and trusted loader in the real collector
    # layout. Transpilation only removes TS; no substitute root-selection implementation.
    program = r"""
const fs = require('node:fs'), path = require('node:path');
const [repo, mainDir, resources, packaged, expected] = process.argv.slice(1);
const ts = require(path.join(repo, 'node_modules/typescript'));
for (const name of ['film-audio-library-root', 'film-audio-library-runtime', 'film-export-io']) {
  const source = fs.readFileSync(path.join(repo, 'apps/desktop/src', name+'.ts'), 'utf8');
  const options = {module:ts.ModuleKind.NodeNext,target:ts.ScriptTarget.ES2022};
  const code = ts.transpileModule(source,
    {fileName:name+'.ts',compilerOptions:options}).outputText;
  fs.writeFileSync(path.join(mainDir, name+'.js'), code);
}
(async () => {
  const resolver = require(path.join(mainDir, 'film-audio-library-root.js'));
  const options = {isPackaged:packaged==='1',resourcesPath:resources,mainDir};
  const selected = resolver.resolveBundledAudioLibraryRoot(options);
  const actual = fs.statSync(selected, {bigint:true});
  const wanted = fs.statSync(expected, {bigint:true});
  if (actual.dev!==wanted.dev || actual.ino!==wanted.ino) throw Error('wrong resource identity');
  const runtime = require(path.join(mainDir, 'film-audio-library-runtime.js'));
  const library = await runtime.loadTrustedAudioLibrary(selected);
  const catalog = runtime.publicAudioCatalog(library);
  const picker = await runtime.loadTrustedAudioPicker(selected);
  const raw = picker.pickAudio({duration:130,emotions:['温暖'],description:'温暖场景',
    shots:[{duration:130,hasDialogue:false,actions:[]}]},
    library.assets.map(a=>({...a,path:a.file,duration:a.durationSeconds,loop:a.loopable})));
  await picker.verify();
  console.log(JSON.stringify({count:catalog.assets.length,sha:catalog.manifestSha256,
    picker:picker.sha256,segments:raw.music.segments.length}));
})().catch(() => process.exit(1));
"""
    unrelated = tmp_path / "unrelated-cwd"
    unrelated.mkdir()
    probe = REAL_RUN(
        [
            "node",
            "-e",
            program,
            str(ROOT),
            str(main_dir),
            str(resources),
            "1" if mode == "packaged" else "0",
            str(destination),
        ],
        cwd=unrelated,
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(probe.stdout)
    assert result["count"] == 206
    assert result["sha"] == index["manifestSha256"]
    assert result["picker"] == picker_digest
    assert result["segments"] >= 2
