import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
export type AudioNormalizer = {
  measureAudioLoudness: (
    path: string,
    binary: string,
    run: (binary: string, args: string[]) => Promise<{ stdout: string; stderr: string }>,
  ) => Promise<{ input_i: string; input_tp: string }>;
  audioNormalizationFilter: (
    path: string,
    binary: string,
    run: (binary: string, args: string[]) => Promise<{ stdout: string; stderr: string }>,
  ) => Promise<string>;
  assertNormalizedAudio: (measurement: { input_i: string; input_tp: string }) => {
    applicable: boolean;
  };
};
export async function loadAudioNormalizer(resourceRoot: string): Promise<AudioNormalizer> {
  const path = join(resourceRoot, "audio-normalize.mjs");
  if (!(await stat(path)).isFile()) throw new Error("TOOLS_UNAVAILABLE");
  const runtime: unknown = await import(pathToFileURL(path).href);
  if (
    !runtime ||
    typeof runtime !== "object" ||
    !("measureAudioLoudness" in runtime) ||
    typeof runtime.measureAudioLoudness !== "function" ||
    !("audioNormalizationFilter" in runtime) ||
    typeof runtime.audioNormalizationFilter !== "function" ||
    !("assertNormalizedAudio" in runtime) ||
    typeof runtime.assertNormalizedAudio !== "function"
  )
    throw new Error("TOOLS_UNAVAILABLE");
  return runtime as AudioNormalizer;
}
export async function normalizeMixedAudio(
  input: string,
  output: string,
  runtime: AudioNormalizer,
  tools: QcTools,
  run: QcRunner,
  signal?: AbortSignal,
) {
  const execute = (binary: string, args: string[]) =>
    run(binary, args, { signal, timeoutMs: 600000, maxBuffer: 1024 * 1024 });
  const filter = await runtime.audioNormalizationFilter(input, tools.ffmpegPath, execute);
  await execute(tools.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-n",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c:v",
    "copy",
    "-af",
    filter,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    output,
  ]);
  return output;
}
