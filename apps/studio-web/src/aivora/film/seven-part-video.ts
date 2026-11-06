import type { FilmProject, FilmShot } from "./project";
import { onScreenCharacters, withoutOffscreenVisuals } from "./on-screen-characters";
import { shotLocation } from "./location-reference";
import { resolveCostumes } from "./costume-rules";
import { shotActionText } from "./shot-actions";
import { actionPlanPrompt } from "./action-plan";
import { performancePlanPrompt } from "./performance-plan";
import { directorPlanPrompt } from "./director-plan";

export type ReviewedVideoPrompt = { schemaVersion: 1; text: string; factsKey: string };
export type VideoFactSection = { label: string; text: string; undecided: boolean };
export type SevenPartVideo = {
  sections: VideoFactSection[];
  issues: string[];
  draft: ReviewedVideoPrompt;
};
export const VIDEO_FACTS_STALE = {
  code: "REQUEST_STALE",
  text: "视频说明对应的事实或版本已变化，请重新整理后再生成。",
} as const;

/** Explicit shot membership plus the existing visual exclusions; never the entire cast. */
export function videoFactCast(film: FilmProject, shot: FilmShot) {
  return onScreenCharacters(
    { characters: film.characters.filter((person) => shot.characters.includes(person.name)) },
    shot,
  );
}

