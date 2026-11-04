import { visualJson } from "@aijian/contracts/visual-bible";
import { validStoryboardVersion, type StoryboardVersion } from "./episodeStoryboard";
import {
  parseAssemblyReceipt,
  type AssemblyVersion,
  type EpisodeMediaAssemblyGateway,
} from "./episodeMediaAssembly";

const REQUEST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Same bounded canonical content used by immutable local artifact versions. */
export async function storyboardPreviewContentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(visualJson(value));
  if (bytes.length > 2_000_000) throw new Error("Preview source exceeds artifact bound");
  const digest = await window.crypto.subtle.digest("SHA-256", bytes.buffer);
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export type StoryboardAssemblyRead =
  { kind: "FOUND"; assembly: AssemblyVersion } | { kind: "EMPTY" } | { kind: "UNKNOWN" };

/** Explicit latest lookup selects one frozen assembly; no write or version fallback. */
export async function readStoryboardAssembly(
  gateway: Pick<EpisodeMediaAssemblyGateway, "readLatest">,
  storyboard: StoryboardVersion,
): Promise<StoryboardAssemblyRead> {
  try {
    const source = structuredClone(storyboard);
    const { project_id: projectId, episode_id: episodeId } = source;
    if (
      !validStoryboardVersion(source, projectId, episodeId) ||
      (await storyboardPreviewContentHash(source.content)) !== source.content_hash
    )
      return { kind: "UNKNOWN" };
    const result = structuredClone(await gateway.readLatest(projectId, episodeId));
    if (result.kind === "NOT_FOUND")
      return REQUEST.test(result.request_id) ? { kind: "EMPTY" } : { kind: "UNKNOWN" };
    if (result.kind !== "FOUND" || !REQUEST.test(result.receipt.request_id))
      return { kind: "UNKNOWN" };
    const assembly = parseAssemblyReceipt(result.receipt, projectId, episodeId);
    if (
      !assembly ||
      (await storyboardPreviewContentHash(assembly.content)) !== assembly.content_hash
    )
      return { kind: "UNKNOWN" };
    return { kind: "FOUND", assembly };
  } catch {
    return { kind: "UNKNOWN" };
  }
}

export function storyboardAssemblyLinks(storyboard: StoryboardVersion, assembly: AssemblyVersion) {
  const shots = storyboard.content.shots.map((shot) => {
    const segments = assembly.content.visual_segments.filter(
      (segment) =>
        segment.storyboard_ref?.storyboard_version_id === storyboard.version_id &&
        segment.storyboard_ref.shot_id === shot.shot_id,
    );
    const frames = segments.reduce(
      (sum, segment) => sum + segment.end_frame - segment.start_frame,
      0,
    );
    const rate = assembly.content.sequence_timebase.frame_rate;
    return {
      shot,
      segments,
      durationMatches:
        segments.length > 0 &&
        BigInt(frames) * BigInt(rate.den) * BigInt(storyboard.content.fps) ===
          BigInt(shot.duration_frames) * BigInt(rate.num),
    };
  });
  const ids = new Set(shots.map(({ shot }) => shot.shot_id));
  const unmatched = assembly.content.visual_segments.filter(
    (segment) =>
      segment.storyboard_ref?.storyboard_version_id !== storyboard.version_id ||
      !ids.has(segment.storyboard_ref.shot_id),
  );
  const order = assembly.content.visual_segments
    .map((segment) => segment.storyboard_ref?.shot_id)
    .filter((id, i, all) => i === 0 || id !== all[i - 1]);
  return {
    shots,
    unmatched,
    linked: shots.filter((item) => item.segments.length > 0).length,
    orderMatches:
      order.length === shots.length && order.every((id, i) => id === shots[i]?.shot.shot_id),
    canPreview:
      shots.length > 0 && unmatched.length === 0 && shots.every((item) => item.segments.length > 0),
  };
}
