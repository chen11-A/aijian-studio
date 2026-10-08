import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pure JSON data reproduction. No source-file access and no staging writes.
const control = path.dirname(fileURLToPath(import.meta.url));
const inputPath = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260929-packaged-isolated-readonly-plan-1\\INPUTS.json";
const oldPrePath = "C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\native-source-qa-20260924\\qa02-packaged-staging-control-20260929\\PRE.json";
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
const inputBytes = fs.readFileSync(inputPath);
const preBytes = fs.readFileSync(oldPrePath);
assert.equal(sha(inputBytes), "9B25674215BBC53C0BA9134EAAA5A2462F235083CCD3AF2FB8B1760E323F6A5E");
assert.equal(sha(preBytes), "2B6D05B6477F47B64AB3CB79F36D1FB08A47831AFB460F266FC68EF10B4587AC");
const input = JSON.parse(inputBytes);
const pre = JSON.parse(preBytes);
assert.equal(input.inputs.length, 74);
assert.equal(pre.rows.length, 74);
const manifestVersionFields = input.inputs.filter((item) => Object.hasOwn(item, "version")).length;
const preVersionFields = pre.rows.filter((item) => Object.hasOwn(item, "version")).length;
assert.equal(manifestVersionFields, 0, "unexpected required manifest version field");
assert.equal(preVersionFields, 3, "unexpected PRE derived version count");

const original = { destination: input.inputs[0].destination, version: undefined };
const roundTrip = JSON.parse(JSON.stringify(original));
let originalComparisonFails = false;
try { assert.deepStrictEqual(original, roundTrip); }
catch (error) { originalComparisonFails = error?.code === "ERR_ASSERTION"; }
assert.equal(originalComparisonFails, true, "old comparison did not reproduce");

const normalized = { destination: input.inputs[0].destination, version: null };
const normalizedRoundTrip = JSON.parse(JSON.stringify(normalized));
assert.deepStrictEqual(normalized, normalizedRoundTrip);
const allNormalized = pre.rows.map((row) => ({ ...row, version: row.version ?? null }));
assert.deepStrictEqual(allNormalized, JSON.parse(JSON.stringify(allNormalized)));

const result = {
  schema: "qa02.stage-74-version-json-repro.v1",
  boundary: "pure manifest/PRE JSON data; no source-file reads, copy, stage, Electron, sidecar, or c19 write",
  inputSha256: sha(inputBytes), oldPreSha256: sha(preBytes),
  inputRows: input.inputs.length, preRows: pre.rows.length,
  manifestVersionFields, preDerivedVersionFields: preVersionFields,
  preMissingVersionFields: pre.rows.length - preVersionFields,
  originalComparisonFails, normalizedNullRoundTripPasses: true,
  conclusion: "version is QA-derived optional metadata; undefined-vs-omitted JSON property caused control-script false RED",
};
fs.writeFileSync(path.join(control, "REPRO.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
