import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pure PRE/manifest JSON regression check; no source read or stage copy.
const control = path.dirname(fileURLToPath(import.meta.url));
const prePath = path.join(control, "PRE.json");
const inputPath = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260929-packaged-isolated-readonly-plan-1\\INPUTS.json";
const stage = "C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\native-source-qa-20260924\\qa02-packaged-staging-r2-20260929";
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
const preBytes = fs.readFileSync(prePath);
const inputBytes = fs.readFileSync(inputPath);
const pre = JSON.parse(preBytes);
const input = JSON.parse(inputBytes);
assert.equal(sha(inputBytes), "9B25674215BBC53C0BA9134EAAA5A2462F235083CCD3AF2FB8B1760E323F6A5E");
assert.equal(pre.rows.length, 74);
assert.equal(input.inputs.length, 74);
assert.equal(fs.existsSync(stage), false);
const versionKeyCount = pre.rows.filter((item) => Object.hasOwn(item, "version")).length;
const nullCount = pre.rows.filter((item) => item.version === null).length;
const objectCount = pre.rows.filter((item) => item.version !== null && typeof item.version === "object").length;
assert.equal(versionKeyCount, 74);
assert.equal(nullCount, 71);
assert.equal(objectCount, 3);
assert.deepStrictEqual(pre.rows, JSON.parse(JSON.stringify(pre.rows)));
assert.equal(input.inputs.filter((item) => Object.hasOwn(item, "version")).length, 0);
const output = { schema: "qa02.stage-74-fixed-pre-json-regression.v1",
  boundary: "pure PRE/manifest JSON; no source read, stage copy, Electron, sidecar, or c19 write",
  inputSha256: sha(inputBytes), preSha256: sha(preBytes), rows: pre.rows.length,
  versionKeyCount, nullCount, derivedObjectCount: objectCount, roundTripDeepEqual: true,
  stageExists: false };
fs.writeFileSync(path.join(control, "REGRESSION.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
