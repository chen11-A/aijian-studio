import { mkdtemp, mkdir, open, writeFile, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setInterval, clearInterval } from "node:timers";
import assert from "node:assert/strict";
import { archiveProject, restoreProject } from "../archive.mjs";
const dir = await mkdtemp(path.join(tmpdir(), "大文件 中文 流式-"));
const start = Date.now();
let peak = process.memoryUsage().rss;
const timer = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 10);
async function hash(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
try {
  const source = path.join(dir, "源 项目");
  await mkdir(source);
  await writeFile(path.join(source, "project.json"), '{"asset":"素材 中文.bin"}');
  const file = await open(path.join(source, "素材 中文.bin"), "wx");
  const chunk = randomBytes(1024 * 1024);
  // Physically write all 1,152 MiB; no sparse/truncate fixture.
  try {
    for (let i = 0; i < 1152; i++) await file.writeFile(chunk);
  } finally {
    await file.close();
  }
  const archive = await archiveProject({ projectDir: source, output: path.join(dir, "备份.zip") });
  const restored = await restoreProject({ archive, destination: path.join(dir, "恢复 项目") });
  for (const name of ["project.json", "素材 中文.bin"])
    assert.equal(await hash(path.join(source, name)), await hash(path.join(restored, name)));
  process.stdout.write(
    JSON.stringify({
      bytes: 1152 * 1024 ** 2,
      sha256Match: true,
      peakSampleMiB: +(peak / 1024 ** 2).toFixed(1),
      maxRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
      elapsedSeconds: +((Date.now() - start) / 1000).toFixed(2),
    }),
  );
} finally {
  clearInterval(timer);
  await rm(dir, { recursive: true, force: true });
}
