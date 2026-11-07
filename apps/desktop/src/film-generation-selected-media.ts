import type { CanonicalGenerationProducer } from "./film-generation-compiler";
import { generationRows } from "./film-generation-plan";
import { resolveAudioMix } from "./film-audio-mix-sources";
import type { FilmRecord } from "./film-library";
import type { QcRunner } from "./film-export-qc-runtime";

export type GenerationSelectedMedia = {
  shotId: string;
  takeId: string;
  /** Private canonical role identities; never returned as renderer authorization. */
  native: { path: string; sha256: string; durationSeconds: number };
  visual: { path: string; sha256: string; durationSeconds: number };
  verification: "OWNED_STREAM_AND_SHA";
};
const fail = (): never => {
  throw Error("SOURCE_UNVERIFIABLE");
};

/** Original pipeline selection + original native/clean root/owner/SHA resolver.
 * This is local readable stream evidence, NOT provider success, cache eligibility,
 * human acceptance or a release of an UNKNOWN failure reservation. */
export async function generationSelectedMedia(
  producer: Pick<CanonicalGenerationProducer, "pipelineSelectedVideo">,
  record: FilmRecord,
  shotIds: readonly string[],
  host: Parameters<typeof resolveAudioMix>[2],
): Promise<{
  pendingShotIds: ReadonlySet<string>;
  selected: readonly GenerationSelectedMedia[];
  verify: (canonical: FilmRecord) => Promise<void>;
}> {
  if (!shotIds.length || shotIds.length > 256 || new Set(shotIds).size !== shotIds.length)
    return fail();
  const requested = [...shotIds];
  const scope = {
    id: record.id,
    seriesId: record.seriesId,
    backendProjectId: record.backendProjectId,
  };
  const inspect = async (canonical: FilmRecord) => {
    if (
      canonical.id !== scope.id ||
      canonical.seriesId !== scope.seriesId ||
      canonical.backendProjectId !== scope.backendProjectId
    )
      return fail();
    const shots = generationRows(canonical.shots);
    const selected: GenerationSelectedMedia[] = [];
    const pending = new Set<string>();
    for (const shotId of requested) {
      const shot = shots.find((row) => row.id === shotId);
      if (!shot) return fail();
      const takes = generationRows(shot.takes);
      if (
        shot.selectedTakeId &&
        (typeof shot.selectedTakeId !== "string" ||
          !takes.some((take) => take.id === shot.selectedTakeId))
      )
        return fail();
      const nativeReference = producer.pipelineSelectedVideo(shot);
      if (!nativeReference) {
        // No selected completed media is a planned generation target. Ambiguous or
        // syntactically invalid completed media is not silently called "missing".
        const completed = takes.filter((take) => take.status === "done" && take.videoPath);
        if (
          completed.length &&
          (!shot.selectedTakeId || completed.some((take) => take.id === shot.selectedTakeId))
        )
          return fail();
        pending.add(shotId);
        continue;
      }
      const current = shot.selectedTakeId
        ? takes.find((take) => take.id === shot.selectedTakeId)
        : takes.filter((take) => take.status === "done" && take.videoPath).length === 1
          ? takes.find((take) => take.status === "done" && take.videoPath)
          : undefined;
      if (
        !current ||
        current.status !== "done" ||
        current.videoPath !== nativeReference ||
        typeof current.id !== "string"
      )
        return fail();
      const clocks = new Map<string, number>();
      const run: QcRunner = async (binary, args, options) => {
        const result = await host.run(binary, args, options);
        if (binary === host.tools.ffprobePath) {
          const payload = JSON.parse(result.stdout);
          const video = Array.isArray(payload.streams)
            ? payload.streams.find((row: { codec_type?: unknown }) => row?.codec_type === "video")
            : undefined;
          const seconds = Number(video?.duration);
          // The longest audio/format duration is not proof of a video clock.
          if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 36000) return fail();
          clocks.set(args.at(-1)!, seconds);
        }
        return result;
      };
      const resolved = await resolveAudioMix(
        { ...canonical, audioClips: [], audioMix: undefined },
        [
          {
            shotId,
            takeId: current.id,
            videoPath: nativeReference,
            ...(typeof current.cleanVideoPath === "string" && current.cleanVideoPath
              ? { visualPath: current.cleanVideoPath }
              : {}),
          },
        ],
        { ...host, run },
      );
      const source = resolved.selectedSources[0];
      if (
        !source ||
        resolved.selectedSources.length !== 1 ||
        source.shotId !== shotId ||
        source.takeId !== current.id
      )
        return fail();
      const nativeSeconds = clocks.get(source.native.path),
        visualSeconds = clocks.get(source.visual.path);
      if (nativeSeconds === undefined || visualSeconds === undefined) return fail();
      selected.push({
        shotId,
        takeId: current.id,
        native: { ...source.native, durationSeconds: nativeSeconds },
        visual: { ...source.visual, durationSeconds: visualSeconds },
        verification: "OWNED_STREAM_AND_SHA",
      });
    }
    return { selected, pending };
  };
  const initial = await inspect(record).catch(() => fail());
  const bound = JSON.stringify({ selected: initial.selected, pending: [...initial.pending] });
  return {
    pendingShotIds: new Set(initial.pending),
    selected: structuredClone(initial.selected),
    async verify(canonical) {
      const latest = await inspect(canonical).catch(() => fail());
      if (JSON.stringify({ selected: latest.selected, pending: [...latest.pending] }) !== bound)
        return fail();
    },
  };
}
