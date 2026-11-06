const lanes = ["dialogue", "ambience", "sfx", "score"];
const finite = (value) => Number.isFinite(value);
const usable = (info) =>
  Boolean(info && info.hasAudio && finite(info.durationSeconds) && info.durationSeconds > 0);
export function buildAudioMixPlan(input) {
  const result = {
    projectId: input.projectId,
    durationSeconds: input.durationSeconds,
    tracks: [],
    shots: input.shots.map((shot) => ({ ...shot })),
    duck: [],
    speech: [],
    limitations: [],
  };
  if (
    !finite(input.durationSeconds) ||
    input.durationSeconds <= 0 ||
    input.durationSeconds > 36000 ||
    input.shots.length > 1000 ||
    input.clips.length > 4000
  )
    throw new Error("INVALID_AUDIO_PLAN");
  const shots = new Map(input.shots.map((shot) => [shot.shotId, shot]));
  if (
    shots.size !== input.shots.length ||
    input.shots.some(
      (shot) =>
        !shot.shotId ||
        !shot.takeId ||
        !finite(shot.startSeconds) ||
        !finite(shot.durationSeconds) ||
        shot.startSeconds < 0 ||
        shot.durationSeconds <= 0 ||
        shot.startSeconds + shot.durationSeconds > input.durationSeconds + 0.001,
    )
  )
    throw new Error("INVALID_AUDIO_PLAN");
  const seen = new Set();
  const note = (code) => {
    if (!result.limitations.includes(code)) result.limitations.push(code);
  };
  const selected = (clip) => {
    if (!clip.shotId) return !clip.takeId;
    const shot = shots.get(clip.shotId);
    return Boolean(shot && clip.takeId && clip.takeId === shot.takeId);
  };
  const candidates = input.clips.filter((clip) => {
    if (!clip.sourceKey) return false; // A text-only sound intention is never an audio source.
    if (!selected(clip)) {
      note("STALE_CLIP_IGNORED");
      return false;
    }
    if (
      !clip.id ||
      seen.has(clip.id) ||
      !lanes.includes(clip.lane) ||
      ![clip.startSeconds, clip.durationSeconds, clip.offsetSeconds, clip.gainDb].every(finite) ||
      clip.startSeconds < 0 ||
      clip.durationSeconds < 0 ||
      clip.offsetSeconds < 0 ||
      clip.gainDb < -96 ||
      clip.gainDb > 24 ||
      (clip.loop !== undefined && typeof clip.loop !== "boolean")
    ) {
      note("INVALID_CLIP");
      return false;
    }
    seen.add(clip.id);
    return true;
  });
  const audible = (lane) =>
    !input.controls?.lanes?.[lane]?.muted &&
    !input.controls?.mutedLanes?.includes(lane) &&
    (!input.controls?.soloLane || input.controls.soloLane === lane);
  const append = (clip, native) => {
    if (clip.gainDb <= -40 || !audible(clip.lane)) return;
    const source = input.sources[clip.sourceKey];
    if (native && source && source.hasAudio === false) return;
    if (!usable(source)) {
      note("SOURCE_UNAVAILABLE");
      return;
    }
    const shot = clip.shotId ? shots.get(clip.shotId) : undefined;
    const start = (shot?.startSeconds ?? 0) + clip.startSeconds;
    const available = source.durationSeconds - clip.offsetSeconds;
    // Preserve the existing global zero-duration music bed's repeat semantics only.
    const loop =
      !native &&
      (clip.loop ?? (clip.lane === "score" && !clip.shotId && clip.durationSeconds === 0));
    if (available <= 0) {
      note("SOURCE_UNAVAILABLE");
      return;
    }
    const length = loop
      ? clip.durationSeconds > 0
        ? clip.durationSeconds
        : input.durationSeconds
      : clip.durationSeconds > 0
        ? Math.min(clip.durationSeconds, available)
        : available;
    const end = Math.min(
      input.durationSeconds,
      shot ? shot.startSeconds + shot.durationSeconds : input.durationSeconds,
      start + length,
    );
    if (end <= start || clip.gainDb <= -40 || !audible(clip.lane)) return;
    result.tracks.push({
      key: clip.id,
      sourceKey: clip.sourceKey,
      lane: clip.lane,
      startSeconds: start,
      endSeconds: end,
      offsetSeconds: clip.offsetSeconds,
      gainDb: clip.gainDb + (input.controls?.lanes?.[clip.lane]?.gainDb ?? 0),
      native,
      ...(loop ? { loopSeconds: available } : {}),
      ...(source.channels !== undefined ? { sourceChannels: source.channels } : {}),
    });
    if (clip.lane === "dialogue" && (!native || shot?.hasDialogue !== false)) {
      if (native && shot?.hasDialogue == null) note("NATIVE_DIALOGUE_UNKNOWN");
      result.speech.push({ startSeconds: start, endSeconds: end, basis: "conservative-clip" });
      note("SPEECH_ALIGNMENT_UNAVAILABLE");
    }
  };
  for (const shot of input.shots) {
    const dialogue = candidates.filter(
      (clip) => clip.shotId === shot.shotId && clip.lane === "dialogue",
    );
    // Explicit dub/narration owns the dialogue lane for the whole shot, including gaps.
    // Muting it does not accidentally resurrect embedded speech. Native controls refer to
    // the one selected video source, never a second copy mixed on top of it.
    const globalVoice = candidates.some((clip) => {
      if (clip.lane !== "dialogue" || clip.shotId || clip.label === "原声") return false;
      const source = input.sources[clip.sourceKey];
      const available = source
        ? Math.max(0, source.durationSeconds - clip.offsetSeconds)
        : input.durationSeconds - clip.startSeconds;
      const length =
        clip.durationSeconds > 0 ? Math.min(clip.durationSeconds, available) : available;
      return (
        clip.startSeconds < shot.startSeconds + shot.durationSeconds &&
        clip.startSeconds + length > shot.startSeconds
      );
    });
    if (!globalVoice && !dialogue.some((clip) => clip.label !== "原声")) {
      const native = dialogue.filter((clip) => clip.label === "原声");
      const nativeStart = result.tracks.length;
      if (native.length)
        for (const clip of native) {
          if (clip.sourceKey === shot.nativeSourceKey) append(clip, true);
          else note("INVALID_CLIP");
        }
      else
        append(
          {
            id: `native:${shot.shotId}:${shot.takeId}`,
            lane: "dialogue",
            shotId: shot.shotId,
            takeId: shot.takeId,
            label: "原声",
            sourceKey: shot.nativeSourceKey,
            startSeconds: 0,
            durationSeconds: shot.durationSeconds,
            offsetSeconds: 0,
            gainDb: 0,
          },
          true,
        );
      const segments = result.tracks
        .slice(nativeStart)
        .sort((a, b) => a.startSeconds - b.startSeconds);
      if (
        segments.some(
          (segment, index) => index > 0 && segment.startSeconds < segments[index - 1].endSeconds,
        )
      )
        throw new Error("NATIVE_AUDIO_OVERLAP");
    }
  }
  for (const clip of candidates)
    if (clip.label !== "原声" || clip.lane !== "dialogue") append(clip, false);
  result.duck = duckCurve(result);
  return result;
}
export function audioMixGain(plan, track, seconds) {
  if (!finite(seconds) || seconds < track.startSeconds || seconds >= track.endSeconds) return 0;
  let duck = 1;
  if (track.lane === "score") {
    const curve = plan.duck;
    for (let index = 0; index < curve.length - 1; index++) {
      const left = curve[index],
        right = curve[index + 1];
      if (seconds >= left.seconds && seconds <= right.seconds) {
        duck =
          left.gain +
          ((right.gain - left.gain) * (seconds - left.seconds)) / (right.seconds - left.seconds);
        break;
      }
    }
  }
  return 10 ** (track.gainDb / 20) * duck;
}
export function evaluateAudioMix(plan, seconds) {
  return plan.tracks.map((track) => ({
    key: track.key,
    sourceKey: track.sourceKey,
    sourceSeconds:
      track.offsetSeconds +
      (track.loopSeconds
        ? Math.max(0, seconds - track.startSeconds) % track.loopSeconds
        : Math.max(0, seconds - track.startSeconds)),
    gain: audioMixGain(plan, track, seconds),
  }));
}

