import { createHash } from "node:crypto";
import { visualJson } from "@aijian/contracts/visual-bible";
import {
  nativePreviewPlanResponse,
  type NativePreviewPlanResponse,
} from "@aijian/contracts/native-preview-plan";
import type { components } from "@aijian/contracts";
import {
  isMediaPreviewIdentity,
  type MediaPreviewIdentity,
} from "./media-preview-session-contract";
import { isRecord } from "./api-contract-guards";

/** Private main-to-owned-process protocol. Never exposed through preload/HTTP. */
export const MLT_WIRE_VERSION = 1;
export const MLT_MAX_PACKET_BYTES = 131_072;
export const MLT_VIDEO_CAPABILITIES = Object.freeze({
  version: 1,
  engine: "MLT_7_40",
  window: "NATIVE_SDL2_WINDOW",
  video: "SINGLE_TRACK_CFR_IDENTITY",
  frame_evidence: "PATCHED_PRESENTED_EVENT",
  embedded_audio: "MUTE",
  audio_tracks: false,
  audio_output_clock: false,
  images: false,
  transitions: false,
  subtitles: false,
  encoding: false,
  publishing: false,
} as const);
export type MltBinaryFile = {
  path: string;
  sha256: string;
  byte_size: number;
};
export type MltOwnedSource = MltBinaryFile & { asset_id: string; asset_version_id: string };
export type MltNativeReleaseProfile = {
  schema_version: 1;
  distribution_status: "REVIEWED_RELEASE";
  mlt_version: "7.40.0";
  source_patch_sha256: string;
  capability: typeof MLT_VIDEO_CAPABILITIES;
  network_disabled_build: true;
  pe_closure_receipt_sha256: string;
  license_source_receipt_sha256: string;
  host_file: string;
  framework_file: string;
  files: { relative_path: string; sha256: string; byte_size: number }[];
};
export type MltPrivateMaterial = {
  /** Full canonical binary/notice/source/build profile digest admitted by trusted main. */
  profile_hash: string;
  profile: MltNativeReleaseProfile;
  runtime_root: string;
  framework_path: string;
  module_directory: string;
  data_directory: string;
  runtime_files: MltBinaryFile[];
  sources: MltOwnedSource[];
};
export type MltWireOpen = {
  open_request_id: string;
  identity: MediaPreviewIdentity;
  session_id: string;
  generation: number;
  expires_at: string;
  plan: NativePreviewPlanResponse["data"];
};
export type MltWireStatus = {
  sequence: number;
  session_id: string;
  generation: number;
  open_request_id: string;
  identity_json: string;
  expires_at: string;
  state: "READY_PAUSED" | "PLAYING" | "PAUSED" | "CLOSED" | "FAILED";
  shown_frame: number | null;
};
const HASH = /^[0-9a-f]{64}$/;
const PATH = /^[A-Za-z]:\\/;
function keys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return (
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}
function verifyProfile(material: MltPrivateMaterial, admitted: readonly string[]) {
  const profile = material.profile;
  if (
    !isRecord(profile) ||
    !keys(profile, [
      "schema_version",
      "distribution_status",
      "mlt_version",
      "source_patch_sha256",
      "capability",
      "network_disabled_build",
      "pe_closure_receipt_sha256",
      "license_source_receipt_sha256",
      "host_file",
      "framework_file",
      "files",
    ]) ||
    profile.schema_version !== 1 ||
    profile.distribution_status !== "REVIEWED_RELEASE" ||
    profile.mlt_version !== "7.40.0" ||
    !HASH.test(profile.source_patch_sha256) ||
    !HASH.test(profile.pe_closure_receipt_sha256) ||
    !HASH.test(profile.license_source_receipt_sha256) ||
    profile.network_disabled_build !== true ||
    visualJson(profile.capability) !== visualJson(MLT_VIDEO_CAPABILITIES) ||
    material.profile_hash !==
      `sha256:${createHash("sha256").update(visualJson(profile)).digest("hex")}` ||
    !admitted.includes(material.profile_hash) ||
    !localPath(material.runtime_root) ||
    profile.host_file !== "aivora-mlt-preview-host.exe" ||
    !/^(?:lib)?mlt-7\.dll$/.test(profile.framework_file) ||
    material.framework_path !== material.runtime_root + "\\" + profile.framework_file ||
    material.module_directory !== material.runtime_root + "\\modules" ||
    material.data_directory !== material.runtime_root + "\\data" ||
    !Array.isArray(profile.files) ||
    profile.files.length < 6 ||
    profile.files.length > 256 ||
    material.runtime_files.length !== profile.files.length
  )
    throw new Error("MLT binary/license profile has not been admitted as exact material");
  const names = new Set<string>();
  for (const file of profile.files) {
    if (
      !isRecord(file) ||
      !keys(file, ["relative_path", "sha256", "byte_size"]) ||
      typeof file.relative_path !== "string" ||
      !/^[a-z0-9_.-]+(?:\\[a-z0-9_.-]+)*$/.test(file.relative_path) ||
      file.relative_path.split("\\").some((part) => part === "." || part === "..") ||
      names.has(file.relative_path) ||
      !HASH.test(file.sha256)
    )
      throw new Error("MLT profile file inventory is not closed");
    names.add(file.relative_path);
    const path = material.runtime_root + "\\" + file.relative_path;
    const matched = material.runtime_files.filter(
      (candidate) =>
        candidate.path === path &&
        candidate.sha256 === file.sha256 &&
        candidate.byte_size === file.byte_size,
    );
    if (matched.length !== 1)
      throw new Error("MLT runtime inventory differs from admitted profile");
  }
  if (
    !names.has(profile.host_file) ||
    !names.has(profile.framework_file) ||
    !names.has("licenses\\third-party-notices.txt")
  )
    throw new Error("MLT profile omits its host/framework/license inventory");
  for (const module of ["core", "avformat", "sdl2"])
    if (!names.has(`modules\\mlt${module}.dll`) && !names.has(`modules\\libmlt${module}.dll`))
      throw new Error("MLT profile omits a required exact native module");
}
function localPath(path: string): boolean {
  if (typeof path !== "string" || path.length > 240 || !PATH.test(path)) return false;
  return path
    .slice(3)
    .split("\\")
    .every(
      (part) =>
        part.length > 0 &&
        ![...part].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) &&
        !/[/:*?"<>|]/.test(part) &&
        !/[. ]$/.test(part) &&
        !/^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part),
    );
}
function checkedFile(file: MltBinaryFile): void {
  if (
    !localPath(file.path) ||
    !HASH.test(file.sha256) ||
    !Number.isSafeInteger(file.byte_size) ||
    file.byte_size < 1 ||
    file.byte_size > 512 * 1024 * 1024
  )
    throw new Error("MLT private material is not an exact bounded local file");
}
class Writer {
  parts: Buffer[] = [];
  u32(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)
      throw new Error("MLT wire integer is outside its bound");
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    this.parts.push(bytes);
  }
  string(value: string) {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > 16_384 || value.includes("\0") || bytes.toString("utf8") !== value)
      throw new Error("MLT wire string is outside its bound");
    this.u32(bytes.length);
    this.parts.push(bytes);
  }
  packet() {
    const bytes = Buffer.concat(this.parts);
    if (bytes.length > MLT_MAX_PACKET_BYTES) throw new Error("MLT wire packet is too large");
    const size = Buffer.alloc(4);
    size.writeUInt32LE(bytes.length);
    return Buffer.concat([size, bytes]);
  }
}
export function encodeMltOpen(
  command: MltWireOpen,
  material: MltPrivateMaterial,
  admittedProfileHashes: readonly string[],
): Buffer {
  const requestId = "00000000-0000-4000-8000-000000000000";
  if (
    !isMediaPreviewIdentity(command.identity) ||
    !/^pvs_[0-9a-f]{32}$/.test(command.session_id) ||
    !/^pvo_[0-9a-f]{32}$/.test(command.open_request_id) ||
    !Number.isSafeInteger(command.generation) ||
    command.generation < 1 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(command.expires_at) ||
    !Number.isFinite(Date.parse(command.expires_at)) ||
    !nativePreviewPlanResponse(
      { data: command.plan, request_id: requestId },
      command.identity.project_id,
      command.identity.episode_id,
      command.identity.assembly_version_id,
      requestId,
    )
  )
    throw new Error("MLT private opening is not a canonical exact saved plan");
  verifyProfile(material, admittedProfileHashes);
  const { plan, plan_hash } = command.plan;
  const digest = `sha256:${createHash("sha256").update(visualJson(plan)).digest("hex")}`;
  const source = plan.source;
  if (
    plan.scope !== "DRAFT_PREVIEW" ||
    source.origin !== "EPISODE_ASSEMBLY" ||
    source.test_spec_sha256 !== null ||
    source.fixture_manifest_sha256 !== null ||
    plan_hash !== digest ||
    command.identity.plan_hash !== plan_hash ||
    source.project_id !== command.identity.project_id ||
    source.episode_id !== command.identity.episode_id ||
    source.assembly_artifact_id !== command.identity.assembly_artifact_id ||
    source.assembly_version_id !== command.identity.assembly_version_id ||
    source.assembly_content_hash !== command.identity.assembly_content_hash ||
    source.assembly_head_revision !== command.identity.assembly_head_revision ||
    plan.video_tracks.length !== 1 ||
    plan.video_tracks[0]?.layer_index !== 0 ||
    plan.audio_tracks.length !== 0 ||
    plan.subtitle_cues.length !== 0 ||
    plan.video_transitions.length !== 0 ||
    plan.absent_test_roles.length !== 0 ||
    plan.subtitle_output_mode !== "NONE" ||
    plan.dialogue_speech_status !== "NOT_APPLICABLE"
  )
    throw new Error("MLT video capability does not cover this frozen plan");
  for (const path of [material.framework_path, material.module_directory, material.data_directory])
    if (!localPath(path)) throw new Error("MLT paths must be private owned local material");
  if (material.runtime_files.length < 1 || material.runtime_files.length > 256)
    throw new Error("MLT runtime inventory is outside its bound");
  const all = [...material.runtime_files, ...material.sources];
  all.forEach(checkedFile);
  if (new Set(all.map((file) => file.path.toLowerCase())).size !== all.length)
    throw new Error("MLT private inventory has duplicate paths");
  if (!material.runtime_files.some((file) => file.path === material.framework_path))
    throw new Error("MLT framework is missing from the exact inventory");
  const clips = plan.video_tracks[0].clips;
  if (clips.length < 1 || clips.length > 32 || material.sources.length > 32)
    throw new Error("MLT video clip/source inventory is outside its current bound");
  const selected = new Set<string>();
  const mapped = clips.map((clip: components["schemas"]["ExecutionVideoClipV1"]) => {
    const matches = material.sources.filter(
      (file) =>
        file.asset_id === clip.media.asset_id &&
        file.asset_version_id === clip.media.asset_version_id &&
        file.sha256 === clip.media.sha256 &&
        file.byte_size === clip.media.byte_size,
    );
    if (
      matches.length !== 1 ||
      clip.scale_mode !== "IDENTITY" ||
      clip.source_width !== plan.canvas_width ||
      clip.source_height !== plan.canvas_height ||
      clip.embedded_audio !== "MUTE"
    )
      throw new Error("MLT source snapshot differs from the exact selected source");
    selected.add(matches[0]!.path);
    return { clip, file: matches[0]! };
  });
  if (selected.size !== material.sources.length)
    throw new Error("MLT source inventory contains unselected material");
  const wire = new Writer();
  wire.u32(MLT_WIRE_VERSION);
  wire.u32(1); // OPEN packet, sequence zero is reserved for its receipt.
  wire.string(command.session_id);
  wire.u32(command.generation);
  wire.string(command.open_request_id);
  wire.string(visualJson(command.identity));
  wire.string(command.expires_at);
  wire.string(material.profile_hash);
  wire.string(material.framework_path);
  wire.string(material.module_directory);
  wire.string(material.data_directory);
  wire.u32(material.runtime_files.length);
  for (const file of material.runtime_files) {
    wire.string(file.path);
    wire.string(file.sha256);
    wire.u32(file.byte_size);
  }
  wire.u32(plan.canvas_width);
  wire.u32(plan.canvas_height);
  wire.u32(plan.sequence_timebase.frame_rate.num);
  wire.u32(plan.sequence_timebase.frame_rate.den);
  wire.u32(plan.total_frames);
  wire.u32(mapped.length);
  for (const { clip, file } of mapped) {
    wire.string(file.path);
    wire.string(file.sha256);
    wire.u32(file.byte_size);
    wire.u32(clip.start_frame);
    wire.u32(clip.end_frame);
    wire.u32(clip.source_in_frame);
    wire.u32(clip.source_frame_count);
  }
  return wire.packet();
}
export function encodeMltCommand(
  sequence: number,
  generation: number,
  kind: "status" | "play" | "pause" | "seek" | "close",
  commandId: string,
  frame = 0,
): Buffer {
  const wire = new Writer();
  wire.u32(MLT_WIRE_VERSION);
  wire.u32(3);
  wire.u32(sequence);
  wire.u32(generation);
  wire.u32(["status", "play", "pause", "seek", "close"].indexOf(kind));
  wire.string(commandId);
  wire.u32(frame);
  return wire.packet();
}
export function decodeMltStatus(bytes: Buffer): MltWireStatus {
  let offset = 0;
  function u32() {
    if (offset + 4 > bytes.length) throw new Error("Truncated MLT status");
    const value = bytes.readUInt32LE(offset);
    offset += 4;
    return value;
  }
  function string() {
    const size = u32();
    if (size > 16_384 || offset + size > bytes.length) throw new Error("Truncated MLT string");
    const value = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset, offset + size),
    );
    offset += size;
    if (value.includes("\0")) throw new Error("Invalid MLT string");
    return value;
  }
  if (bytes.length > MLT_MAX_PACKET_BYTES || u32() !== MLT_WIRE_VERSION || u32() !== 2)
    throw new Error("Unsupported MLT status packet");
  const sequence = u32(),
    session_id = string(),
    generation = u32(),
    open_request_id = string();
  const identity_json = string(),
    expires_at = string(),
    stateId = u32(),
    frame = u32();
  const state = (["READY_PAUSED", "PLAYING", "PAUSED", "CLOSED", "FAILED"] as const)[stateId];
  if (!state || offset !== bytes.length) throw new Error("Invalid MLT status tail");
  return {
    sequence,
    session_id,
    generation,
    open_request_id,
    identity_json,
    expires_at,
    state,
    shown_frame: frame === 0xffff_ffff ? null : frame,
  };
}
