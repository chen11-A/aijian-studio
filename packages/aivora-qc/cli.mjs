#!/usr/bin/env node
import process from "node:process";
import { readFile } from "node:fs/promises";
import { checkExport } from "./index.mjs";

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      "用法: node cli.mjs 成片.mp4 [--srt 字幕.srt] [--dialogue 台词.json] [--layout 布局.json] [--ffmpeg 工具路径] [--ffprobe 工具路径]\n",
    );
  } else {
    const input = args.shift();
    if (!input || input.startsWith("--"))
      throw new Error("必须传入本地 MP4 路径；使用 --help 查看用法");
    const options = {};
    const seen = new Set();
    while (args.length) {
      const flag = args.shift();
      const value = args.shift();
      if (
        !["--srt", "--dialogue", "--layout", "--ffmpeg", "--ffprobe"].includes(flag) ||
        !value ||
        seen.has(flag)
      )
        throw new Error("参数无效、缺少值或重复");
      seen.add(flag);
      if (flag === "--srt") options.srtPath = value;
      else if (flag === "--ffmpeg") options.ffmpegPath = value;
      else if (flag === "--ffprobe") options.ffprobePath = value;
      else
        options[flag === "--dialogue" ? "dialogue" : "subtitleLayout"] = JSON.parse(
          await readFile(value, "utf8"),
        );
    }
    process.stdout.write(JSON.stringify(await checkExport(input, options), null, 2) + "\n");
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({ error: { code: error.code ?? "QC_FAILED", message: error.message } }) + "\n",
  );
  process.exitCode = 1;
}
