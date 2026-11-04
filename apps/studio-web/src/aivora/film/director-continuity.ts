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

/** Strict evidence check: no source text is inserted and no semantic coverage is guessed. */
export function detectDirectorCoverage(
  scene: { id: string; text: string; paragraphCoverage?: { ok: boolean } },
  shots: readonly FilmShot[],
): SceneCoverage {
  const expected = extractScriptLines(scene.text).flatMap((line) => dialogueSentences(line.text));
  const current = shots.filter((shot) => shot.sceneId === scene.id);
  const spoken = current
    .flatMap(shotLines)
    .map((line) => line.text)
    .join("\n");
  const missingLines: string[] = [];
  let cursor = 0;
  for (const line of expected) {
    const at = spoken.indexOf(line, cursor);
    if (at < 0) missingLines.push(line);
    else cursor = at + line.length;
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
      [shot.picture, shot.action, ...shotLines(shot).map((line) => line.text)].join("\n"),
    )
    .join("\n");
  const missingTail = tail && !evidence.includes(tail) ? tail : null;
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
    paragraph_risks: scene.paragraphCoverage ?? null,
    instruction:
      "只补齐缺失台词和尾段，按原文顺序返回这一场完整shots；保留现有镜头id，不增加原文没有的台词和动作。目标每40–60字一镜、最多16镜；合并相邻节拍，无法满足时保留完整内容并说明。",
    existing_shots: shots
      .filter((shot) => shot.sceneId === scene.id)
      .map((shot) => ({
        id: shot.id,
        picture: shot.picture,
        action: shot.action,
        lines: shotLines(shot),
      })),
    missing_lines: coverage.missingLines,
    missing_tail: coverage.missingTail ? tail : "",
  });
}

export function suggestedShotCount(text: string): number {
  return Math.min(16, Math.max(1, Math.round(text.trim().length / 50)));
}

/** Merge adjacent compatible, unrendered shots only; never discard lines to meet the target. */
export function mergeAdjacentShots(shots: readonly FilmShot[], target: number): FilmShot[] {
  const next = shots.map((shot) => ({ ...shot, lines: shotLines(shot) }));
  while (next.length > Math.max(1, target)) {
    const index = next.findIndex((left, i) => {
      const right = next[i + 1];
      return Boolean(
        right &&
        new Set([...left.lines, ...right.lines].map((line) => line.speaker.trim()).filter(Boolean))
          .size <= 1 &&
        left.sceneId === right.sceneId &&
        left.size === right.size &&
        left.angle === right.angle &&
        left.tag === right.tag &&
        left.sound.source === right.sound.source &&
        left.sound.musicMood === right.sound.musicMood &&
        left.styleNote === right.styleNote &&
        left.move === right.move &&
        left.seconds + right.seconds <= 15 &&
        !left.takes.length &&
        !right.takes.length &&
        !left.stills.length &&
        !right.stills.length &&
        !left.poster &&
        !right.poster &&
        !left.userFields.length &&
        !right.userFields.length,
      );
    });
    if (index < 0) break;
    const left = next[index]!;
    const right = next[index + 1]!;
    const join = (a: string | undefined, b: string | undefined) =>
      [a, b].filter(Boolean).join("\n");
    const lines = [...left.lines, ...right.lines];
    next.splice(index, 2, {
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
      action: join(left.action, right.action),
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
    });
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
