import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm, writeFile, mkdir, symlink, stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { archiveProject, restoreProject } from "../index.mjs";
import { run } from "../process.mjs";
import { fixture } from "./zip-fixture.mjs";
const project = { name: "project.json", text: "{}" };
async function temporary(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "归档 中文 空格-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
export async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

test("纯 Node ZIP 中文空格往返逐文件 SHA256、空目录和拒绝覆盖", async (t) => {
  const dir = await temporary(t),
    source = path.join(dir, "项目 原始");
  await mkdir(path.join(source, "素材 中文"), { recursive: true });
  await mkdir(path.join(source, "空目录"));
  const files = ["project.json", "素材 中文/对白 文本.txt", "成片.mp4"];
  for (const [i, name] of files.entries())
    await writeFile(
      path.join(source, name),
      i ? `内容${i}` : '{"asset":"素材 中文/对白 文本.txt"}',
    );
  const archive = await archiveProject({
    projectDir: source,
    output: path.join(dir, "备份 项目.zip"),
  });
  const destination = await restoreProject({ archive, destination: path.join(dir, "恢复 项目") });
  for (const name of files)
    assert.equal(await digest(path.join(source, name)), await digest(path.join(destination, name)));
  assert.ok((await stat(path.join(destination, "空目录"))).isDirectory());
  await assert.rejects(archiveProject({ projectDir: source, output: archive }));
  await assert.rejects(restoreProject({ archive, destination }));
  await assert.rejects(
    archiveProject({ projectDir: source, output: path.join(source, "self.zip") }),
  );
  await symlink(dir, path.join(source, "外部链接"), "junction");
  await assert.rejects(
    archiveProject({ projectDir: source, output: path.join(dir, "linked.zip") }),
  );
});

test("独立 ZIP fixture 的 STORE / DEFLATE 恢复", async (t) => {
  const dir = await temporary(t);
  for (const method of [0, 8]) {
    const archive = path.join(dir, `${method}.zip`),
      destination = path.join(dir, `out-${method}`);
    await writeFile(
      archive,
      fixture([project, { name: "素材/中文 空格.txt", text: "中文内容".repeat(1000), method }]),
    );
    await restoreProject({ archive, destination });
    assert.equal(
      await readFile(path.join(destination, "素材/中文 空格.txt"), "utf8"),
      "中文内容".repeat(1000),
    );
  }
});

test("恶意 ZIP 拒绝：穿越、Windows 别名、链接、重复、CRC、头部不一致和解压炸弹", async (t) => {
  const dir = await temporary(t);
  const cases = [
    ...[
      "../逃逸",
      "/tmp/逃逸",
      "C:/escape",
      "C:\\Users\\张 三\\file",
      "\\\\server\\share",
      "a/../../escape",
      "a//b",
      "a/./b",
      "a/../b",
      "a:stream",
      "AUX.txt",
      "con",
      "x.",
      "x ",
      "x/",
      "\0bad",
    ].map((name) => [project, { name }]),
    [project, { name: "link", mode: 0o120777, text: "/tmp" }],
    [project, { name: "device", mode: 0o020666 }],
    [project, { name: "a" }, { name: "A" }],
    [project, { name: "a" }, { name: "a/b" }],
    [project, { name: "é" }, { name: "e\u0301" }],
    [project, { name: "bad", badCrc: true }],
    [project, { name: "ok", localName: "../x" }],
    [project, { name: "encrypted", flags: 0x801 }],
    [project, { name: "zip64", declaredSize: 0xffffffff }],
    [project, { name: "bomb", method: 8, text: "a".repeat(1024 * 1024), declaredSize: 1 }],
    [{ name: "project.json", text: "{" }],
  ];
  for (const [i, entries] of cases.entries()) {
    const archive = path.join(dir, `${i}.zip`),
      destination = path.join(dir, `恢复-${i}`);
    await writeFile(archive, fixture(entries));
    await assert.rejects(restoreProject({ archive, destination }), `case ${i}`);
    await assert.rejects(stat(destination), { code: "ENOENT" });
  }
  assert.deepEqual(
    (await readdir(dir)).filter((n) => n.startsWith(".aivora")),
    [],
  );
});

test("超过 1 GiB 实际流式归档与恢复，逐文件 SHA256 和内存上限", { timeout: 180000 }, async (t) => {
  const script = fileURLToPath(new URL("./large-archive.mjs", import.meta.url));
  const { stdout } = await run(process.execPath, ["--max-old-space-size=128", script], {
    timeout: 170000,
  });
  const result = JSON.parse(stdout);
  assert.ok(result.bytes > 1024 ** 3);
  assert.ok(result.maxRssMiB < 256, stdout);
  assert.ok(result.peakSampleMiB < 256, stdout);
  assert.ok(result.sha256Match);
  t.diagnostic(stdout.trim());
});

test("ZIP64 超限字段、重叠数据与目的地符号链接拒绝", async (t) => {
  const dir = await temporary(t),
    source = path.join(dir, "项目");
  await mkdir(source);
  await writeFile(path.join(source, "project.json"), "{}");
  const archive = await archiveProject({ projectDir: source, output: path.join(dir, "正常.zip") });
  const original = await readFile(archive);
  for (const variant of ["huge", "offset", "descriptor", "truncated"]) {
    const bad = original
      .subarray(0, variant === "truncated" ? original.length - 1 : original.length)
      .map((b) => b);
    const central = bad.indexOf(new Uint8Array([80, 75, 1, 2]));
    const extra = central + 46 + bad.readUInt16LE(central + 28);
    if (variant === "huge") bad.writeBigUInt64LE(9n * 1024n ** 3n, extra + 4);
    if (variant === "offset") bad.writeBigUInt64LE(1n, extra + 20);
    if (variant === "descriptor") bad[central - 20] ^= 1;
    const file = path.join(dir, `${variant}.zip`);
    await writeFile(file, bad);
    await assert.rejects(restoreProject({ archive: file, destination: path.join(dir, variant) }));
  }
  const destination = path.join(dir, "链接目标");
  await symlink(source, destination, "junction");
  await assert.rejects(restoreProject({ archive, destination }));
  assert.equal(await readFile(path.join(source, "project.json"), "utf8"), "{}");
});