export function audioMixSettings(value) {
  const result = {
    schemaVersion: 1,
    lanes: Object.fromEntries(lanes.map((lane) => [lane, { gainDb: 0, muted: false }])),
    autoAdjustVolume: false,
  };
  if (value === undefined) return result;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== "autoAdjustVolume,lanes,schemaVersion" ||
    value.schemaVersion !== 1 ||
    typeof value.autoAdjustVolume !== "boolean" ||
    !value.lanes ||
    typeof value.lanes !== "object" ||
    Object.keys(value.lanes).sort().join() !== "ambience,dialogue,score,sfx"
  )
    throw new Error("INVALID_AUDIO_SETTINGS");
  for (const lane of lanes) {
    const control = value.lanes[lane];
    if (
      !control ||
      typeof control !== "object" ||
      Object.keys(control).sort().join() !== "gainDb,muted" ||
      !finite(control.gainDb) ||
      control.gainDb < -40 ||
      control.gainDb > 12 ||
      typeof control.muted !== "boolean"
    )
      throw new Error("INVALID_AUDIO_SETTINGS");
    result.lanes[lane] = { gainDb: control.gainDb, muted: control.muted };
  }
  result.autoAdjustVolume = value.autoAdjustVolume;
  return result;
}

function duckCurve(plan) {
  const intervals = [];
  for (const speech of [...plan.speech].sort((a, b) => a.startSeconds - b.startSeconds)) {
    const previous = intervals.at(-1);
    if (previous && speech.startSeconds <= previous.endSeconds)
      previous.endSeconds = Math.max(previous.endSeconds, speech.endSeconds);
    else intervals.push({ ...speech });
  }
  const points = new Set([0, plan.durationSeconds]);
  for (const speech of intervals)
    for (const time of [
      speech.startSeconds - 0.3,
      speech.startSeconds,
      speech.endSeconds,
      speech.endSeconds + 0.5,
    ])
      points.add(Math.min(plan.durationSeconds, Math.max(0, time)));
  for (let index = 1; index < intervals.length; index++) {
    const previous = intervals[index - 1],
      next = intervals[index];
    if (next.startSeconds - previous.endSeconds < 0.8)
      points.add((5 * next.startSeconds + 3 * previous.endSeconds) / 8);
  }
  return [...points]
    .sort((a, b) => a - b)
    .filter((seconds, index, sorted) => index === 0 || seconds - sorted[index - 1] > 1e-9)
    .map((seconds) => {
      let gain = 1;
      for (const speech of intervals) {
        const start = speech.startSeconds,
          end = speech.endSeconds;
        const value =
          seconds < start - 0.3 || seconds >= end + 0.5
            ? 1
            : seconds < start
              ? 1 - 0.75 * ((seconds - start + 0.3) / 0.3)
              : seconds <= end
                ? 0.25
                : 0.25 + 0.75 * ((seconds - end) / 0.5);
        gain = Math.min(gain, value);
      }
      return { seconds, gain };
    });
}

export function soloAudioMixPlan(plan, lane) {
  if (!lane) return plan;
  const tracks = plan.tracks.filter((track) => track.lane === lane);
  const speech = lane === "dialogue" ? plan.speech : [];
  const selected = { ...plan, tracks, speech };
  return { ...selected, duck: duckCurve(selected) };
}
