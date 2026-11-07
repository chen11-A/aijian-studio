/** Private CI-only resume proof. Never ship or upload its raw project/settings data. */
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
export const sha256Bytes = (value) => createHash("sha256").update(value).digest("hex");
export function inside(root, file) {
  const part = relative(resolve(root), resolve(file));
  return !!part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}
export function readReinstallProof(file, expectedSha, context) {
  assert.match(expectedSha, /^[0-9a-f]{64}$/);
  assert(
    statSync(file).size > 0 && statSync(file).size <= 16 * 1024 * 1024,
    "Private proof exceeds its bound",
  );
  const bytes = readFileSync(file);
  assert.equal(sha256Bytes(bytes), expectedSha, "Private proof bytes changed");
  let proof;
  try {
    proof = JSON.parse(bytes);
  } catch {
    throw new Error("Private proof JSON is invalid");
  }
  assert(
    isDeepStrictEqual(
      Object.keys(proof).sort(),
      [
        "candidateHead",
        "executable",
        "executableSha256",
        "installerSha256",
        "outputSha256",
        "saved",
        "schemaVersion",
        "userData",
      ].sort(),
    ),
    "Private proof shape is invalid",
  );
  assert.equal(proof.schemaVersion, 1);
  for (const key of [
    "candidateHead",
    "executable",
    "userData",
    "installerSha256",
    "executableSha256",
  ])
    assert(proof[key] === context[key], "Resume candidate/install identity mismatch");
  assert.match(proof.candidateHead, /^[0-9a-f]{40}$/);
  for (const key of ["installerSha256", "executableSha256", "outputSha256"])
    assert.match(proof[key], /^[0-9a-f]{64}$/);
  assert.match(proof.saved.projectId, /^prj_[0-9a-f]{32}$/);
  assert.equal(proof.saved.project.id, proof.saved.projectId);
  assert.equal(proof.saved.episode.project_id, proof.saved.projectId);
  assert.equal(proof.saved.source.project_id, proof.saved.projectId);
  assert.equal(proof.saved.film.status, "SUCCEEDED");
  assert.equal(proof.saved.film.live_call, false);
  assert(
    inside(context.userData, proof.saved.film.output_path),
    "Stored sample must remain inside this profile",
  );
  assert.equal(proof.saved.preferences.saved, true);
  return proof;
}
