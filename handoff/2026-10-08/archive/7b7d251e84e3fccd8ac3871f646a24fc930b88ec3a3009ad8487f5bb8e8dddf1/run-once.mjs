import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { captured } from './capture-process.mjs';
import { canonicalDigest } from './canonical-fingerprint.mjs';
const qa = dirname(import.meta.filename);
const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const fingerprint = 'C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa03-ac05-front-20260924/fingerprint.mjs';
const node = process.execPath;
const vitest = join(repo,'apps/studio-web/node_modules/vitest/vitest.mjs');
const argv = Object.fromEntries(process.argv.slice(2).map(arg => {
  const at = arg.indexOf('='); assert.ok(arg.startsWith('--') && at > 2);
  return [arg.slice(2,at),arg.slice(at+1)]; }));
for (const key of ['approval','approval-sha256','output']) assert.ok(argv[key]);
const approvalPath = resolve(argv.approval);
const output = resolve(argv.output);
const rel = relative(qa, output);
assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
assert.ok(!existsSync(output));
assert.notEqual(approvalPath.toLowerCase(),join(qa,'APPROVAL.template.json').toLowerCase());
const sha = data => createHash('sha256').update(data).digest('hex').toUpperCase();
const hash = file => sha(readFileSync(file));
assert.equal(hash(approvalPath),argv['approval-sha256'].toUpperCase());
const approval = JSON.parse(readFileSync(approvalPath,'utf8'));
assert.equal(approval.schema,'qa03.p23-component.one-shot.approval.v1');
assert.equal(approval.state,'APPROVED_SINGLE_RUN');
assert.equal(resolve(approval.outputDir),output);
for (const [file,field] of [['PACKET.json','packetSha256'],
  ['run-once.mjs','runnerSha256'],['p23-settings.test.mjs','testSha256'],
  ['vitest.config.mjs','configSha256'],['capture-process.mjs','captureSha256'],
  ['canonical-fingerprint.mjs','canonicalSha256']])
  assert.equal(hash(join(qa,file)),approval[field],`${file} SHA drift`);
assert.equal(hash(node),approval.nodeSha256);
assert.equal(hash(vitest),approval.vitestSha256);
assert.equal(hash(fingerprint),approval.fingerprintSha256);
assert.equal(hash(approval.webReceiptPath),approval.webReceiptSha256);
assert.equal(approval.webReceiptSha256,'7CE9C71557B70EB12DBBA654258524D4A178A9DA61E2FC52F1CD23A12A6085C1');
assert.equal(JSON.parse(readFileSync(approval.webReceiptPath,'utf8')).state,'WEB_TYPECHECK_BUILD_PASS');
assert.equal(hash(approval.syncReceiptPath),approval.syncReceiptSha256);
assert.equal(approval.syncReceiptSha256,'68984CB8EBD181711D46BF72F76F5B3581E71EB40329760C369708E2FCA1C061');
const source = [
  ['apps/studio-web/src/aivora/SettingsPage.tsx','086C90CCBF3AD20B519CE934DC6A8F0B842E2B8FB5643AFFD54E12F4891E87FA'],
  ['apps/studio-web/src/aivora/model.tsx','0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211'],
  ['apps/studio-web/src/aivora/adapters/projectManagement.ts','7B549DCDBE7A4E3F4051FD815E98B013A07610D995C24BB135EDEBA656F8CD66'],
  ['apps/studio-web/src/api/studio.ts','7521270E03EF55B649E8B0EA150FE859CB04EADFD7D84C0886FD856FDD378679'],
];
for (const [name,expected] of source) assert.equal(hash(join(repo,name)),expected,name);
const git = (...args) => execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trimEnd();
const statusSha = () => sha(git('status','--porcelain','-uall').replace(/\r\n/g,'\n'));
assert.equal(git('rev-parse','HEAD'),approval.head);
assert.equal(statusSha(),approval.statusSha256);
function relatedProcesses() {
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*c19-trim-211c9e8-qa-20260923*' -and $_.ProcessId -ne $PID } | Select-Object ProcessId,Name | ConvertTo-Json -Compress";
  const raw = execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8'}).trim();
  return raw ? [JSON.parse(raw)].flat() : [];
}
assert.equal(relatedProcesses().length,0,'Another c19 process active');
mkdirSync(output);
const receipt = { schema:'qa03.p23-component.receipt.v1',state:'PREFLIGHT_PENDING',
  firstRed:null, startedAt:new Date().toISOString(),approvalSha256:hash(approvalPath),
  output,steps:{},preflight:{},postflight:{},boundary:'local/mock component only; sidecar/Electron NOT_RUN' };
