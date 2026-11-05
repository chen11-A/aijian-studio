import {
  coverageRepairContext,
  detectDirectorCoverage,
  shotLines,
  type DirectorCoverage,
} from "../film/director-continuity";
import {
  parseDirectorShots,
  applyShots,
  type FilmProject,
  type FilmScene,
  type FilmShot,
} from "../film/project";
import type { AgentReply } from "./workflow";
import { shotActions } from "../film/shot-actions";

export type DirectorRepairResult = {
  shots: FilmShot[];
  coverage: DirectorCoverage;
  repaired: boolean;
};
export type RepairRequest = (context: string, instruction: string) => Promise<AgentReply>;

/** Match occurrences, not a set: repeated dialogue and speaker ownership must survive. */
function containsDialogueInOrder(
  expected: ReturnType<typeof shotLines>,
  actual: ReturnType<typeof shotLines>,
): boolean {
  let cursor = 0;
  return expected.every((line) => {
    while (cursor < actual.length) {
      const candidate = actual[cursor++]!;
      if (candidate.speaker === line.speaker && candidate.text === line.text) return true;
    }
    return false;
  });
}

/** One repair attempt; a failed or lossy answer never replaces the existing plan. */
export async function repairDirectorCoverage(
  scene: Pick<FilmScene, "id" | "text" | "title" | "where">,
  shots: FilmShot[],
  request: RepairRequest,
  current: () => boolean = () => true,
): Promise<DirectorRepairResult> {
  const coverage = detectDirectorCoverage(scene, shots);
  const overLimit = shots.filter((shot) => shot.sceneId === scene.id).length > 16;
  if ((coverage.ok && !overLimit) || !current()) return { shots, coverage, repaired: false };
  try {
    const reply = await request(
      coverageRepairContext(scene, shots),
      overLimit
        ? "把这一场相邻镜头合并到最多16镜，同时补齐缺失台词与结尾。返回完整镜头；全部台词及说话人逐条按序保留，原画面与动作按序保留，绝不截断或删减。"
        : "只补这一场缺失台词与结尾，返回按原文顺序的完整镜头；合并节拍，绝不截断。",
    );
    if (!current() || !reply.text) return { shots, coverage, repaired: false };
    const parsed = parseDirectorShots(reply.text, scene.id, scene.text, [scene]);
    if (!parsed) return { shots, coverage, repaired: false };
    const repairedCoverage = detectDirectorCoverage(scene, parsed);
    if (overLimit && (parsed.length > 16 || !repairedCoverage.ok))
      return { shots, coverage, repaired: false };
    const containsInOrder = (expected: string[], actual: string) => {
      let cursor = 0;
      return expected.filter(Boolean).every((text) => {
        const index = actual.indexOf(text, cursor);
        if (index < 0) return false;
        cursor = index + text.length;
        return true;
      });
    };
    // Segmentation may add whitespace, but every word, punctuation mark and
    // movement must remain in its original order, including secondary beats.
    const actionText = (shot: FilmShot) => shotActions(shot).join("").replace(/\s+/gu, "");
    const losesShotContent =
      !containsInOrder(
        shots.map((shot) => shot.picture),
        parsed.map((shot) => shot.picture).join("\n"),
      ) ||
      !containsInOrder(shots.map(actionText), parsed.map(actionText).join("")) ||
      !containsDialogueInOrder(shots.flatMap(shotLines), parsed.flatMap(shotLines));
    const losesCoverage =
      losesShotContent ||
      repairedCoverage.missingLines.some(
        (line) =>
          repairedCoverage.missingLines.filter((item) => item === line).length >
          coverage.missingLines.filter((item) => item === line).length,
      ) ||
      repairedCoverage.missingLines.some((line) => !coverage.missingLines.includes(line)) ||
      (!coverage.missingTail && repairedCoverage.missingTail);
    if (losesCoverage) return { shots, coverage, repaired: false };
    const sameContent = (a: FilmShot, b: FilmShot) =>
      a.picture === b.picture &&
      actionText(a) === actionText(b) &&
      JSON.stringify(shotLines(a)) === JSON.stringify(shotLines(b));
    const protectedShot = (shot: FilmShot) =>
      shot.userFields.length ||
      shot.poster ||
      shot.stills.length ||
      shot.takes.length ||
      shot.selectedTakeId ||
      shot.continuityFrame;
    if (
      shots.some(
        (shot) => protectedShot(shot) && !parsed.some((candidate) => sameContent(shot, candidate)),
      )
    )
      return { shots, coverage, repaired: false };
    const fresh = shots.every((shot) => !protectedShot(shot));
    const used = new Set<string>();
    const rows = parsed.map((candidate, index) => {
      const original = shots.find((shot) => !used.has(shot.id) && sameContent(shot, candidate));
      if (original) used.add(original.id);
      const id = fresh
        ? `${scene.id}-shot-${index + 1}`
        : (original?.id ?? `${scene.id}-repair-${crypto.randomUUID()}`);
      return { original, candidate, shot: { ...(original ?? candidate), id, no: index + 1 } };
    });
    const references = (kind: "original" | "candidate") => {
      const mapping = new Map<string, string>();
      const ambiguous = new Set<string>();
      for (const row of rows) {
        const source = row[kind];
        if (!source || source.sceneId !== scene.id) continue;
        if (mapping.has(source.id)) ambiguous.add(source.id);
        else mapping.set(source.id, row.shot.id);
      }
      for (const id of ambiguous) mapping.delete(id);
      return mapping;
    };
    const originalReferences = references("original");
    const candidateReferences = references("candidate");
    const restored = rows.map((row, index) => {
      // Existing assets, their identifiers and their references are immutable.
      if (!fresh && row.original) return row.shot;
      const originalLink = row.original?.continuityFromShotId;
      const requested = originalLink ?? row.candidate.continuityFromShotId;
      const resolved =
        requested && (originalLink ? originalReferences : candidateReferences).get(requested);
      const next = { ...row.shot };
      if (resolved && rows[index - 1]?.shot.id === resolved) next.continuityFromShotId = resolved;
      else delete next.continuityFromShotId;
      return next;
    });
    if (
      rows.some((row, index) => {
        const original = row.original;
        if (!original || !protectedShot(original) || !original.continuityFromShotId) return false;
        const oldIndex = shots.indexOf(original);
        return (
          shots[oldIndex - 1]?.id === original.continuityFromShotId &&
          restored[index - 1]?.id !== original.continuityFromShotId
        );
      })
    )
      return { shots, coverage, repaired: false };
    return { shots: restored, coverage: detectDirectorCoverage(scene, restored), repaired: true };
  } catch {
    return { shots, coverage, repaired: false };
  }
}

