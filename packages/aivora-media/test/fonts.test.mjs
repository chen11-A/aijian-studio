import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { escapeFilterPath } from "../index.mjs";
import { run } from "../process.mjs";

// Simulate each av_get_token layer, independently of the escaping implementation.
function token(value, delimiters) {
  let out = "",
    quote = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && !quote) {
      out += value[++i];
      continue;
    }
    if (c === "'") {
      quote = !quote;
      continue;
    }
    if (!quote && delimiters.includes(c)) throw new Error("unescaped separator");
    out += c;
  }
  assert.equal(quote, false);
  return out;
}
test("escapeFilterPath 双层 Windows 盘符、反斜杠、中文空格、UNC、引号与分隔符", () => {
  for (const input of [
    String.raw`C:\Users\张 三\fonts`,
    String.raw`D:\字幕 fonts\Noto`,
    String.raw`\\server\共享\fonts`,
    "/tmp/字体 ' [a],b;c: d\\font",
    "relative/fonts",
  ]) {
    const escaped = escapeFilterPath(input);
    assert.equal(token(token(escaped, "[],;"), ":"), input);
  }
  assert.equal(
    escapeFilterPath(String.raw`C:\Users\张 三\fonts`),
    String.raw`C\\:\\\\Users\\\\张\\\ 三\\\\fonts`,
  );
  for (const value of ["", null, "a\0b", "a\nb"]) assert.throws(() => escapeFilterPath(value));
});

test(
  "隔离系统字体后，临时 fontsDir 为字幕、封面和字卡提供中文字体",
  { timeout: 120000 },
  async (t) => {
    const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
    const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";
    try {
      await run(ffmpegPath, ["-version"]);
      await run(ffprobePath, ["-version"]);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("未安装 ffmpeg/ffprobe");
        return;
      }
      throw error;
    }
    if (process.platform !== "linux") {
      t.skip("Fontconfig 隔离测试仅在 Linux 执行；不声称 Windows 实机验证");
      return;
    }
    const script = fileURLToPath(new URL("./font-isolation.mjs", import.meta.url));
    const { stdout } = await run(process.execPath, [script], {
      env: {
        ...process.env,
        FFMPEG_PATH: ffmpegPath.includes(path.sep) ? path.resolve(ffmpegPath) : ffmpegPath,
        FFPROBE_PATH: ffprobePath.includes(path.sep) ? path.resolve(ffprobePath) : ffprobePath,
      },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.withoutFonts, 0);
    for (const key of ["title", "subtitle", "portrait", "landscape"])
      assert.ok(result[key] > 100, stdout);
    t.diagnostic(stdout.trim());
  },
);
