import { shotActions, shotActionText, withShotActions } from "./shot-actions";
import { mergeDirectorPlans } from "./director-plan";
import { extractScriptLines, type ScriptLine } from "./phase2";
import type { FilmShot } from "./project";

export type { SceneCoverage as DirectorCoverage } from "./contracts3j";
import type { SceneCoverage } from "./contracts3j";

/** Legacy scalar edits remain authoritative until the editor also updates lines. */
export function shotLines(shot: Pick<FilmShot, "line" | "speaker" | "lines">): ScriptLine[] {
  const lines = (shot.lines ?? []).filter((line) => line.text.trim());
  if (
    lines.length &&
    (lines.map((line) => line.text).join("\n") === shot.line || lines[0]?.text === shot.line)
  )
    return lines;
  return shot.line.trim() ? [{ speaker: shot.speaker ?? "", text: shot.line }] : lines;
}

export function dialogueSentences(text: string): string[] {
  return (text.match(/[^。！？!?]+[。！？!?]*|[。！？!?]+/gu) ?? [])
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Formatting is not missing story: keep every word/number, ignore only punctuation and spacing. */
const coverageText = (text: string) => text.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");

function tailNarration(tail: string): string[] {
  const dialogue = extractScriptLines(tail).map((line) => coverageText(line.text));
  const printed: string[] = [];
  let narration = tail.replace(/“([^”]*)”|「([^」]*)」|"([^"\n]*)"/gu, (_match, a, b, c) => {
    const content = coverageText(a ?? b ?? c ?? "");
    if (content && !dialogue.includes(content)) printed.push(content);
    return "";
  });
  if (narration === tail && /^[^：:\n]{1,12}[：:]/u.test(tail)) {
    const lines = extractScriptLines(tail);
    if (lines.length) {
      narration = tail.replace(/^[^：:\n]{1,12}[：:]\s*/u, "");
      for (const line of lines) narration = narration.replace(line.text, "");
    }
  }
  return [
    ...narration
      .split(/[，,。！？!?；;\n]+/u)
      .map(coverageText)
      .filter(Boolean),
    ...printed,
  ];
}

/** Strict evidence check: no source text is inserted and no semantic coverage is guessed. */
export function detectDirectorCoverage(
  scene: { id: string; text: string; paragraphCoverage?: { ok: boolean } },
  shots: readonly FilmShot[],
): SceneCoverage {
  const expected = extractScriptLines(scene.text).flatMap((line) => dialogueSentences(line.text));
  const current = shots.filter((shot) => shot.sceneId === scene.id);
  const spoken = current
    .flatMap(shotLines)
    .map((line) => coverageText(line.text))
    .join("\n");
  const missingLines: string[] = [];
  let cursor = 0;
  for (const line of expected) {
    const normalized = coverageText(line);
    const at = spoken.indexOf(normalized, cursor);
    if (at < 0) missingLines.push(line);
    else cursor = at + normalized.length;
  }
  const tail =
    scene.text
      .trim()
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  const evidence = current
    .map((shot) =>
      [shot.picture, shotActionText(shot), ...shotLines(shot).map((line) => line.text)].join("\n"),
    )
    .join("\n");
  const normalizedEvidence = coverageText(evidence);
  const missingTail = tailNarration(tail).some((part) => !normalizedEvidence.includes(part))
    ? tail
    : null;
  return {
    sceneId: scene.id,
    ok: scene.paragraphCoverage?.ok !== false && !missingLines.length && !missingTail,
    lastLine: expected.at(-1) ?? "",
    missingLines,
    missingTail,
  };
}

/** A bounded repair request, containing the full missing text but not the whole novel again. */
export function coverageRepairContext(
  scene: { id: string; text: string; paragraphCoverage?: { ok: boolean } },
  shots: readonly FilmShot[],
): string {
  const coverage = detectDirectorCoverage(scene, shots);
  const tail = scene.text.trim().split(/\n+/).filter(Boolean).at(-1) ?? "";
  return JSON.stringify({
    scene_id: scene.id,
    source_text: scene.text,
    paragraph_risks: scene.paragraphCoverage ?? null,
    instruction:
      "只补齐缺失台词和尾段，按原文顺序返回这一场完整shots；保留现有镜头id，不增加原文没有的台词和动作。目标每40–60字一镜、最多16镜；合并相邻节拍，无法满足时保留完整内容并说明。",
    existing_shots: shots
      .filter((shot) => shot.sceneId === scene.id)
      .map((shot) => ({
        id: shot.id,
        picture: shot.picture,
        action: shotActionText(shot),
        lines: shotLines(shot),
      })),
    missing_lines: coverage.missingLines,
    missing_tail: coverage.missingTail ? tail : "",
  });
}