/** Host adapter for Claude's fixCoverage(sceneId) callback; preserves unrelated scenes. */
export async function fixCoverage(
  film: FilmProject,
  sceneId: string,
  request: RepairRequest,
  current: () => boolean = () => true,
): Promise<{ film: FilmProject; coverage: DirectorCoverage | null }> {
  const scene = film.scenes.find((item) => item.id === sceneId);
  if (!scene) return { film, coverage: null };
  const result = await repairDirectorCoverage(
    scene,
    film.shots.filter((shot) => shot.sceneId === sceneId),
    request,
    current,
  );
  if (!current()) return { film, coverage: result.coverage };
  return {
    film: {
      ...film,
      scenes: film.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, coverage: result.coverage } : scene,
      ),
      shots: [...film.shots.filter((shot) => shot.sceneId !== sceneId), ...result.shots].sort(
        (a, b) =>
          film.scenes.findIndex((scene) => scene.id === a.sceneId) -
            film.scenes.findIndex((scene) => scene.id === b.sceneId) || a.no - b.no,
      ),
    },
    coverage: result.coverage,
  };
}

export class RequestSequences {
  private versions = new Map<string, number>();
  begin(projectId: string, stage: string, activeProject: () => string) {
    const key = `${projectId}:${stage}`;
    const version = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, version);
    return () => activeProject() === projectId && this.versions.get(key) === version;
  }
}

/** Coverage is evaluated on the saved result, including preserved manual edits. */
export function applyDirectorPlan(
  film: FilmProject,
  shots: FilmShot[],
  sceneId: string,
  unassigned: NonNullable<FilmProject["unassignedBeats"]> = [],
): FilmProject {
  const next = applyShots(film, shots, sceneId);
  return {
    ...next,
    unassignedBeats: [
      ...(film.unassignedBeats ?? []).filter((item) => item.sceneId !== sceneId),
      ...unassigned.filter((item) => item.sceneId === sceneId),
    ],
    scenes: next.scenes.map((scene) =>
      scene.id === sceneId
        ? { ...scene, coverage: detectDirectorCoverage(scene, next.shots) }
        : scene,
    ),
  };
}
