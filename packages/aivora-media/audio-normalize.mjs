function measurement(log) {
  const json = log.match(/\{\s*"input_i"\s*:[\s\S]*?\}/)?.[0];
  if (!json) throw new Error("无法测量音量");
  return JSON.parse(json);
}

export async function measureAudioLoudness(input, ffmpegPath, run) {
  const { stderr } = await run(ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-v",
    "info",
    "-i",
    input,
    "-map",
    "0:a:0",
    "-af",
    `loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`,
    "-f",
    "null",
    "-",
  ]);
  return measurement(stderr);
}

export async function audioNormalizationFilter(input, ffmpegPath, run) {
  const m = await measureAudioLoudness(input, ffmpegPath, run);
  if (m.input_i === "-inf") return "anull"; // Silence cannot be raised to -16 LUFS.
  if (
    ![m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset].every((v) =>
      Number.isFinite(Number(v)),
    )
  )
    throw new Error("音量测量无效");
  return `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

export function assertNormalizedAudio(measured) {
  const integrated = measured.input_i === "-inf" ? -Infinity : Number(measured.input_i);
  if (
    integrated !== -Infinity &&
    (!Number.isFinite(integrated) ||
      !Number.isFinite(Number(measured.input_tp)) ||
      Math.abs(integrated + 16) > 0.5 ||
      Number(measured.input_tp) > -1)
  )
    throw new Error("导出未达到目标音量（−16±0.5 LUFS / ≤−1 dBTP），未发布文件");
  return { applicable: integrated !== -Infinity };
}
