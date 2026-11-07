import type { FilmRecord } from "./film-library";
import type { TrustedAudioLibrary } from "./film-audio-library-runtime";
import { publicAudioCatalog } from "./film-audio-library-runtime";
import { audioMixEnvelope } from "@aijian/contracts/film-audio-mix-plan";
import type { AudioMixEnvelope } from "@aijian/contracts/film-audio-mix";
import type {
  ShotAudioSuggestedClip,
  ShotAudioSuggestionNote,
} from "@aijian/contracts/film-audio-library";
export class ShotAudioSuggestionLimit extends Error {
  constructor(
    readonly maxSegments: number,
    readonly minimumRequiredSegments: number,
  ) {
    super("PLAN_UNSUPPORTED");
  }
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
function unsupported(): never {
  throw Error("PLAN_UNSUPPORTED");
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) unsupported();
  return value;
}
function number(value: unknown): number {
  if (!finite(value)) unsupported();
  return value;
}
function note(
  code: ShotAudioSuggestionNote["code"],
  message: string,
  index?: number,
): ShotAudioSuggestionNote {
  return { code, message, ...(index !== undefined ? { index } : {}) };
}
export function shotAudioContext(record: FilmRecord, shotId: string, durationSeconds: number) {
  const shot = object(record.shots?.find((raw) => object(raw).id === shotId));
  const scenes = (Array.isArray(record.scenes) ? record.scenes : [])
    .map(object)
    .filter((scene) => scene.id === shot.sceneId);
  if (scenes.length > 1) throw Error("PROJECT_CHANGED");
  const scene = scenes[0] ?? {};
  const sound = object(shot.sound);
  const mood = text(sound.musicMood);
  const limitations: ShotAudioSuggestionNote[] = [];
  const hasMood = Boolean(mood);
  const disabled =
    /^(无|不要|不需要|关闭|静音|none|off|no music)$/i.test(mood) ||
    /(?:无(?:需)?|不要|不需要|不放|关闭)(?:背景)?(?:配乐|音乐)/.test(mood);
  // The source picker consumes emotion items, not a free-form mood sentence.
  // Preserve the sentence and explicit conjunction-separated items; infer none from prose.
  const emotions = hasMood
    ? [
        ...new Set([
          mood,
          ...mood
            .split(/[、,，;；/\s]+|但是|但|并且|同时|且|与|和/)
            .map(text)
            .filter(Boolean),
        ]),
      ]
    : [];
  if (!hasMood) limitations.push(note("MUSIC_MOOD_UNDECIDED", "配乐情绪待决定，暂不建议配乐。"));
  else if (disabled) limitations.push(note("MUSIC_DISABLED", "这一镜保留配乐留白。"));
  const actions: { time: number; label: string }[] = [],
    seen = new Set<string>();
  const cues = Array.isArray(sound.sfx)
    ? sound.sfx.map((raw) => ({ at: object(raw).atSeconds, label: object(raw).text }))
    : [];
  const nodes = object(shot.actionPlan).nodes;
  if (Array.isArray(nodes))
    cues.push(
      ...nodes.map((raw) => {
        const node = object(raw);
        return { at: node.at, label: text(node.sfxCue) || node.move };
      }),
    );
  if (cues.length > 256) unsupported();
  for (const [index, cue] of cues.entries()) {
    if (cue.at === null || cue.at === undefined) {
      limitations.push(
        note("ACTION_TIME_UNCONFIRMED", "动作没有明确计划时间，未安排对应音效。", index + 1),
      );
      continue;
    }
    if (!finite(cue.at) || cue.at < 0 || cue.at >= durationSeconds) {
      limitations.push(
        note("ACTION_TIME_INVALID", "动作时间超出实际镜长，未安排对应音效。", index + 1),
      );
      continue;
    }
    const label = text(cue.label);
    if (!label) {
      limitations.push(note("ACTION_LABEL_MISSING", "声音提示待补充，未安排对应音效。", index + 1));
      continue;
    }
    if (label.length > 512) unsupported();
    const key = JSON.stringify([cue.at, label]);
    if (!seen.has(key)) {
      actions.push({ time: cue.at, label });
      seen.add(key);
    }
  }
  const description = [
    scene.where,
    scene.title,
    scene.ambience,
    shot.picture,
    shot.action,
    sound.ambience,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");
  if (description.length > 8192 || mood.length > 512) unsupported();
  const hasDialogue = Boolean(
    text(shot.line) ||
    (Array.isArray(shot.lines) && shot.lines.some((line) => text(object(line).text))),
  );
  if (actions.length)
    limitations.push(
      note("PLANNED_TIMES_ONLY", "音效按明确的创作计划时间安排，尚未核验成片动作或语音对齐。"),
    );
  const dialogue = [
    text(shot.line),
    ...(Array.isArray(shot.lines) ? shot.lines.map((line) => text(object(line).text)) : []),
  ];
  if (dialogue.join(" ").length > 8192 || cues.some((cue) => text(cue.label).length > 512))
    unsupported();
  return {
    // Internal digest input only; never render source prose or raw scene objects.
    semantic: {
      description,
      mood,
      dialogue,
      cues: cues.map((cue) => ({ at: finite(cue.at) ? cue.at : null, label: text(cue.label) })),
    },
    scene: {
      duration: durationSeconds,
      emotions,
      description,
      shots: [{ duration: durationSeconds, hasDialogue, actions, description: text(shot.picture) }],
    },
    allowMusic: hasMood && !disabled,
    limitations,
  };
}
/** Project the original picker's complete segments. No library path is an authority or returned DTO. */
export function compileShotAudioSuggestion(
  raw: unknown,
  library: TrustedAudioLibrary,
  duration: number,
  allowMusic: boolean,
  maxClips: number,
) {
  const selection = object(raw),
    catalog = publicAudioCatalog(library).assets;
  const assets = new Map(catalog.map((asset) => [asset.id, asset]));
  const clips: ShotAudioSuggestedClip[] = [],
    limitations: ShotAudioSuggestionNote[] = [];
  function compile(cueRaw: unknown, lane: ShotAudioSuggestedClip["lane"], music = false) {
    const cue = object(cueRaw);
    if (lane === "sfx" && cue.reason === "根据场景设备安排声音") {
      limitations.push(note("DEVICE_TIME_UNCONFIRMED", "设备声缺少明确计划时间，暂未安排音效。"));
      return;
    }
    const gain = music ? 0 : number(cue.gainDb);
    if (gain < -96 || gain > 24) unsupported();
    const segments = array(cue.segments);
    if (!segments.length) unsupported();
    for (const item of segments) {
      const segment = object(item),
        asset = assets.get(text(segment.assetId));
      if (!asset || (lane === "score" ? asset.type !== "music" : asset.type !== "sfx"))
        unsupported();
      const start = number(segment.time),
        end = number(segment.end),
        offset = number(segment.sourceStart);
      if (
        start < 0 ||
        end <= start ||
        end > duration + 1e-6 ||
        offset < 0 ||
        offset + end - start > asset.durationSeconds + 1 / 48000
      )
        unsupported();
      if (clips.length >= maxClips || clips.length >= 128)
        throw new ShotAudioSuggestionLimit(Math.min(maxClips, 128), clips.length + 1);
      const fades: NonNullable<AudioMixEnvelope["fades"]> = [];
      function fade(direction: "in" | "out", length: unknown, origin: unknown, fallback: number) {
        const seconds = number(length);
        if (seconds < 0) unsupported();
        if (seconds > 0)
          fades.push({
            direction,
            durationSeconds: seconds,
            startSeconds: (origin === undefined ? fallback : number(origin)) - start,
          });
      }
      fade("in", segment.fadeIn, segment.fadeInStart, start);
      fade("out", segment.fadeOut, segment.fadeOutStart, end - number(segment.fadeOut));
      if (music) {
        fade("in", cue.fadeIn, undefined, number(cue.start));
        fade("out", cue.fadeOut, undefined, number(cue.end) - number(cue.fadeOut));
      }
      const automation: NonNullable<AudioMixEnvelope["gainAutomation"]> = [];
      if (cue.gainAutomation !== undefined)
        for (const item of array(cue.gainAutomation)) {
          const row = object(item),
            from = number(row.start),
            to = number(row.end),
            gainDb = number(row.gainDb);
          if (to <= from) unsupported();
          if (to <= start || from >= end) continue;
          automation.push({
            startSeconds: Math.max(start, from) - start,
            endSeconds: Math.min(end, to) - start,
            gainDb,
          });
        }
      let envelope: AudioMixEnvelope;
      try {
        envelope = audioMixEnvelope({
          schemaVersion: 1,
          baseGainDb: gain,
          ...(fades.length ? { fades } : {}),
          ...(automation.length ? { gainAutomation: automation } : {}),
        });
      } catch {
        unsupported();
      }
      clips.push({
        key: `${lane}:${clips.length + 1}`,
        asset,
        lane,
        placement: {
          startSeconds: start,
          durationSeconds: end - start,
          offsetSeconds: offset,
          gainDb: gain,
          loop: false,
        },
        envelope,
        reason:
          lane === "score"
            ? "按明确配乐情绪安排完整片段与淡化。"
            : lane === "ambience"
              ? "按本镜环境安排连续底声片段。"
              : "按明确计划时间安排动作音效。",
      });
    }
  }
  for (const cue of array(selection.ambience)) compile(cue, "ambience");
  const shots = array(selection.shots);
  if (shots.length !== 1) unsupported();
  // Ambience shot views are deliberately not rendered a second time.
  for (const cue of array(object(shots[0]).effects)) compile(cue, "sfx");
  if (allowMusic && selection.music !== null) compile(selection.music, "score", true);
  if (allowMusic && selection.music === null) {
    limitations.push(
      selection.reason === "安静情绪保留留白"
        ? note("MUSIC_QUIET", "按已确认情绪保留配乐留白。")
        : note("MUSIC_MATCH_MISSING", "暂无匹配配乐，可手动选择或调整情绪。"),
    );
  }
  const warnings = array(selection.warnings).map((_raw, index) =>
    note("MATCH_MISSING", "有一项声音暂无匹配素材，请手动选择。", index + 1),
  );
  if (warnings.length > 512) unsupported();
  return { clips, warnings, limitations };
}