export function suggestedShotCount(text: string): number {
  return Math.min(16, Math.max(1, Math.round(text.trim().length / 50)));
}

export type ShotMergeBlockReason =
  | "SCENE_MISMATCH"
  | "HAS_MEDIA"
  | "HAS_SELECTED_TAKE"
  | "HAS_CONTINUITY_FRAME"
  | "USER_LOCKED"
  | "INVALID_DURATION"
  | "DURATION_OVER_15S"
  | "SOUND_SOURCE_MISMATCH"
  | "MUSIC_MOOD_MISMATCH"
  | "STYLE_MISMATCH"
  | "FRAMING_MISMATCH";
export type SceneShotBudget = {
  sceneId: string;
  limit: 16;
  count: number;
  ok: boolean;
  blockedPairs: { shotIds: [string, string]; reasons: ShotMergeBlockReason[] }[];
};

/** The report and merger share these constraints; framing is only a first-pass preference. */
export function shotMergeBlockReasons(
  left: FilmShot,
  right: FilmShot,
  preserveFraming = false,
): ShotMergeBlockReason[] {
  const reasons: ShotMergeBlockReason[] = [];
  if (left.sceneId !== right.sceneId) reasons.push("SCENE_MISMATCH");
  if ([left, right].some((s) => s.takes.length || s.stills.length || s.poster))
    reasons.push("HAS_MEDIA");
  if (left.selectedTakeId || right.selectedTakeId) reasons.push("HAS_SELECTED_TAKE");
  if (left.continuityFrame || right.continuityFrame) reasons.push("HAS_CONTINUITY_FRAME");
  if (left.userFields.length || right.userFields.length) reasons.push("USER_LOCKED");
  if ([left, right].some((s) => !Number.isFinite(s.seconds) || s.seconds <= 0))
    reasons.push("INVALID_DURATION");
  else if (left.seconds + right.seconds > 15) reasons.push("DURATION_OVER_15S");
  if (left.sound.source !== right.sound.source) reasons.push("SOUND_SOURCE_MISMATCH");
  if (left.sound.musicMood !== right.sound.musicMood) reasons.push("MUSIC_MOOD_MISMATCH");
  if (left.styleNote !== right.styleNote) reasons.push("STYLE_MISMATCH");
  if (
    preserveFraming &&
    (left.size !== right.size ||
      left.angle !== right.angle ||
      left.tag !== right.tag ||
      left.move !== right.move)
  )
    reasons.push("FRAMING_MISMATCH");
  return reasons;
}
export function sceneShotBudget(sceneId: string, shots: readonly FilmShot[]): SceneShotBudget {
  const rows = shots.filter((s) => s.sceneId === sceneId);
  return {
    sceneId,
    limit: 16,
    count: rows.length,
    ok: rows.length <= 16,
    blockedPairs:
      rows.length <= 16
        ? []
        : rows.flatMap((left, index) => {
            const right = rows[index + 1];
            if (!right) return [];
            const reasons = shotMergeBlockReasons(left, right);
            return reasons.length
              ? [{ shotIds: [left.id, right.id] as [string, string], reasons }]
              : [];
          }),
  };
}
const mergeReasonText: Record<ShotMergeBlockReason, string> = {
  SCENE_MISMATCH: "不在同一场",
  HAS_MEDIA: "已有生成素材",
  HAS_SELECTED_TAKE: "已有选定版本",
  HAS_CONTINUITY_FRAME: "已有衔接画面",
  USER_LOCKED: "已有手动修改",
  INVALID_DURATION: "时长需要确认",
  DURATION_OVER_15S: "合并后超过15秒",
  SOUND_SOURCE_MISMATCH: "声音来源不同",
  MUSIC_MOOD_MISMATCH: "配乐安排不同",
  STYLE_MISMATCH: "画风不同",
  FRAMING_MISMATCH: "拍法不同",
};
export function formatShotBudget(report: SceneShotBudget, shots: readonly FilmShot[]): string {
  const number = (id: string) => {
    const shot = shots.find((s) => s.sceneId === report.sceneId && s.id === id);
    return shot ? `第${shot.no}镜` : "未编号镜头";
  };
  return [
    `这一场共${report.count}镜，最多${report.limit}镜。`,
    ...report.blockedPairs.map(
      (pair) =>
        `${pair.shotIds.map(number).join("、")}：${pair.reasons.map((reason) => mergeReasonText[reason]).join("、")}。`,
    ),
  ].join("\n");
}

