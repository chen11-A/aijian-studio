/** Tests the actual private resume proof reader without running a Windows binary. */
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReinstallProof, sha256Bytes } from "./windows-integrated-reinstall-proof.mjs";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "integrated-reinstall-proof-")),
    profile = join(root, "profile");
  mkdirSync(profile);
  const id = `prj_${"a".repeat(32)}`,
    context = {
      candidateHead: "a".repeat(40),
      executable: join(root, "AIVORA.exe"),
      userData: profile,
      installerSha256: "b".repeat(64),
      executableSha256: "c".repeat(64),
    };
  const proof = {
    schemaVersion: 1,
    ...context,
    outputSha256: "d".repeat(64),
    saved: {
      projectId: id,
      project: { id, all: { original: "raw" } },
      source: { id: "source", project_id: id },
      episode: { id: "episode", project_id: id },
      preferences: { saved: true, user_name: "原保存设置", revision: 1 },
      film: {
        status: "SUCCEEDED",
        live_call: false,
        output_path: join(profile, "workspace", "sample.mp4"),
      },
    },
  };
  const file = join(root, "checkpoint.json");
  const save = () => {
    const bytes = Buffer.from(JSON.stringify(proof));
    writeFileSync(file, bytes);
    return sha256Bytes(bytes);
  };
  return { root, file, context, proof, save };
}
test("the exact first-run private proof is read in full, never replaced with a seed", () => {
  const f = fixture();
  try {
    assert.deepEqual(readReinstallProof(f.file, f.save(), f.context), f.proof);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("wrong SHA, candidate, executable, profile or installer identity cannot authorize resume", () => {
  const f = fixture();
  try {
    const hash = f.save();
    assert.throws(() => readReinstallProof(f.file, "0".repeat(64), f.context));
    for (const key of Object.keys(f.context)) {
      assert.throws(() => readReinstallProof(f.file, hash, { ...f.context, [key]: "DIFFERENT" }));
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("foreign sample identities, outside output, live result and unsaved settings fail even with matching proof bytes", () => {
  for (const mutate of [
    (p) => (p.saved.project.id = "prj_bad"),
    (p) => (p.saved.source.project_id = "foreign"),
    (p) => (p.saved.episode.project_id = "foreign"),
    (p) => (p.saved.film.output_path = join(tmpdir(), "outside.mp4")),
    (p) => (p.saved.film.live_call = true),
    (p) => (p.saved.preferences.saved = false),
    (p) => (p.extra = "PRIVATE"),
  ]) {
    const f = fixture();
    try {
      mutate(f.proof);
      assert.throws(() => readReinstallProof(f.file, f.save(), f.context));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});
test("empty, invalid JSON and over-bound proof fail rather than truncating actual raw", () => {
  const f = fixture();
  try {
    for (const bytes of [Buffer.alloc(0), Buffer.from("{"), Buffer.alloc(16 * 1024 * 1024 + 1)]) {
      writeFileSync(f.file, bytes);
      assert.throws(() => readReinstallProof(f.file, sha256Bytes(bytes), f.context));
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