/** Text facts only. This does not inspect pixels, verify acting, or authorize generation. */
export function compileSevenPartVideo(film: FilmProject, shot: FilmShot): SevenPartVideo {
  const issues: string[] = [];
  const people = videoFactCast(film, shot);
  const visible = new Set(people.map((person) => person.name));
  const place = shotLocation(film, shot);
  // A generated empty location placeholder carries no new creative description.
  // Its later image/record arrival must not invalidate otherwise identical facts.
  const describedPlace = place && (place.prompt.trim() || place.layout?.trim()) ? place : undefined;
  const visual = [shot.picture, shotActionText(shot), shot.blocking, shot.facing]
    .filter(Boolean)
    .join("\n");
  const props = film.props.filter((prop) => prop.name.trim() && visual.includes(prop.name));
  const costumes = resolveCostumes(film)
    .accepted.filter(
      ({ sceneId, rule }) =>
        sceneId === shot.sceneId &&
        visible.has(rule.name) &&
        !shot.userFields.some((field) =>
          ["picture", "action", "costume", "costumes", "promptZh", "promptEn"].includes(field),
        ) &&
        !people
          .find((person) => person.name === rule.name)
          ?.userFields.some((field) => ["identity", "costume", "costumes"].includes(field)),
    )
    .map(({ rule }) => `${rule.name}：${rule.description}`);
  const scoped: FilmShot = {
    ...shot,
    characters: people.map((person) => person.name),
    ...(shot.directorPlan
      ? {
          directorPlan: {
            ...shot.directorPlan,
            segments: shot.directorPlan.segments.map((segment) => ({
              ...segment,
              dialogueCues: [],
            })),
          },
        }
      : {}),
  };
  const action = withoutOffscreenVisuals(
    [
      shotActionText(shot),
      actionPlanPrompt(scoped),
      performancePlanPrompt(scoped) || shot.performance,
    ]
      .filter(Boolean)
      .join("\n"),
    film,
    shot,
  );
  const constraints = withoutOffscreenVisuals(directorPlanPrompt(scoped, "video"), film, shot);
  const layout = withoutOffscreenVisuals(
    [
      shot.picture,
      shot.blocking ? `站位：${shot.blocking}` : "",
      shot.facing ? `朝向：${shot.facing}` : "",
      describedPlace
        ? [describedPlace.name, describedPlace.prompt, describedPlace.layout]
            .filter(Boolean)
            .join("；")
        : "",
      ...props.map((prop) => `${prop.name}：${prop.note}`),
    ]
      .filter(Boolean)
      .join("\n"),
    film,
    shot,
  );
  const identity = people
    .map((person) =>
      [person.name, person.identity, person.gender, person.ageBand].filter(Boolean).join("；"),
    )
    .concat(costumes)
    .join("\n");
  const sound = [
    shot.line.trim() ? `台词：${shot.line}` : "台词尚未填写，不据此认定没有对白。",
    shot.speaker ? `说话人：${shot.speaker}` : "",
    shot.delivery ? `语气：${shot.delivery}` : "",
    shot.sound.ambience ? `环境音设想：${shot.sound.ambience}` : "",
    ...shot.sound.sfx.map((cue) => cue.text),
    shot.sound.musicMood ? `配乐设想：${shot.sound.musicMood}` : "",
    "声音需独立配音与后期处理；当前视频请求关闭原生声音，不会按本段自动生成声音。",
  ]
    .filter(Boolean)
    .join("\n");
  const section = (label: string, value: string): VideoFactSection => ({
    label,
    text: value.trim() || "待决定",
    undecided: !value.trim(),
  });
  let unsafe = false;
  const camera = [
    shot.size ? `景别：${shot.size}` : "",
    shot.angle ? `角度：${shot.angle}` : "",
    shot.move ? `运镜：${shot.move}` : "",
    Number.isFinite(shot.seconds) ? `${shot.seconds} 秒` : "",
    film.aspectRatio,
  ]
    .filter(Boolean)
    .join("；");
  const sections = [
    section("风格", [film.styleZh, shot.styleNote].filter(Boolean).join("\n")),
    section(
      "镜头",
      `景别：${shot.size || "待决定"}；角度：${shot.angle || "待决定"}；运镜：${shot.move || "待决定"}；时长：${Number.isFinite(shot.seconds) ? `${shot.seconds} 秒` : "待决定"}；画幅：${film.aspectRatio || "待决定"}`,
    ),
    section("布局", layout),
    section("身份", identity),
    section("动作", action),
    section("声音", sound),
    section("约束", constraints),
  ];
  sections[1]!.undecided =
    !shot.size || !shot.angle || !shot.move || !Number.isFinite(shot.seconds);
  if (people.some((person) => !person.identity.trim())) {
    sections[3]!.undecided = true;
    sections[3]!.text += "\n有已选人物的外貌尚未填写，仍待决定。";
  }
  const internalIds = [
    film.id,
    film.seriesId,
    film.backendProjectId,
    shot.id,
    shot.sceneId,
    shot.selectedTakeId,
    ...film.characters.map((person) => person.id),
  ].filter((id) => id.length >= 8);
  const paths = [
    shot.poster,
    ...shot.stills.map((item) => item.url),
    ...shot.takes.flatMap((take) => [take.videoPath, take.cleanVideoPath, take.stillUrl]),
    ...people.flatMap((person) => person.portraits.map((portrait) => portrait.url)),
    place?.referenceImage,
  ].filter((value): value is string => !!value && value.length >= 8);
  for (const entry of sections) {
    // Inspect only selected text facts, not arbitrary serialized metadata. Story URLs and
    // numbers remain legitimate prose; known internal identities/media addresses do not.
    if (
      internalIds.some((id) => entry.text.includes(id)) ||
      paths.some((path) => entry.text.includes(path)) ||
      /\bBearer\s+[A-Za-z0-9._~-]{20,}|\bsk[-_][A-Za-z0-9_-]{20,}/iu.test(entry.text) ||
      /^(?:file|aivora-media|data|blob):\S+$/iu.test(entry.text.trim()) ||
      /^(?:[A-Z]:[\\/]|\/(?:tmp|home|Users|workspace|var)\/)\S*$/u.test(entry.text.trim()) ||
      [...entry.text].some((character) => {
        const code = character.codePointAt(0)!;
        return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
      })
    ) {
      unsafe = true;
      issues.push(`${entry.label}中含有不能提交的本机信息，请先清理对应说明。`);
      entry.text = "此段含有不能提交的信息，暂不展示。";
    }
  }
  if (!Number.isInteger(shot.seconds) || shot.seconds < 1 || shot.seconds > 15)
    issues.push("当前视频请求需要 1–15 秒的整数时长，请先调整或拆分镜头。不要只截短说明。");
  if (!shot.picture.trim() && !action.trim())
    issues.push("画面和动作尚未决定，请先补充这一镜。 ".trim());
  if (
    shot.characters.some(
      (name) => film.characters.filter((person) => person.name === name).length !== 1,
    )
  )
    issues.push("出镜人物的对应尚不明确，请先核对人物选择。");
  const submitVisual = [layout, action, constraints].join("\n");
  if (
    film.characters.some(
      (person) =>
        !visible.has(person.name) &&
        withoutOffscreenVisuals(submitVisual, film, shot).includes(person.name),
    )
  )
    issues.push("说明涉及未选为可见的人物，请先核对出镜人物与画面说明。");
  const body = [
    `镜头：${camera}`,
    layout ? `画面与布局：${layout}` : "",
    identity ? `人物身份与服装：${identity}` : "",
    action ? `动作与表演：${action}` : "",
    constraints ? `画面约束：${constraints}` : "",
    shot.styleNote ? `本镜风格：${shot.styleNote}` : "",
    "从开头画面延续。视频不要自行出声，声音另行制作。",
  ]
    .filter(Boolean)
    .join("\n");
  // Fixed creative inputs only: ordinary saves, jobs, measurements and incoming media do
  // not invalidate a review. Identity/selection and all emitted facts do invalidate it.
  const factsKey = JSON.stringify([
    film.id,
    shot.id,
    shot.sceneId,
    shot.selectedTakeId,
    sections.map(({ label, text, undecided }) => [label, text, undecided]),
    film.sourceText,
    film.scenes.find((scene) => scene.id === shot.sceneId)?.text ?? "",
    shot.characters,
    shot.userFields,
    shot.lines ?? [],
    film.characters
      .filter((person) =>
        [
          ...shot.characters,
          shot.speaker ?? "",
          ...(shot.lines ?? []).map((line) => line.speaker),
        ].includes(person.name),
      )
      .map((person) => [person.id, person.voiceId, person.voiceCode ?? ""]),
    shot.characters.length || shot.speaker || shot.lines?.some((line) => line.speaker)
      ? ""
      : film.narrationVoiceId,
    shot.sound.source,
    people.map((person) => [person.id, person.name, person.identity]),
    props.map((prop) => [prop.id, prop.name, prop.note]),
    describedPlace?.id ?? null,
    film.scenes.find((scene) => scene.id === shot.sceneId)?.where ?? "",
  ]);
  return { sections, issues, draft: { schemaVersion: 1, text: unsafe ? "" : body, factsKey } };
}

/** A cache body cannot borrow trust from a matching key. No review retains legacy behavior. */
export function reviewedVideoText(film: FilmProject, shot: FilmShot): string | undefined {
  if (shot.reviewedVideoPrompt === undefined) return undefined;
  const compiled = compileSevenPartVideo(film, shot),
    saved = shot.reviewedVideoPrompt;
  if (
    !saved ||
    saved.schemaVersion !== 1 ||
    compiled.issues.length ||
    saved.factsKey !== compiled.draft.factsKey ||
    saved.text !== compiled.draft.text
  )
    throw Object.assign(new Error(VIDEO_FACTS_STALE.text), VIDEO_FACTS_STALE);
  return saved.text;
}
