import {execFileSync} from 'node:child_process';
import {sourceSnapshot} from './source-snapshot.mjs';
import {canonicalDigest} from './canonical-fingerprint.mjs';
const repo='C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const lines=execFileSync('git',['-C',repo,'status','--porcelain','-uall'],{encoding:'utf8'}).trimEnd().split(/\r?\n/).filter(Boolean);
const rows=sourceSnapshot(repo,lines);
process.stdout.write(JSON.stringify({count:rows.length,sha256:canonicalDigest(rows)})+'\n');
