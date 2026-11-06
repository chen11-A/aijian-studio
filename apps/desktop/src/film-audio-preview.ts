import type { AudioMixPreviewGateway } from "@aijian/contracts/film-audio-mix";
import { filmHistoryRecordHash } from "./film-history";
import { readProject, mediaUrlPath } from "./film-library";
import { resolveAudioMix } from "./film-audio-mix-sources";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function createFilmAudioPreview(host: {
  filmsRoot: string;
  storyFilmsRoot: string;
  tools: () => Promise<QcTools>;
  run: QcRunner;
  audioOwner?: Parameters<typeof resolveAudioMix>[2]["audioOwner"];
  videoOwner?: Parameters<typeof resolveAudioMix>[2]["videoOwner"];
}): AudioMixPreviewGateway["getFilmAudioMixPreview"] {
  const active = new Set<string>();
  return async (input) => {
    if (
      !input ||
      Object.keys(input).sort().join() !== "expectedHash,projectId" ||
      !/^film_[a-z0-9]{16,40}$/.test(input.projectId) ||
      !/^[a-f0-9]{64}$/.test(input.expectedHash)
    )
      return { kind: "FAILED", code: "PROJECT_CHANGED" };
    if (active.has(input.projectId)) return { kind: "FAILED", code: "BUSY" };
    active.add(input.projectId);
    try {
      const record = await readProject(host.filmsRoot, input.projectId);
      if (
        !record ||
        record.id !== input.projectId ||
        filmHistoryRecordHash(record) !== input.expectedHash ||
        !Array.isArray(record.shots)
      )
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      const shots = record.shots.map(obj);
      if (new Set(shots.map((row) => row.id)).size !== shots.length)
        throw new Error("PROJECT_CHANGED");
      const tools = await host.tools().catch(() => {
        throw new Error("TOOLS_UNAVAILABLE");
      });
      const selection = [];
      for (const shot of shots) {
        const takes = Array.isArray(shot.takes) ? shot.takes.map(obj) : [];
        if (new Set(takes.map((row) => row.id)).size !== takes.length)
          throw new Error("PROJECT_CHANGED");
        const take = shot.selectedTakeId
          ? takes.find((row) => row.id === shot.selectedTakeId)
          : takes.find((row) => row.status === "done" && row.videoPath);
        if (
          !take ||
          take.status !== "done" ||
          typeof take.videoPath !== "string" ||
          take.shotId !== shot.id ||
          typeof take.id !== "string" ||
          typeof shot.id !== "string"
        )
          continue;
        selection.push({
          shotId: shot.id,
          takeId: take.id,
          videoPath: mediaUrlPath(take.videoPath),
          visualPath:
            typeof take.cleanVideoPath === "string" && take.cleanVideoPath
              ? mediaUrlPath(take.cleanVideoPath)
              : mediaUrlPath(take.videoPath),
        });
      }
      if (!selection.length) throw new Error("PROJECT_CHANGED");
      const actual = await resolveAudioMix(record, selection, { ...host, tools });
      const latest = await readProject(host.filmsRoot, input.projectId);
      if (!latest || filmHistoryRecordHash(latest) !== input.expectedHash)
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      return {
        kind: "READY",
        plan: actual.plan,
        sourcePaths: actual.paths,
        sourceSha256: Object.fromEntries(
          Object.entries(actual.paths).map(([key, path]) => [key, actual.hashes[path]!]),
        ),
        sourceInfo: actual.sources,
        fingerprint: JSON.stringify(actual.hashes),
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return {
        kind: "FAILED",
        code:
          code === "TOOLS_UNAVAILABLE"
            ? code
            : code === "PROJECT_CHANGED"
              ? code
              : "SOURCE_UNVERIFIED",
      };
    } finally {
      active.delete(input.projectId);
    }
  };
}
