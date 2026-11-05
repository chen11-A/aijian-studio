import { detectDirectorCoverage } from "./director-continuity";
import { assignActionBeats, splitNovel } from "./operations";
import { actionFromModel, parseLooseJson } from "./phase2";
import { parseDirectorShots } from "./project";

export const REPLAY_SOURCE_SHA256 =
  "acaba10e8752d4730be1391682a3bbc77e6fd37308e545303dba951c28f31b9e";

/** A declaration is provenance supplied by the caller, never proof of a real provider capture. */
export type ReplayManifest = {
  sourceSha256: string;
  captureDeclaration: "real-capture" | "synthetic";
  scenes: { sceneNo: 1 | 2; directorReply: string; actionReply?: string }[];
};

export function parseReplayManifest(value: unknown): ReplayManifest {
  if (!value || typeof value !== "object") throw new Error("REPLAY_MANIFEST_REQUIRED");
  const item = value as Partial<ReplayManifest>;
  if (item.sourceSha256 !== REPLAY_SOURCE_SHA256) throw new Error("REPLAY_SOURCE_HASH_MISMATCH");
  if (!["real-capture", "synthetic"].includes(item.captureDeclaration ?? ""))
    throw new Error("REPLAY_DECLARATION_REQUIRED");
  if (!Array.isArray(item.scenes) || item.scenes.length !== 2)
    throw new Error("REPLAY_BOTH_SCENES_REQUIRED");
  const seen = new Set<number>();
  for (const scene of item.scenes) {
    if (!scene || ![1, 2].includes(scene.sceneNo) || seen.has(scene.sceneNo))
      throw new Error("REPLAY_BOTH_SCENES_REQUIRED");
    seen.add(scene.sceneNo);
    if (typeof scene.directorReply !== "string" || !scene.directorReply.trim())
      throw new Error("REPLAY_DIRECTOR_CAPTURE_REQUIRED");
    if (scene.actionReply !== undefined && typeof scene.actionReply !== "string")
      throw new Error("REPLAY_ACTION_CAPTURE_INVALID");
    if (scene.sceneNo === 2 && !scene.actionReply?.trim())
      throw new Error("REPLAY_SECOND_ACTION_CAPTURE_REQUIRED");
  }
  return item as ReplayManifest;
}

/** actualSourceSha256 must be computed from the same source bytes by the file boundary. */
export function replay3jr(source: string, manifest: unknown, actualSourceSha256: string) {
  const capture = parseReplayManifest(manifest);
  if (actualSourceSha256 !== REPLAY_SOURCE_SHA256) throw new Error("REPLAY_SOURCE_HASH_MISMATCH");
  const sourceScenes = splitNovel(source).scenes;
  if (sourceScenes.length < 2) throw new Error("REPLAY_SOURCE_SCENES_MISSING");
  const scenes = [...capture.scenes]
    .sort((a, b) => a.sceneNo - b.sceneNo)
    .map((input) => {
      const scene = sourceScenes[input.sceneNo - 1]!;
      const decoded = parseLooseJson(input.directorReply);
      if (!decoded || typeof decoded !== "object") throw new Error("REPLAY_DIRECTOR_UNSUPPORTED");
      // Flatten only the declared scene's blocks so preserveSource=false really counts raw shots;
      // the production wrapper path completes coverage even when preserveSource is false.
      const wrapped = decoded as { shots?: unknown; scenes?: unknown };
      const blocks =
        Array.isArray(wrapped.scenes) && !Array.isArray(wrapped.shots) ? wrapped.scenes : [decoded];
      const raw = blocks.flatMap((block) => {
        if (
          !block ||
          typeof block !== "object" ||
          !Array.isArray((block as { shots?: unknown }).shots)
        )
          throw new Error("REPLAY_DIRECTOR_UNSUPPORTED");
        const rawRows = (block as { shots: unknown[] }).shots;
        const parsed = parseDirectorShots(
          JSON.stringify(block),
          scene.id,
          scene.text,
          [scene],
          false,
        );
        if (!parsed?.length || parsed.length !== rawRows.length)
          throw new Error("REPLAY_DIRECTOR_UNSUPPORTED");
        return parsed;
      });
      const shots = parseDirectorShots(input.directorReply, scene.id, scene.text, [scene]);
      if (!shots?.length || shots.some((shot) => shot.sceneId !== scene.id))
        throw new Error("REPLAY_DIRECTOR_UNSUPPORTED");
      const coverage = detectDirectorCoverage(scene, shots);
      const lastDialogueCovered =
        Boolean(coverage.lastLine) && !coverage.missingLines.includes(coverage.lastLine);
      let actions = null;
      if (input.actionReply) {
        const actionValue = parseLooseJson(input.actionReply);
        const beats = actionFromModel(actionValue);
        const rawBeats =
          actionValue && typeof actionValue === "object" && "beats" in actionValue
            ? actionValue.beats
            : undefined;
        if (Array.isArray(rawBeats) && rawBeats.length !== beats?.length)
          throw new Error("REPLAY_ACTION_UNSUPPORTED");
        if (!beats?.length) throw new Error("REPLAY_ACTION_UNSUPPORTED");
        const assigned = assignActionBeats(shots, scene.id, beats, scene.text, scene);
        actions = {
          input: beats.length,
          assigned: beats.length - assigned.unassignedBeats.length,
          unassigned: assigned.unassignedBeats.length,
        };
      }
      const checks = {
        shotLimit: shots.length <= 16,
        coverage: coverage.ok,
        lastDialogueCovered,
        tailCovered: coverage.missingTail === null,
        actionAcceptance:
          input.sceneNo !== 2 ||
          Boolean(
            actions && actions.input === 19 && actions.assigned >= 17 && actions.unassigned <= 2,
          ),
      };
      return {
        sceneNo: input.sceneNo,
        rawShotCount: raw.length,
        shotCount: shots.length,
        coverage: {
          ok: coverage.ok,
          missingLineCount: coverage.missingLines.length,
          lastDialogueCovered,
          tailCovered: coverage.missingTail === null,
        },
        actions,
        checks,
        checksPassed: Object.values(checks).every(Boolean),
      };
    });
  return {
    schemaVersion: 1,
    sourceSha256: actualSourceSha256,
    captureDeclaration: capture.captureDeclaration,
    provenance: "caller-declared-not-authenticated",
    scenes,
    checksPassed: scenes.every((scene) => scene.checksPassed),
  };
}
