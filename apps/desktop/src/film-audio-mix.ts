import { dirname, basename, join } from "node:path";
import { stat, writeFile, rm } from "node:fs/promises";
import { audioMixGain } from "@aijian/contracts/film-audio-mix-plan";
import type { AudioMixPlan, MixSourceInfo } from "@aijian/contracts/film-audio-mix";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
/** Tool locations and sources are resolved by trusted main before entering this runner. */
export async function probeMixSource(
  path: string,
  tools: QcTools,
  run: QcRunner,
  signal?: AbortSignal,
): Promise<MixSourceInfo & { videoDurationSeconds: number }> {
  const { stdout } = await run(
    tools.ffprobePath,
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_entries",
      "stream=codec_type,duration,channels:format=duration",
      "-of",
      "json",
      path,
    ],
    { signal, timeoutMs: 30000, maxBuffer: 65536 },
  );
  const data = JSON.parse(stdout);
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const audio = streams.find((stream: { codec_type?: unknown }) => stream.codec_type === "audio");
  const video = streams.find((stream: { codec_type?: unknown }) => stream.codec_type === "video");
  const duration = Number(audio?.duration ?? data.format?.duration);
  const videoDuration = Number(video?.duration ?? data.format?.duration);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 36000 ||
    (video && (!Number.isFinite(videoDuration) || videoDuration <= 0))
  )
    throw new Error("INVALID_AUDIO_SOURCE");
  if (audio && ![1, 2].includes(audio.channels)) throw new Error("UNSUPPORTED_AUDIO_CHANNELS");
  return {
    durationSeconds: duration,
    channels: audio?.channels ?? 0,
    byteLength: (await stat(path)).size,
    hasAudio: Boolean(audio),
    videoDurationSeconds: video ? videoDuration : 0,
  };
}
function number(value: number) {
  if (!Number.isFinite(value)) throw new Error("INVALID_AUDIO_PLAN");
  return String(Math.round(value * 1000000) / 1000000);
}
/** Exact same linear 0.3s attack / 0.5s release used by audioMixGain. Numeric plan-only
 * expressions, never project text, filenames or arbitrary renderer filter syntax. */