const capture = (name,args,timeoutMs,cwd=qa) => captured({name,executable:node,args,cwd,
  output,timeoutMs,steps:receipt.steps});
async function manifest(name) {
  const file = join(output,`${name}.json`);
  const step = await capture(name,[fingerprint,file],60000,repo);
  assert.equal(step.exitCode,0);assert.equal(step.timedOut,false);
  const value = JSON.parse(readFileSync(file,'utf8'));
  step.manifestSha256=hash(file);
  return value;
}
try {
  const before=await manifest('before');
  assert.equal(before.head,approval.head);
  assert.equal(before.sourceCount,113);assert.equal(before.distCount,82);
  assert.equal(canonicalDigest(before.source),approval.sourceFingerprintSha256);
  assert.equal(canonicalDigest(before.dist),approval.distFingerprintSha256);
  receipt.preflight={head:before.head,sourceCount:before.sourceCount,
    sourceSha256:canonicalDigest(before.source),distCount:before.distCount,
    distSha256:canonicalDigest(before.dist)};
  const resultPath=join(output,'vitest-result.json');
  const test=await capture('component',[vitest,'run','--config',join(qa,'vitest.config.mjs'),
    '--reporter=json',`--outputFile=${resultPath}`,'p23-settings.test.mjs'],600000);
  const after=await manifest('after');
  assert.deepEqual(after.source,before.source,'Source drift');
  assert.deepEqual(after.dist,before.dist,'Dist drift');
  assert.equal(test.exitCode,0,'Vitest exit RED');
  assert.equal(test.timedOut,false,'Vitest timeout');
  const result=JSON.parse(readFileSync(resultPath,'utf8'));
  receipt.vitest={total:result.numTotalTests,passed:result.numPassedTests,
    failed:result.numFailedTests,pending:result.numPendingTests,
    resultSha256:hash(resultPath)};
  assert.deepEqual([result.numTotalTests,result.numPassedTests,result.numFailedTests,
    result.numPendingTests],[5,5,0,0]);
  receipt.state='P23_TARGETED_LOCAL_COMPONENT_PASS';
} catch(error) {receipt.state='RED';receipt.firstRed=String(error.stack??error);}
finally {
  receipt.postflight={head:git('rev-parse','HEAD'),statusSha256:statusSha(),
    targetSha256:hash(join(repo,'apps/studio-web/src/aivora/SettingsPage.tsx')),
    relatedProcesses:relatedProcesses()};
  if(receipt.state==='P23_TARGETED_LOCAL_COMPONENT_PASS' &&
    (receipt.postflight.head!==approval.head ||
     receipt.postflight.statusSha256!==approval.statusSha256 ||
     receipt.postflight.targetSha256!==source[0][1] ||
     receipt.postflight.relatedProcesses.length!==0)) {
    receipt.state='POSTFLIGHT_RED';receipt.firstRed='HEAD/status/target drift'; }
  receipt.rawFiles=readdirSync(output,{withFileTypes:true})
    .filter(x=>x.isFile() && x.name!=='RECEIPT.json')
    .map(x=>{const file=join(output,x.name);return{name:x.name,bytes:statSync(file).size,sha256:hash(file)};});
  receipt.finishedAt=new Date().toISOString();
  writeFileSync(join(output,'RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n');
}
if(receipt.state!=='P23_TARGETED_LOCAL_COMPONENT_PASS')process.exitCode=1;
