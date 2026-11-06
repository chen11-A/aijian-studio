"""Post-tag clean-copy ownership evidence, with no paid provider calls."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import aijian_api.story_film as story_module
from aijian_api.story_film import StoryFilmService
from test_draft_export_runtime import toolchain
from test_story_film import _film_without_clean_copy, _project, _request

ROOT = Path(__file__).resolve().parents[3]


def test_final_clean_copy_evidence_keeps_original_draft_hash_and_is_readable_by_node(
    tmp_path, monkeypatch
):
    repository, project_id = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    actual_tag = story_module._tag_ai_generated
    tagged: dict[str, tuple[str, str]] = {}

    def tag(ffmpeg, ffprobe, path):
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        actual_tag(ffmpeg, ffprobe, path)
        tagged[str(path.resolve())] = (before, hashlib.sha256(path.read_bytes()).hexdigest())

    monkeypatch.setattr(story_module, "_tag_ai_generated", tag)
    result = service.produce(project_id, _request())
    assert result.status == "SUCCEEDED", result.message
    assert result.clean_output_path
    path = Path(result.clean_output_path).resolve()
    before, after = tagged[str(path)]
    assert before != after
    with repository._connection() as connection:
        row = connection.execute(
            """SELECT version.content_json FROM artifact_versions AS version
               JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
               WHERE artifact.project_id = ?
                 AND artifact.artifact_type = 'story_film_clean_copy'""",
            (project_id,),
        ).fetchone()
        draft = connection.execute(
            "SELECT output_sha256 FROM draft_export_jobs "
            "WHERE output_path = ? AND status = 'SUCCEEDED'",
            (str(path),),
        ).fetchone()
    evidence = json.loads(row["content_json"])
    assert evidence["output_path"] == str(path)
    assert evidence["output_sha256"] == after
    assert evidence["assembly_version_id"]
    assert evidence["release_claim"] is False
    assert draft["output_sha256"] == before
    node = shutil.which("node")
    assert node, "Node is required to verify the real main-process reader"
    script = """
import { pathToFileURL } from 'node:url';
const { storyFilmQcOwner } = await import(pathToFileURL(process.argv[1]).href);
const [database, project, path, hash] = process.argv.slice(2);
console.log(JSON.stringify([
 storyFilmQcOwner(database,project,path,hash),
 storyFilmQcOwner(database,'prj_'+'b'.repeat(32),path,hash),
 storyFilmQcOwner(database,project,path+'.foreign',hash),
 storyFilmQcOwner(database,project,path,'a'.repeat(64))
]));
"""
    observed = subprocess.run(
        [
            node,
            "--input-type=module",
            "--eval",
            script,
            str(ROOT / "apps/desktop/src/film-export-qc-ownership.ts"),
            str(repository.database_path),
            project_id,
            str(path),
            after,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert json.loads(observed.stdout) == [True, False, False, False]


def test_clean_copy_evidence_write_failure_is_not_reported_as_a_usable_copy(tmp_path, monkeypatch):
    repository, _project_id, service, film = _film_without_clean_copy(tmp_path, monkeypatch)
    original = repository.create_artifact_version

    def create(**kwargs):
        if kwargs["artifact_type"] == "story_film_clean_copy":
            raise OSError("synthetic evidence write failure")
        return original(**kwargs)

    monkeypatch.setattr(repository, "create_artifact_version", create)
    result = service.remake_clean_copy(str(film))
    assert result.status == "FAILED"
    assert result.clean_output_path is None
    assert result.clean_copy_error == "CLEAN_COPY_EVIDENCE_FAILED"
    assert result.clean_copy_reason == "不带字幕的那份没有做出来（最终素材归属记录没能保存）"
