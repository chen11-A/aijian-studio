"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const QA = __dirname;
const RUN = path.join(QA, "run-01");
const PACKET = path.join(QA, "RUN-PACKET.json");
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
const expectedFiles = ["CLOSURE.json", "snapshot-closure.cjs", "tsconfig.release.qa.json", "runtime-probe.cjs", "fake-child.cjs", "run-once.cjs"];
const packet = JSON.parse(fs.readFileSync(PACKET, "utf8"));
function assert(condition, message) { if (!condition) throw new Error(message); }
function checkInputs() {
  for (const name of expectedFiles) {
    assert(hash(path.join(QA, name)) === packet.inputs[name], "Frozen input drift: " + name);
  }
  assert(hash(packet.sourceSnapshotPath) === packet.sourceSnapshotSha256, "Frozen DEV07 snapshot drift");
  assert(process.version === packet.nodeVersion, "Node version drift");
  assert(path.resolve(process.execPath).toLowerCase() === packet.nodeExecutable.toLowerCase(), "Node executable drift");
  const closure = cp.spawnSync(process.execPath, [path.join(QA, "snapshot-closure.cjs"), "check"], {
    cwd: QA, encoding:"utf8", timeout:30000, maxBuffer:32*1024*1024,
  });
  assert(closure.status === 0, "Closure check RED: " + String(closure.stderr).slice(0,4000));
}
function listFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(p));
    else if (entry.isFile()) found.push(p);
    else throw new Error("Unexpected output link: " + p);
  }
  return found;
}
function runPhase(name, args, cwd, timeout) {
  const result = cp.spawnSync(process.execPath, args, {
    cwd, timeout, encoding:"buffer", maxBuffer:32*1024*1024,
    windowsHide:true,
  });
  const stdout = path.join(RUN, name + ".stdout.bin");
  const stderr = path.join(RUN, name + ".stderr.bin");
  fs.writeFileSync(stdout, result.stdout || Buffer.alloc(0), {flag:"wx"});
  fs.writeFileSync(stderr, result.stderr || Buffer.alloc(0), {flag:"wx"});
  const record = {
    name, args, cwd, status:result.status, signal:result.signal,
    error:result.error ? String(result.error) : null,
    stdout:{path:stdout, bytes:fs.statSync(stdout).size, sha256:hash(stdout)},
    stderr:{path:stderr, bytes:fs.statSync(stderr).size, sha256:hash(stderr)},
  };
  receipt.phases.push(record);
  writeReceipt();
  assert(result.status === 0 && !result.error, name + " RED");
  checkInputs();
  return record;
}
function writeReceipt() {
  fs.writeFileSync(path.join(RUN, "RECEIPT.json"), JSON.stringify(receipt,null,2)+"\n");
}
const approvalPath = process.argv[2];
const approvalSha = process.argv[3];
assert(approvalPath && approvalSha, "Usage: node run-once.cjs <approval.json> <approval SHA256>");
assert(hash(PACKET) === approvalSha, "Packet SHA argument mismatch");
const approval = JSON.parse(fs.readFileSync(approvalPath,"utf8"));
assert(approval.schema === "qa03.desktop.r1.ts.approval.v1" && approval.state === "APPROVED", "No MGR02 approval");
assert(approval.packetSha256 === approvalSha && approval.approvedBy === "MGR02", "Approval does not bind packet");
assert(packet.state === "PREPARED_NOT_APPROVED_NOT_RUN", "Packet state mismatch");
checkInputs();
assert(!fs.existsSync(RUN), "run-01 already exists; no rerun");
fs.mkdirSync(RUN);
const receipt = {
  schema:"qa03.desktop.r1.ts.receipt.v1", state:"RUNNING",
  packetSha256:approvalSha, approvalSha256:hash(approvalPath),
  startedAt:new Date().toISOString(), pid:process.pid,
  nodeVersion:process.version, phases:[], outputFiles:[],
};
writeReceipt();
try {
  const author = packet.authorRoot;
  const tsc = packet.tscBin;
  const fullConfig = path.join(author,"apps","desktop","tsconfig.json");
  const releaseConfig = path.join(QA,"tsconfig.release.qa.json");
  runPhase("full-typecheck", [tsc,"--noEmit","-p",fullConfig], path.join(author,"apps","desktop"), 120000);
  runPhase("release-typecheck", [tsc,"--noEmit","-p",releaseConfig], QA, 120000);
  runPhase("release-build", [tsc,"-p",releaseConfig], QA, 120000);
  const dist = path.join(RUN,"dist");
  assert(fs.existsSync(dist), "No emitted dist");
  const outputs = listFiles(dist);
  assert(outputs.some(x=>x.toLowerCase()===path.join(dist,"main.js").toLowerCase()), "main.js absent");
  assert(outputs.some(x=>x.toLowerCase()===path.join(dist,"preload.js").toLowerCase()), "preload.js absent");
  assert(outputs.some(x=>x.toLowerCase()===path.join(dist,"sidecar-process.js").toLowerCase()), "sidecar-process.js absent");
  assert(outputs.some(x=>x.toLowerCase()===path.join(dist,"sidecar-extraction-temp.js").toLowerCase()), "sidecar-extraction-temp.js absent");
  assert(outputs.every(x=>!x.endsWith(".test.js")&&!x.includes("fixture")), "Test or fixture emit");
  receipt.outputFiles=outputs.map(x=>({path:x,bytes:fs.statSync(x).size,sha256:hash(x)}));
  writeReceipt();
  runPhase("controlled-temp-child", [path.join(QA,"runtime-probe.cjs")], QA, 30000);
  receipt.state="PASS_LOCAL_TS_AND_FAKE_CHILD_ONLY";
} catch(error) {
  receipt.state="RED_STOP";
  receipt.failure=String(error?.stack||error);
  process.exitCode=1;
} finally {
  receipt.finishedAt=new Date().toISOString();
  try { checkInputs(); receipt.closureAfterRun="MATCH"; }
  catch(error) { receipt.closureAfterRun="DRIFT"; receipt.state="RED_STOP"; receipt.failure=(receipt.failure||"")+"\n"+String(error); process.exitCode=1; }
  writeReceipt();
  process.stdout.write(JSON.stringify({state:receipt.state,receipt:path.join(RUN,"RECEIPT.json")})+"\n");
}



