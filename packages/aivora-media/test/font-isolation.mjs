import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createTitleCard, createCovers, exportVideo, generateSubtitles } from "../index.mjs";
import { run } from "../process.mjs";
const dir = await mkdtemp(path.join(tmpdir(), "字体 隔离-"));
const tools = {
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
};
try {
  const fontsDir = path.join(dir, "张 三 ' [fonts],;:目录");
  await mkdir(fontsDir);
  const source =
    process.env.AIVORA_TEST_FONT ?? "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";
  await copyFile(source, path.join(fontsDir, `NotoSansCJKsc-Regular${path.extname(source)}`));
  await mkdir(path.join(dir, "empty"));
  const config = path.join(dir, "fontconfig.xml");
  await writeFile(
    config,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>${dir}/empty</dir><cachedir>${dir}/cache</cachedir></fontconfig>`,
  );
  process.env.FONTCONFIG_FILE = config;
  process.env.FONTCONFIG_PATH = path.join(dir, "empty");
  // Font discovery is controlled by Fontconfig, not executable PATH.
  const output = path.join(dir, "无字体.mp4");
  await createTitleCard({ title: "中文字体测试", output, ...tools });
  async function count(file) {
    const { stdout } = await run(
      tools.ffmpegPath,
      [
        "-v",
        "error",
        "-i",
        file,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-threads",
        "1",
        "-",
      ],
      { encoding: "buffer" },
    );
    let white = 0;
    for (let i = 0; i < stdout.length; i += 3)
      if (stdout[i] > 180 && stdout[i + 1] > 180 && stdout[i + 2] > 180) white++;
    return white;
  }
  const withoutFonts = await count(output);
  const card = await createTitleCard({
    title: "中文字体测试",
    output: path.join(dir, "字卡.mp4"),
    fontsDir,
    ...tools,
  });
  const input = path.join(dir, "黑底.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x240:r=10:d=2",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    input,
  ]);
  const ass = path.join(dir, "字幕.ass");
  await writeFile(
    ass,
    generateSubtitles([{ shotId: 1, start: 0, end: 2, speaker: "", text: "中文字体测试" }]).ass,
  );
  const subtitle = await exportVideo({
    input,
    ass,
    output: path.join(dir, "字幕.mp4"),
    fontsDir,
    ...tools,
  });
  const covers = await createCovers({
    input,
    time: 0,
    title: "中文字体测试",
    outputDir: path.join(dir, "封面"),
    fontsDir,
    ...tools,
  });
  process.stdout.write(
    JSON.stringify({
      withoutFonts,
      title: await count(card),
      subtitle: await count(subtitle),
      portrait: await count(covers.portrait),
      landscape: await count(covers.landscape),
      font: path.basename(source),
    }),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