/** Merge adjacent compatible, unrendered shots only; never discard lines to meet the target. */
export function mergeAdjacentShots(shots: readonly FilmShot[], target: number): FilmShot[] {
  const next = shots.map((shot) => ({ ...shot, lines: shotLines(shot) }));
  while (next.length > Math.max(1, target)) {
    const compatible = (left: (typeof next)[number], i: number, reframe = false) => {
      const right = next[i + 1];
      return Boolean(right && !shotMergeBlockReasons(left, right, !reframe).length);
    };
    // Different framing must not prevent a lossless compression pass above the scene limit.
    // Keep the first frame's camera choice; retain every narrative field and timed cue.
    let index = next.findIndex((left, i) => compatible(left, i));
    if (index < 0 && next.length > 16)
      index = next.findIndex((left, i) => compatible(left, i, true));
    if (index < 0) break;
    const left = next[index]!;
    const right = next[index + 1]!;
    const join = (a: string | undefined, b: string | undefined) =>
      [a, b].filter(Boolean).join("\n");
    const lines = [...left.lines, ...right.lines];
    const merged: FilmShot = {
      ...left,
      seconds: left.seconds + right.seconds,
      picture: join(left.picture, right.picture),
      ...(left.directorFramePrompt || right.directorFramePrompt
        ? {
            directorFramePrompt: join(
              left.directorFramePrompt || left.picture,
              right.directorFramePrompt || right.picture,
            ),
          }
        : {}),
      ...(left.directorVideoPrompt || right.directorVideoPrompt
        ? {
            directorVideoPrompt: join(
              left.directorVideoPrompt || left.picture,
              right.directorVideoPrompt || right.picture,
            ),
          }
        : {}),
      ...(left.promptZh || right.promptZh
        ? {
            promptZh: join(
              left.promptZh || left.directorFramePrompt || left.picture,
              right.promptZh || right.directorFramePrompt || right.picture,
            ),
          }
        : {}),
      ...(left.promptEn || right.promptEn ? { promptEn: join(left.promptEn, right.promptEn) } : {}),
      action: shotActions(left)[0] || shotActions(right)[0] || "",
      actionBeats: [...shotActions(left), ...shotActions(right)],
      performance: join(left.performance, right.performance),
      blocking: join(left.blocking, right.blocking),
      facing: join(left.facing, right.facing),
      delivery: join(left.delivery, right.delivery),
      characters: [...new Set([...left.characters, ...right.characters])],
      lines,
      line: lines.map((line) => line.text).join("\n"),
      speaker:
        new Set(lines.map((line) => line.speaker)).size === 1 ? (lines[0]?.speaker ?? "") : "",
      sound: {
        ...left.sound,
        ambience: join(left.sound.ambience, right.sound.ambience),
        sfx: [
          ...left.sound.sfx,
          ...right.sound.sfx.map((cue) => ({ ...cue, atSeconds: cue.atSeconds + left.seconds })),
        ],
      },
    };
    const compact = withShotActions(merged, [...shotActions(left), ...shotActions(right)]);
    const plan = mergeDirectorPlans(left, right, compact);
    if (plan) compact.directorPlan = plan;
    next.splice(index, 2, { ...compact, lines });
  }
  const reserved = new Set(next.map((shot) => shot.id).filter(Boolean));
  const used = new Set<string>();
  const count = new Map<string, number>();
  return next.map((shot) => {
    const no = (count.get(shot.sceneId) ?? 0) + 1;
    count.set(shot.sceneId, no);
    let id = shot.id;
    if (!id || used.has(id)) {
      let suffix = no;
      do {
        id = `${shot.sceneId}-shot-${suffix++}`;
      } while (reserved.has(id) || used.has(id));
    }
    used.add(id);
    return { ...shot, no, id };
  });
}

export function directorPlanStatus(
  scene: { id: string; text: string; paragraphCoverage?: { ok: boolean } },
  shots: readonly FilmShot[],
) {
  const target = suggestedShotCount(scene.text);
  const shotCount = shots.filter((shot) => shot.sceneId === scene.id).length;
  return {
    coverage: detectDirectorCoverage(scene, shots),
    shotCount,
    target,
    overBudget: shotCount > target,
  };
}

export function sceneDisplayTitle(title: string, where = "", text = ""): string {
  const supplied = title.trim();
  if (supplied && !/^第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*场$/u.test(supplied))
    return supplied;
  const heading = /^第[0-9０-９一二三四五六七八九十百千零两]+场[ \t\u3000]*([^\n]+)/u
    .exec(text.trim())?.[1]
    ?.trim();
  if (heading) return heading;
  const [place, time] = where.split(/[·_]/u).map((part) => part.trim());
  return `${place || "地点待定"} · ${time || "时间待定"}`;
}
