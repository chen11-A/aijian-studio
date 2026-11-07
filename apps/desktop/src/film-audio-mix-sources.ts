import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  audioMixSettings,
  buildAudioMixPlan,
  audioMixEnvelope,
} from "@aijian/contracts/film-audio-mix-plan";
import type {
  AudioMixPlan,
  MixClip,
  MixShot,
  MixSourceInfo,
} from "@aijian/contracts/film-audio-mix";
import type { FilmRecord } from "./film-library";
import { mediaUrlPath, trustedMediaPath } from "./film-library";
import { exportFileHash } from "./film-export-io";
import { probeMixSource } from "./film-audio-mix";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== "" && !part.startsWith("..") && !isAbsolute(part);
};
export type MixSelection = {
  shotId: string;
  takeId: string;
  videoPath: string;
  visualPath?: string;
  durationSeconds?: number;
};
export async function resolveAudioMix(
  record: FilmRecord,
  selection: MixSelection[],
  host: {
    filmsRoot: string;
    storyFilmsRoot: string;
    tools: QcTools;
    run: QcRunner;
    signal?: AbortSignal;
    videoOwner?: (projectId: string, path: string, sha: string) => Promise<boolean>;
    audioOwner?: (
      projectId: string,
      path: string,
      sha: string,
      selected?: { path: string; sha: string },
    ) => Promise<boolean>;
  },
): Promise<{
  plan: AudioMixPlan;
  paths: Record<string, string>;
  hashes: Record<string, string>;
  sources: Record<string, MixSourceInfo>;
}> {
  const root = await realpath(host.filmsRoot),
    series = await realpath(join(root, record.seriesId));
  if (relative(root, series) !== record.seriesId) throw new Error("SOURCE_UNVERIFIED");
  const episode = await realpath(join(series, "episodes", record.id));
  if (relative(series, episode) !== join("episodes", record.id))
    throw new Error("SOURCE_UNVERIFIED");
  const localRoots = [];
  for (const [parent, name] of [
    [series, "media"],
    [episode, "media"],
  ]) {
    const path = await realpath(join(parent!, name!)).catch(() => "");
    if (path && relative(parent!, path) === name) localRoots.push(path);
  }
  const nativeRoots = [episode, ...localRoots];
  const story = await realpath(host.storyFilmsRoot).catch(() => "");
  const paths: Record<string, string> = {},
    hashes: Record<string, string> = {},
    sources: Record<string, MixSourceInfo> = {};
  // Scope-local reuse only, after every caller's own root/owner/SHA validation.
  const probes = new Map<string, Awaited<ReturnType<typeof probeMixSource>>>();
  const sourceKeys = new Map<string, string>();
  const identity = (path: string, sha: string) => JSON.stringify([path, sha]);
  const probeOnce = async (path: string, sha: string) => {
    if (hashes[path] && hashes[path] !== sha) throw new Error("SOURCE_CHANGED");
    hashes[path] = sha;
    const key = identity(path, sha);
    const cached = probes.get(key);
    if (cached) {
      if ((await exportFileHash(path, host.signal)) !== sha) throw new Error("SOURCE_CHANGED");
      return cached;
    }
    const info = await probeMixSource(path, host.tools, host.run, host.signal);
    // A probe may race replacement; do not cache data for unverified bytes.
    if ((await exportFileHash(path, host.signal)) !== sha) throw new Error("SOURCE_CHANGED");
    probes.set(key, info);
    return info;
  };
  const shots: MixShot[] = [],
    originals = new Map<string, { path: string; sha: string }>();
  let at = 0;
  for (const chosen of selection) {
    const shot = (Array.isArray(record.shots) ? record.shots : [])
      .map(obj)
      .find((row) => row.id === chosen.shotId);
    if (!shot) throw new Error("PROJECT_CHANGED");
    const nativeSourceKey = `video:${chosen.shotId}:${chosen.takeId}`;
    const path = trustedMediaPath(
        [...nativeRoots, ...(story ? [story] : [])],
        mediaUrlPath(chosen.videoPath),
      ),
      hash = await exportFileHash(path, host.signal);
    if (
      !nativeRoots.some((root) => inside(root, path)) &&
      !(
        story &&
        inside(story, path) &&
        host.videoOwner &&
        (await host.videoOwner(text(record.backendProjectId), path, hash))
      )
    )
      throw new Error("SOURCE_UNVERIFIED");
    paths[nativeSourceKey] = path;
    originals.set(chosen.shotId, { path, sha: hash });
    const nativeInfo = await probeOnce(path, hash);
    if (!sourceKeys.has(identity(path, hash)))
      sourceKeys.set(identity(path, hash), nativeSourceKey);
    sources[nativeSourceKey] = nativeInfo;
    let visualInfo = nativeInfo;
    if (chosen.visualPath && chosen.visualPath !== chosen.videoPath) {
      const visual = trustedMediaPath(
        [...nativeRoots, ...(story ? [story] : [])],
        mediaUrlPath(chosen.visualPath),
      );
      const visualHash = await exportFileHash(visual, host.signal);
      if (
        !nativeRoots.some((root) => inside(root, visual)) &&
        !(
          story &&
          inside(story, visual) &&
          host.videoOwner &&
          (await host.videoOwner(text(record.backendProjectId), visual, visualHash))
        )
      )
        throw new Error("SOURCE_UNVERIFIED");
      visualInfo = await probeOnce(visual, visualHash);
    }
    const durationSeconds = visualInfo.videoDurationSeconds;
    if (!(durationSeconds > 0)) throw new Error("INVALID_AUDIO_SOURCE");
    const hasLine =
      (Array.isArray(shot.lines) && shot.lines.some((row) => text(obj(row).text).trim())) ||
      text(shot.line).trim();
    shots.push({
      shotId: chosen.shotId,
      takeId: chosen.takeId,
      nativeSourceKey,
      startSeconds: at,
      durationSeconds,
      hasDialogue: hasLine
        ? true
        : typeof shot.line === "string" || Array.isArray(shot.lines)
          ? false
          : null,
    });
    at += durationSeconds;
  }
  const settings = audioMixSettings(record.audioMix);
  const clips: MixClip[] = [];
  for (const raw of Array.isArray(record.audioClips) ? record.audioClips : []) {
    const clip = obj(raw);
    if (clip.enabled === false) continue;
    if (!text(clip.path)) continue;
    const shotId = text(clip.shotId),
      takeId = text(clip.takeId),
      selected = selection.find((row) => row.shotId === shotId);
    if (shotId && (!selected || !takeId || takeId !== selected.takeId)) {
      clips.push({
        ...clip,
        id: text(clip.id),
        lane: clip.lane,
        shotId,
        takeId,
        sourceKey: `stale:${text(clip.id)}`,
      } as MixClip);
      continue;
    }
    if (!shotId && takeId) continue;
    const lane = text(clip.lane) as MixClip["lane"];
    if (settings.lanes[lane]?.muted || (typeof clip.gainDb === "number" && clip.gainDb <= -40)) {
      clips.push({
        ...clip,
        id: text(clip.id),
        lane,
        shotId,
        takeId,
        label: text(clip.label),
        sourceKey:
          clip.label === "原声" && selected
            ? `video:${shotId}:${takeId}`
            : `muted:${text(clip.id)}`,
      } as MixClip);
      continue;
    }
    const nativeControl = clip.label === "原声" && lane === "dialogue" && selected;
    const allowed = nativeControl ? nativeRoots : localRoots;
    let path = trustedMediaPath(
      [...allowed, ...(story ? [story] : [])],
      mediaUrlPath(text(clip.path)),
    );
    path = await realpath(path);
    const hash = await exportFileHash(path, host.signal);
    if (
      !allowed.some((root) => inside(root, path)) &&
      !(
        story &&
        inside(story, path) &&
        host.audioOwner &&
        (await host.audioOwner(
          text(record.backendProjectId),
          path,
          hash,
          shotId ? originals.get(shotId) : undefined,
        ))
      )
    )
      throw new Error("SOURCE_UNVERIFIED");
    let sourceKey = `audio:${text(clip.id)}`;
    if (clip.label === "原声" && clip.lane === "dialogue" && selected) {
      const original = originals.get(shotId)!;
      if (path !== original.path || hash !== original.sha) throw new Error("SOURCE_UNVERIFIED");
      sourceKey = `video:${shotId}:${takeId}`;
    }
    sourceKey = sourceKeys.get(identity(path, hash)) ?? sourceKey;
    sourceKeys.set(identity(path, hash), sourceKey);
    paths[sourceKey] = path;
    sources[sourceKey] = await probeOnce(path, hash);
    clips.push({
      id: text(clip.id),
      sourceKey,
      lane: clip.lane as MixClip["lane"],
      shotId,
      takeId,
      label: text(clip.label),
      startSeconds: clip.startSeconds as number,
      durationSeconds: clip.durationSeconds as number,
      offsetSeconds: clip.offsetSeconds as number,
      gainDb: clip.gainDb as number,
      ...(clip.loop !== undefined ? { loop: clip.loop as boolean } : {}),
      ...(clip.enabled !== undefined ? { enabled: clip.enabled as boolean } : {}),
      ...(clip.envelope !== undefined ? { envelope: audioMixEnvelope(clip.envelope) } : {}),
    });
  }
  const plan = buildAudioMixPlan({
    projectId: record.id,
    durationSeconds: at,
    shots,
    clips,
    sources,
    controls: { lanes: settings.lanes },
  });
  if (plan.tracks.length > 128) throw new Error("AUDIO_MIX_LIMIT");
  if (plan.limitations.some((code) => code === "INVALID_CLIP" || code === "SOURCE_UNAVAILABLE"))
    throw new Error("INVALID_AUDIO_PLAN");
  return { plan, paths, hashes, sources };
}
