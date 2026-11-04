import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  generateSubtitles,
  STYLES,
  wrapText,
  exportVideo,
  createCovers,
  createTitleCard,
  archiveProject,
  restoreProject,
} from "../index.mjs";
import { run } from "../process.mjs";

const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";
const pythonPath = process.env.PYTHON_PATH ?? "python3";
let mediaAvailable = true;
try {
  await run(ffmpegPath, ["-version"]);
  await run(ffprobePath, ["-version"]);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  mediaAvailable = false;
}
const media = { skip: mediaAvailable ? false : "未安装 ffmpeg/ffprobe；媒体测试跳过" };
const tools = { ffmpegPath, ffprobePath };
const shot = {
  shotId: "镜头一",
  start: 0,
  end: 2,
  speaker: "旁白",
  text: "这是一段字幕，测试中文换行以及安全区域。",
};
async function temporary(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "中文 项目 ' 测试-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function info(file) {
  return JSON.parse(
    (await run(ffprobePath, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]))
      .stdout,
  );
}
async function synth(dir, audio = true) {
  const output = path.join(dir, audio ? "合成 素材.mp4" : "无声 素材.mp4");
  const args = ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=10:d=3"];
  if (audio) args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3");
  args.push("-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p");
  if (audio) args.push("-c:a", "aac");
  await run(ffmpegPath, [...args, output]);
  return output;
}
async function pixels(file, time = 0) {
  return (
    await run(
      ffmpegPath,
      [
        "-v",
        "error",
        ...(file.endsWith(".jpg") ? [] : ["-ss", String(time)]),
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
    )
  ).stdout;
}

for (const orientation of ["portrait", "landscape"]) {
  test(`字幕：${orientation} 四套样式、时间码、断行和安全区`, () => {
    for (const style of STYLES) {
      const { srt, ass } = generateSubtitles(
        [{ ...shot, start: 59.999, end: 62, text: "甲".repeat(50) }, shot],
        { orientation, style },
      );
      assert.match(srt, /00:00:59,999 --> 00:01:02,000/);
      assert.match(ass, /0:01:00.00,0:01:02.00/);
      assert.ok(srt.indexOf(shot.text.slice(0, 8)) < srt.indexOf("甲"));
      for (const line of srt.split("\n").filter((s) => /[甲这测]/.test(s)))
        assert.ok(Array.from(line).length <= (orientation === "portrait" ? 16 : 22));
      assert.match(ass, orientation === "portrait" ? /,420,1/ : /,70,1/);
      assert.match(ass, /WrapStyle: 2/);
      if (style === "yellow") assert.match(ass, /&H0000FFFF/);
      if (style === "bar") assert.match(ass, /,3,3,0,2,/);
    }
  });
}
test("字幕标点优先、Unicode、注入和非法输入", () => {
  assert.deepEqual(wrapText("你好，今天的天气真好。", 8), ["你好，", "今天的天气真好。"]);
  assert.deepEqual(
    wrapText("😀".repeat(17), 16).map((s) => Array.from(s).length),
    [16, 1],
  );
  const { ass } = generateSubtitles([{ ...shot, text: "{\\pos(1,1)}\\N" }]);
  assert.ok(!ass.includes("{\\pos"));
  assert.throws(() => generateSubtitles([{ ...shot, end: -1 }]));
  assert.throws(() => generateSubtitles([shot], { orientation: "invalid" }));
  assert.throws(() => generateSubtitles([shot], { style: "invalid" }));
  assert.throws(() => generateSubtitles([shot], { fontFamily: "x\nStyle:" }));
  assert.equal(generateSubtitles([]).srt, "");
});

test("归档中文空格路径往返、拒绝覆盖和源符号链接", async (t) => {
  const dir = await temporary(t);
  const projectDir = path.join(dir, "原始 项目");
  await mkdir(path.join(projectDir, "素材 中文"), { recursive: true });
  await mkdir(path.join(projectDir, "成片"));
  await writeFile(
    path.join(projectDir, "project.json"),
    JSON.stringify({ assets: ["素材 中文/对白 文件.txt"], render: "成片/电影.mp4" }),
  );
  await writeFile(path.join(projectDir, "素材 中文/对白 文件.txt"), "中文台词");
  await writeFile(path.join(projectDir, "成片/电影.mp4"), new Uint8Array([0, 1, 2, 255]));
  const archive = await archiveProject({
    projectDir,
    output: path.join(dir, "备份 项目.zip"),
    pythonPath,
  });
  const destination = await restoreProject({
    archive,
    destination: path.join(dir, "恢复 项目"),
    pythonPath,
  });
  for (const name of ["project.json", "素材 中文/对白 文件.txt", "成片/电影.mp4"])
    assert.deepEqual(
      await readFile(path.join(destination, name)),
      await readFile(path.join(projectDir, name)),
    );
  await assert.rejects(restoreProject({ archive, destination, pythonPath }));
  await assert.rejects(archiveProject({ projectDir, output: archive, pythonPath }));
  await assert.rejects(
    archiveProject({ projectDir, output: path.join(projectDir, "nested.zip"), pythonPath }),
  );
  await symlink(path.join(dir, "outside"), path.join(projectDir, "link"));
  await assert.rejects(
    archiveProject({ projectDir, output: path.join(dir, "link.zip"), pythonPath }),
  );
});

test("恶意 ZIP：穿越、绝对路径、Windows 路径、符号链接、重复与损坏", async (t) => {
  const dir = await temporary(t);
  for (const [i, name] of [
    "../逃逸.txt",
    "/tmp/逃逸.txt",
    "C:/escape.txt",
    "a\\..\\escape",
    "a/../../escape",
    "a//b",
    "a/./b",
    "link",
    "duplicate",
    "bad-json",
  ].entries()) {
    const archive = path.join(dir, `${i}.zip`);
    await run(pythonPath, [
      "-c",
      `import zipfile,sys,json\np,n=sys.argv[1:]\nwith zipfile.ZipFile(p,'w') as z:\n z.writestr('project.json','{' if n=='bad-json' else '{}')\n if n=='link':\n  e=zipfile.ZipInfo(n);e.create_system=3;e.external_attr=0o120777<<16;z.writestr(e,'/tmp')\n elif n=='duplicate':\n  z.writestr('A.txt','a');z.writestr('a.txt','b')\n elif n!='bad-json': z.writestr(n,'bad')`,
      archive,
      name,
    ]);
    const destination = path.join(dir, `恢复-${i}`);
    await assert.rejects(restoreProject({ archive, destination, pythonPath }));
    await assert.rejects(stat(destination), { code: "ENOENT" });
  }
});

for (const orientation of ["portrait", "landscape"]) {
  test(`烧录字幕 ${orientation}：H.264/AAC、尺寸、可见文字和音量开关`, media, async (t) => {
    const dir = await temporary(t);
    const input = await synth(dir);
    const ass = path.join(dir, "字幕 ' 文件.ass");
    await writeFile(ass, generateSubtitles([shot], { orientation }).ass);
    const output = await exportVideo({
      input,
      ass,
      output: path.join(dir, "成片 视频.mp4"),
      orientation,
      autoAdjustVolume: true,
      ...tools,
    });
    const metadata = await info(output);
    const video = metadata.streams.find((s) => s.codec_type === "video");
    assert.equal(video.codec_name, "h264");
    assert.deepEqual(
      [video.width, video.height],
      orientation === "portrait" ? [1080, 1920] : [1920, 1080],
    );
    assert.equal(metadata.streams.find((s) => s.codec_type === "audio").codec_name, "aac");
    const { stderr } = await run(ffmpegPath, [
      "-hide_banner",
      "-i",
      output,
      "-af",
      "loudnorm=I=-16:TP=-1:print_format=json",
      "-f",
      "null",
      "-",
    ]);
    const levels = JSON.parse(stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
    assert.ok(Math.abs(Number(levels.input_i) + 16) <= 0.5);
    assert.ok(Number(levels.input_tp) <= -1);
    t.diagnostic(`输出测量 ${levels.input_i} LUFS / ${levels.input_tp} dBTP`);
    const frame = await pixels(output, 1);
    let visibleText = 0;
    let unsafeText = 0;
    for (let i = 0; i < frame.length; i += 3) {
      if (frame[i] > 180 && frame[i + 1] > 180 && frame[i + 2] > 180) {
        visibleText++;
        if (orientation === "portrait" && Math.floor(i / 3 / video.width) >= video.height * 0.8)
          unsafeText++;
      }
    }
    assert.ok(visibleText > 100);
    assert.equal(unsafeText, 0);
    await assert.rejects(exportVideo({ input, ass, output, orientation, ...tools }));
  });
}

test("音量关闭与无音轨输入仍导出 AAC", media, async (t) => {
  const dir = await temporary(t);
  const ass = path.join(dir, "空字幕.ass");
  await writeFile(ass, generateSubtitles([]).ass);
  for (const audio of [true, false]) {
    const input = await synth(dir, audio);
    const output = await exportVideo({
      input,
      ass,
      output: path.join(dir, `音量-${audio}.mp4`),
      autoAdjustVolume: !audio,
      ...tools,
    });
    assert.equal(
      (await info(output)).streams.find((s) => s.codec_type === "audio").codec_name,
      "aac",
    );
    if (audio) {
      const { stderr } = await run(ffmpegPath, [
        "-hide_banner",
        "-i",
        output,
        "-af",
        "loudnorm=print_format=json",
        "-f",
        "null",
        "-",
      ]);
      assert.ok(Number(JSON.parse(stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]).input_i) < -18);
    }
  }
});

test("封面双尺寸、标题、AI 标记可开关与时间校验", media, async (t) => {
  const dir = await temporary(t);
  const input = await synth(dir);
  const on = await createCovers({
    input,
    time: 1,
    title: "中文封面 标题",
    outputDir: path.join(dir, "带 标记"),
    ...tools,
  });
  const off = await createCovers({
    input,
    time: 1,
    title: "中文封面 标题",
    outputDir: path.join(dir, "无 标记"),
    aiLabel: false,
    ...tools,
  });
  for (const [orientation, expected] of [
    ["portrait", [1080, 1920]],
    ["landscape", [1920, 1080]],
  ]) {
    const stream = (await info(on[orientation])).streams[0];
    assert.equal(stream.codec_name, "mjpeg");
    assert.deepEqual([stream.width, stream.height], expected);
    const a = await pixels(on[orientation]);
    const b = await pixels(off[orientation]);
    assert.notDeepEqual(a, b);
    let titlePixels = 0;
    let markPixels = 0;
    for (let y = 0; y < expected[1]; y++)
      for (let x = 0; x < expected[0]; x++) {
        const offset = (y * expected[0] + x) * 3;
        if (a[offset] > 180 && a[offset + 1] > 180 && a[offset + 2] > 180) {
          if (y < expected[1] * 0.6) titlePixels++;
          if (y > expected[1] * 0.9 && x > expected[0] * 0.7) markPixels++;
        }
      }
    assert.ok(titlePixels > 100 && markPixels > 50);
  }
  await assert.rejects(createCovers({ input, time: 10, title: "越界", outputDir: dir, ...tools }));
});

test("片头两秒、双画幅、淡入淡出像素验证", media, async (t) => {
  const dir = await temporary(t);
  for (const orientation of ["portrait", "landscape"]) {
    for (const fade of [true, false]) {
      const output = await createTitleCard({
        title: "片头 中文标题",
        output: path.join(dir, `${orientation}-${fade}.mp4`),
        orientation,
        fade,
        ...tools,
      });
      const metadata = await info(output);
      assert.ok(Math.abs(Number(metadata.format.duration) - 2) < 0.05);
      assert.equal(metadata.streams[0].width, orientation === "portrait" ? 1080 : 1920);
      const sum = (buffer) => buffer.reduce((a, b) => a + b, 0);
      const first = sum(await pixels(output, 0));
      const middle = sum(await pixels(output, 1));
      const last = sum(await pixels(output, 1.966));
      assert.ok(middle > 10000);
      if (fade) {
        assert.ok(first < middle * 0.05);
        assert.ok(last < middle * 0.3);
      } else assert.ok(first > middle * 0.9);
    }
  }
});

test("所有媒体工具路径可注入，缺失工具明确拒绝", async () => {
  await assert.rejects(
    createTitleCard({
      title: "标题",
      output: "/tmp/not-written.mp4",
      ffmpegPath: "/missing/ffmpeg",
    }),
    { code: "ENOENT" },
  );
  await assert.rejects(
    exportVideo({
      input: "input.mp4",
      ass: "a.ass",
      output: "o.mp4",
      ffprobePath: "/missing/ffprobe",
    }),
    { code: "ENOENT" },
  );
});

test("中文空格工具路径、静音轨与高峰值音频", media, async (t) => {
  const dir = await temporary(t);
  // Resolve PATH executables without invoking a shell.
  const locate = async (binary) => {
    if (binary.includes("/")) return path.resolve(binary);
    for (const folder of process.env.PATH.split(path.delimiter)) {
      const candidate = path.join(folder, binary);
      try {
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {
        /* next PATH directory */
      }
    }
    throw new Error("工具不存在");
  };
  const customFfmpeg = path.join(dir, "视频 工具");
  const customFfprobe = path.join(dir, "探测 工具");
  await symlink(await locate(ffmpegPath), customFfmpeg);
  await symlink(await locate(ffprobePath), customFfprobe);
  const ass = path.join(dir, "静音 字幕.ass");
  await writeFile(ass, generateSubtitles([]).ass);
  for (const silence of [true, false]) {
    const input = path.join(dir, `输入-${silence}.mp4`);
    await run(customFfmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x240:r=10:d=4",
      "-f",
      "lavfi",
      "-i",
      silence
        ? "anullsrc=r=48000:cl=stereo"
        : "aevalsrc=if(lt(mod(t\\,0.5)\\,0.04)\\,0.98*sin(2*PI*440*t)\\,0.05*sin(2*PI*440*t)):s=48000",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-t",
      "4",
      input,
    ]);
    const output = await exportVideo({
      input,
      ass,
      output: path.join(dir, `结果-${silence}.mp4`),
      autoAdjustVolume: true,
      ffmpegPath: customFfmpeg,
      ffprobePath: customFfprobe,
    });
    const { stderr } = await run(customFfmpeg, [
      "-hide_banner",
      "-i",
      output,
      "-af",
      "loudnorm=print_format=json",
      "-f",
      "null",
      "-",
    ]);
    const m = JSON.parse(stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
    if (silence) assert.equal(m.input_i, "-inf");
    else {
      assert.ok(Math.abs(Number(m.input_i) + 16) <= 0.5);
      assert.ok(Number(m.input_tp) <= -1);
    }
    t.diagnostic(`静音=${silence}：${m.input_i} LUFS / ${m.input_tp} dBTP`);
  }
});

test("ZIP CRC 损坏与解压大小上限拒绝且不留下目标", async (t) => {
  const dir = await temporary(t);
  for (const kind of ["crc", "size"]) {
    const archive = path.join(dir, `${kind}.zip`);
    await run(pythonPath, [
      "-c",
      `import zipfile,sys,struct\np,kind=sys.argv[1:]\nwith zipfile.ZipFile(p,'w') as z:\n z.writestr('project.json','{}');z.writestr('a','a');z.writestr('b','b')\nb=bytearray(open(p,'rb').read())\nif kind=='crc': b[30+len('project.json')]=65\nelse:\n i=0\n while True:\n  i=b.find(b'PK\\x01\\x02',i)\n  if i<0: break\n  struct.pack_into('<I',b,i+24,0xffffffff);i+=46\nopen(p,'wb').write(b)`,
      archive,
      kind,
    ]);
    const destination = path.join(dir, `恢复 ${kind}`);
    await assert.rejects(restoreProject({ archive, destination, pythonPath }));
    await assert.rejects(stat(destination), { code: "ENOENT" });
  }
});