export function mixDuckExpression(plan: AudioMixPlan): string {
  // Flat disjoint intervals, not a nested if chain. FFmpeg's expression parser
  // rejects ~100 nested calls even when the graph is stored in a script file.
  const terms = plan.duck.slice(0, -1).map((left, index) => {
    const right = plan.duck[index + 1]!;
    const value =
      left.gain === right.gain
        ? number(left.gain)
        : `${number(left.gain)}+(${number(right.gain - left.gain)})*(t-${number(left.seconds)})/${number(right.seconds - left.seconds)}`;
    return `if(gte(t,${number(left.seconds)})*lt(t,${number(right.seconds)}),${value},0)`;
  });
  // The verifier also walks arithmetic ASTs: a flat left-associated 400-term sum
  // still exceeds FFmpeg's depth limit. A balanced sum has logarithmic depth.
  let level = terms;
  while (level.length > 1)
    level = Array.from({ length: Math.ceil(level.length / 2) }, (_, index) =>
      level[index * 2 + 1] === undefined
        ? level[index * 2]!
        : `(${level[index * 2]}+${level[index * 2 + 1]})`,
    );
  return `if(isnan(t),1,${level[0] ?? "1"})`;
}
export function audioMixArgs(
  video: string,
  output: string,
  plan: AudioMixPlan,
  paths: Readonly<Record<string, string>>,
) {
  if (plan.tracks.length > 128) throw new Error("AUDIO_MIX_LIMIT");
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-filter_complex_threads",
    "1",
    "-n",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    video,
  ];
  if (!plan.tracks.length)
    return [
      ...args,
      "-map",
      "0:v:0",
      "-an",
      "-c:v",
      "copy",
      "-t",
      number(plan.durationSeconds),
      output,
    ];
  const inputs = new Map<string, number>();
  for (const track of plan.tracks) {
    const path = paths[track.sourceKey];
    if (!path) throw new Error("INVALID_AUDIO_SOURCE");
    if (!inputs.has(track.sourceKey)) {
      inputs.set(track.sourceKey, inputs.size + 1);
      args.push("-protocol_whitelist", "file,pipe", "-i", path);
    }
  }
  const filters = plan.tracks.map((track, index) => {
    // Before delay every decoded source starts at its requested offset. After delay t is
    // film time, so preview and export evaluate duck against the same clock.
    const gain = 10 ** (track.gainDb / 20);
    // Exercise the public evaluator for validation without duplicating its gain default.
    if (!Number.isFinite(audioMixGain(plan, track, track.startSeconds)))
      throw new Error("INVALID_AUDIO_PLAN");
    return `[${inputs.get(track.sourceKey)}:a:0]atrim=start=${number(track.offsetSeconds)}${track.loopSeconds ? "" : `:duration=${number(track.endSeconds - track.startSeconds)}`},asetpts=PTS-STARTPTS,${track.sourceChannels === 1 ? "pan=stereo|c0=c0|c1=c0," : ""}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,${track.loopSeconds ? `aresample=48000,aloop=loop=-1:size=${Math.round(track.loopSeconds * 48000)},atrim=duration=${number(track.endSeconds - track.startSeconds)},` : ""}adelay=${number(track.startSeconds * 1000)}:all=1,apad=whole_dur=${number(plan.durationSeconds)},atrim=duration=${number(plan.durationSeconds)},volume='${number(gain)}${track.lane === "score" ? `*${mixDuckExpression(plan)}` : ""}':eval=frame[a${index}]`;
  });
  filters.push(
    `${plan.tracks.map((_, index) => `[a${index}]`).join("")}amix=inputs=${plan.tracks.length}:duration=longest:normalize=0:dropout_transition=0,atrim=duration=${number(plan.durationSeconds)}[mix]`,
  );
  return [
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v:0",
    "-map",
    "[mix]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-t",
    number(plan.durationSeconds),
    "-movflags",
    "+faststart",
    output,
  ];
}
export function audioMixCommandLength(binary: string, args: readonly string[]) {
  const quote = (value: string) => {
    if (!value.includes(" ") && !value.includes("\t") && !value.includes('"')) return value;
    let result = '"',
      slashes = 0;
    for (const character of value) {
      if (character === "\\") {
        slashes++;
        continue;
      }
      if (character === '"') result += "\\".repeat(slashes * 2 + 1) + '"';
      else result += "\\".repeat(slashes) + character;
      slashes = 0;
    }
    return result + "\\".repeat(slashes * 2) + '"';
  };
  return [binary, ...args].map(quote).join(" ").length + 1;
}
export async function renderAudioMix(
  video: string,
  output: string,
  plan: AudioMixPlan,
  paths: Readonly<Record<string, string>>,
  tools: QcTools,
  run: QcRunner,
  signal?: AbortSignal,
) {
  const args = audioMixArgs(video, output, plan, paths);
  const index = args.indexOf("-filter_complex");
  let script = "";
  try {
    if (index >= 0) {
      // A bounded plan can still exceed Windows' command-line size. Numeric filters are
      // written into main's private request folder rather than flattened into argv.
      script = join(dirname(output), `${basename(output)}.audio-filter.txt`);
      await writeFile(script, args[index + 1]!, { flag: "wx", mode: 0o600 });
      args[index] = "-filter_complex_script";
      args[index + 1] = script;
    }
    if (audioMixCommandLength(tools.ffmpegPath, args) > 30000) throw new Error("AUDIO_MIX_LIMIT");
    await run(tools.ffmpegPath, args, { signal, timeoutMs: 600000, maxBuffer: 1024 * 1024 });
  } finally {
    if (script) await rm(script, { force: true });
  }
  return output;
}
