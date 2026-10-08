import { readFileSync } from 'node:fs';
import { canonicalDigest } from './canonical-fingerprint.mjs';
import { createHash } from 'node:crypto';
const root = import.meta.dirname;
const manifest = JSON.parse(readFileSync(`${root}/STATIC-FINGERPRINT.json`, 'utf8'));
const sha = text => createHash('sha256').update(text).digest('hex').toUpperCase();
process.stdout.write(JSON.stringify({source:canonicalDigest(manifest.source),
  dist:canonicalDigest(manifest.dist),status:sha(manifest.status.join('\n'))})+'\n');
