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

export type DirectorRepairResult = {
  shots: FilmShot[];
  coverage: DirectorCoverage;
  repaired: boolean;
};
export type RepairRequest = (context: string, instruction: string) => Promise<AgentReply>;

/** One repair attempt; a failed or lossy answer never replaces the existing plan. */
export async function repairDirectorCoverage(
  scene: Pick<FilmScene, "id" | "text" | "title" | "where">,
  shots: FilmShot[],
  request: RepairRequest,
  current: () => boolean = () => true,
): Promise<DirectorRepairResult> {
  const coverage = detectDirectorCoverage(scene, shots);
  if (coverage.ok || !current()) return { shots, coverage, repaired: false };
  try {
    const reply = await request(
      coverageRepairContext(scene, shots),
      "只补这一场缺失台词与结尾，返回按原文顺序的完整镜头；合并节拍，绝不截断。",
    );
    if (!current() || !reply.text) return { shots, coverage, repaired: false };
    const parsed = parseDirectorShots(reply.text, scene.id, scene.text, [scene]);
    if (!parsed) return { shots, coverage, repaired: false };
    const repairedCoverage = detectDirectorCoverage(scene, parsed);
    const containsInOrder = (expected: string[], actual: string) => {
      let cursor = 0;
      return expected.filter(Boolean).every((text) => {
        const index = actual.indexOf(text, cursor);
        if (index < 0) return false;
        cursor = index + text.length;
        return true;
      });
    };
    const losesShotContent =
      (["picture", "action"] as const).some(
        (field) =>
          !containsInOrder(
            shots.map((shot) => shot[field]),
            parsed.map((shot) => shot[field]).join("\n"),
          ),
      ) ||
      !containsInOrder(
        shots.flatMap(shotLines).map((line) => line.text),
        parsed
          .flatMap(shotLines)
          .map((line) => line.text)
          .join("\n"),
      );
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
      a.action === b.action &&
      JSON.stringify(shotLines(a)) === JSON.stringify(shotLines(b));
    const protectedShot = (shot: FilmShot) =>
      shot.userFields.length || shot.poster || shot.stills.length || shot.takes.length;
    if (
      shots.some(
        (shot) => protectedShot(shot) && !parsed.some((candidate) => sameContent(shot, candidate)),
      )
    )
      return { shots, coverage, repaired: false };
    const used = new Set<string>();
    const restored = parsed.map((candidate, index) => {
      const original = shots.find((shot) => !used.has(shot.id) && sameContent(shot, candidate));
      const id = original?.id ?? `${scene.id}-repair-${crypto.randomUUID()}`;
      used.add(id);
      return { ...(original ?? candidate), id, no: index + 1 };
    });
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
