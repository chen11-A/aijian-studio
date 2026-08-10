import type { components } from "@aijian/contracts";

import { hasOnlyKeys, hasRequestId, isRecord } from "./api-contract-guards";

export type TimelineResponse = components["schemas"]["TimelineResponse"];
export type TrimTimelineClipInput = components["schemas"]["TrimTimelineClipRequest"];
export type ReorderTimelineClipInput = components["schemas"]["ReorderTimelineClipRequest"];
export type ReplaceTimelineClipInput = components["schemas"]["ReplaceTimelineClipRequest"];

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const TIMELINE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function isSafeInteger(value: unknown, minimum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function isTimebase(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["frame_rate", "timecode_mode"])) return false;
  if (!isRecord(value.frame_rate) || !hasOnlyKeys(value.frame_rate, ["num", "den"])) return false;
  const pair = `${String(value.frame_rate.num)}/${String(value.frame_rate.den)}`;
  return (
    ["24000/1001", "24/1", "25/1", "30000/1001"].includes(pair) &&
    (value.timecode_mode === "NON_DROP_FRAME" ||
      (pair === "30000/1001" && value.timecode_mode === "DROP_FRAME"))
  );
}

function sameTimebase(left: unknown, right: unknown): boolean {
  if (!isTimebase(left) || !isTimebase(right) || !isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftRate = left.frame_rate as Record<string, unknown>;
  const rightRate = right.frame_rate as Record<string, unknown>;
  return (
    left.timecode_mode === right.timecode_mode &&
    leftRate.num === rightRate.num &&
    leftRate.den === rightRate.den
  );
}

function isProxy(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "schema_version",
      "proxy_asset_sha256",
      "editable_frame_count",
      "sequence_timebase",
      "mapping_schema_version",
    ]) &&
    value.schema_version === 1 &&
    value.mapping_schema_version === 1 &&
    typeof value.proxy_asset_sha256 === "string" &&
    CONTENT_HASH.test(value.proxy_asset_sha256) &&
    isSafeInteger(value.editable_frame_count, 1) &&
    isTimebase(value.sequence_timebase)
  );
}

function isAsset(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "schema_version",
      "asset_id",
      "source_asset_sha256",
      "source_frame_count",
      "proxy",
    ]) &&
    value.schema_version === 1 &&
    typeof value.asset_id === "string" &&
    TIMELINE_ID.test(value.asset_id) &&
    typeof value.source_asset_sha256 === "string" &&
    CONTENT_HASH.test(value.source_asset_sha256) &&
    isSafeInteger(value.source_frame_count, 1) &&
    (value.proxy === undefined || value.proxy === null || isProxy(value.proxy))
  );
}

function isClip(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "schema_version",
      "clip_id",
      "asset_id",
      "source_in_frame",
      "duration_frames",
    ]) &&
    value.schema_version === 1 &&
    typeof value.clip_id === "string" &&
    TIMELINE_ID.test(value.clip_id) &&
    typeof value.asset_id === "string" &&
    TIMELINE_ID.test(value.asset_id) &&
    isSafeInteger(value.source_in_frame, 0) &&
    isSafeInteger(value.duration_frames, 1)
  );
}

export function isTimelineResponse(
  value: unknown,
  expectedProjectId: string,
): value is TimelineResponse {
  if (
    !PROJECT_ID.test(expectedProjectId) ||
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "project_id",
      "version_id",
      "content_hash",
      "created_at",
      "total_duration_frames",
      "timeline",
    ]) ||
    value.data.project_id !== expectedProjectId ||
    typeof value.data.version_id !== "string" ||
    !VERSION_ID.test(value.data.version_id) ||
    typeof value.data.content_hash !== "string" ||
    !CONTENT_HASH.test(value.data.content_hash) ||
    typeof value.data.created_at !== "string" ||
    !isSafeInteger(value.data.total_duration_frames, 1) ||
    !isRecord(value.data.timeline)
  ) {
    return false;
  }
  const timeline = value.data.timeline;
  if (
    !hasOnlyKeys(timeline, [
      "schema_version",
      "timeline_id",
      "revision",
      "sequence_timebase",
      "width",
      "height",
      "assets",
      "clips",
    ]) ||
    timeline.schema_version !== 1 ||
    typeof timeline.timeline_id !== "string" ||
    !TIMELINE_ID.test(timeline.timeline_id) ||
    !isSafeInteger(timeline.revision, 1) ||
    !isTimebase(timeline.sequence_timebase) ||
    timeline.width !== 1080 ||
    timeline.height !== 1920 ||
    !Array.isArray(timeline.assets) ||
    timeline.assets.length < 1 ||
    !timeline.assets.every(isAsset) ||
    !Array.isArray(timeline.clips) ||
    timeline.clips.length < 1 ||
    !timeline.clips.every(isClip)
  ) {
    return false;
  }
  const assets = new Map(
    timeline.assets.map((asset) => [
      asset.asset_id,
      asset.proxy?.editable_frame_count ?? asset.source_frame_count,
    ]),
  );
  const assetIds = timeline.assets.map((asset) => asset.asset_id);
  const clipIds = timeline.clips.map((clip) => clip.clip_id);
  return (
    new Set(assetIds).size === assetIds.length &&
    new Set(clipIds).size === clipIds.length &&
    timeline.assets.every(
      (asset) =>
        asset.proxy === undefined ||
        asset.proxy === null ||
        sameTimebase(asset.proxy.sequence_timebase, timeline.sequence_timebase),
    ) &&
    timeline.clips.every((clip) => {
      const frameCount = assets.get(clip.asset_id);
      return frameCount !== undefined && clip.source_in_frame + clip.duration_frames <= frameCount;
    }) &&
    timeline.clips.reduce((total, clip) => total + clip.duration_frames, 0) ===
      value.data.total_duration_frames
  );
}

export function isTrimTimelineClipInput(value: unknown): value is TrimTimelineClipInput {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "clip_id",
      "new_source_in_frame",
      "new_duration_frames",
      "expected_revision",
    ]) &&
    typeof value.clip_id === "string" &&
    TIMELINE_ID.test(value.clip_id) &&
    isSafeInteger(value.new_source_in_frame, 0) &&
    isSafeInteger(value.new_duration_frames, 1) &&
    isSafeInteger(value.expected_revision, 1)
  );
}

export function isReorderTimelineClipInput(value: unknown): value is ReorderTimelineClipInput {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["clip_id", "new_index", "expected_revision"]) &&
    typeof value.clip_id === "string" &&
    TIMELINE_ID.test(value.clip_id) &&
    isSafeInteger(value.new_index, 0) &&
    isSafeInteger(value.expected_revision, 1)
  );
}

export function isReplaceTimelineClipInput(value: unknown): value is ReplaceTimelineClipInput {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "clip_id",
      "replacement_asset_id",
      "replacement_source_in_frame",
      "expected_revision",
    ]) &&
    typeof value.clip_id === "string" &&
    TIMELINE_ID.test(value.clip_id) &&
    typeof value.replacement_asset_id === "string" &&
    TIMELINE_ID.test(value.replacement_asset_id) &&
    isSafeInteger(value.replacement_source_in_frame, 0) &&
    isSafeInteger(value.expected_revision, 1)
  );
}
