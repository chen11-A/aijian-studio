import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type {
  FilmAudioWaveformInput,
  FilmAudioWaveformResult,
} from "@aijian/contracts/film-audio-waveform";
import { filmAudioSourceIdentity } from "./film-audio-waveform-data";
import { exportFileHash } from "./film-export-io";
import { mediaUrlPath, readProject, trustedMediaPath, type FilmRecord } from "./film-library";
import type { QcTools } from "./film-export-qc-runtime";
type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
const text = (v: unknown) => (typeof v === "string" ? v : "");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(code: string): never {
  throw new Error(code);
}
const within = (root: string, file: string) => {
  const rel = relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
export type FilmAudioWaveformHost = {
  filmsRoot: string;
  storyFilmsRoot: string;
  tools: () => Promise<QcTools>;
  read?: (id: string) => Promise<FilmRecord | null>;
  storyOwner?: (backendProjectId: string, path: string, hash: string) => Promise<boolean>;
};
/** Streaming mono PCM: at most 30 min at 8kHz, 256 bounded bins, no stderr/path return. */
export function decodeAudioPeaks(
  binary: string,
  source: string,
  offset: number,
  duration: number,
): Promise<{ peaks: number[]; analyzedSeconds: number }> {
  return new Promise((resolve, reject) => {
    const rate = 8000,
      limit = 1800,
      wanted = duration > 0 ? Math.min(duration, limit) : limit;
    const peaks = new Array<number>(256).fill(0);
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-protocol_whitelist",
      "file,pipe",
      "-ss",
      String(offset),
      "-i",
      source,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-t",
      String(wanted),
      "-ac",
      "1",
      "-ar",
      String(rate),
      "-f",
      "f32le",
      "pipe:1",
    ];
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let samples = 0,
      carry = Buffer.alloc(0),
      invalid = false;
    // Fixed bins over the declared window. Unknown source duration is probed before this call.
    const count = Math.max(1, Math.round(wanted * rate));
    child.stdout.on("data", (chunk: Buffer) => {
      const bytes = Buffer.concat([carry, chunk]);
      const end = bytes.length - (bytes.length % 4);
      for (let i = 0; i < end; i += 4) {
        const value = bytes.readFloatLE(i);
        if (!Number.isFinite(value) || samples >= count + rate) {
          invalid = true;
          child.kill();
          break;
        }
        const bin = Math.min(255, Math.floor((samples * 256) / count));
        peaks[bin] = Math.max(peaks[bin]!, Math.min(1, Math.abs(value)));
        samples++;
      }
      carry = Buffer.from(bytes.subarray(end));
    });
    child.stderr.resume();
    const timeout = setTimeout(() => {
      invalid = true;
      child.kill();
    }, 60000);
    child.on("error", () => {
      clearTimeout(timeout);
      reject(new Error("DECODE_FAILED"));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (invalid || code !== 0 || carry.length || samples === 0)
        reject(new Error("DECODE_FAILED"));
      else resolve({ peaks, analyzedSeconds: samples / rate });
    });
  });
}
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
export function createFilmAudioWaveforms(host: FilmAudioWaveformHost) {
  const read = host.read ?? ((id: string) => readProject(host.filmsRoot, id));
  async function snapshot(input: FilmAudioWaveformInput) {
    const film = await read(input.projectId);
    if (!film || film.id !== input.projectId) fail("SOURCE_CHANGED");
    const clips = (Array.isArray(film.audioClips) ? film.audioClips : []).map(object);
    const shots = (Array.isArray(film.shots) ? film.shots : []).map(object);
    const unique = (rows: Row[]) =>
      rows.every((row) => typeof row.id === "string" && row.id.length > 0) &&
      new Set(rows.map((row) => row.id)).size === rows.length;
    if (!unique(clips) || !unique(shots)) fail("SOURCE_CHANGED");
    const clip = clips.find((c) => c.id === input.clipId);
    if (!clip || sha(filmAudioSourceIdentity(film, clip)) !== input.expectedSourceKey)
      fail("SOURCE_CHANGED");
    const offset = Number(clip.offsetSeconds),
      duration = Number(clip.durationSeconds);
    if (
      !Number.isFinite(offset) ||
      offset < 0 ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > 1800 ||
      offset > 86400
    )
      fail("LIMIT_EXCEEDED");
    const lane = text(clip.lane),
      shotId = text(clip.shotId),
      takeId = text(clip.takeId);
    if (!["dialogue", "score", "ambience", "sfx"].includes(lane)) fail("SOURCE_UNVERIFIED");
    const shot = shots.find((s) => s.id === shotId);
    const takes = (Array.isArray(shot?.takes) ? shot.takes : []).map(object);
    if (!unique(takes)) fail("SOURCE_CHANGED");
    const take = takes.find((t) => t.id === shot?.selectedTakeId);
    if (
      shotId &&
      (!shot || !take || take.status !== "done" || take.shotId !== shotId || takeId !== take.id)
    )
      fail("SOURCE_CHANGED");
    let source = text(clip.path);
    if (!source || source.startsWith("data:")) return { film, clip, source: "", offset, duration };
    if (clip.label === "原声") {
      if (!take) fail("SOURCE_CHANGED");
      if (source && mediaUrlPath(source) !== mediaUrlPath(text(take.videoPath)))
        fail("SOURCE_UNVERIFIED");
      source = text(take.videoPath);
    }
    if (!source || source.startsWith("data:")) return { film, clip, source: "", offset, duration };
    if (!/^film_[a-z0-9]{16,40}$/.test(film.seriesId)) fail("SOURCE_UNVERIFIED");
    const series = await realpath(join(host.filmsRoot, film.seriesId));
    const root = await realpath(host.filmsRoot);
    if (relative(root, series) !== film.seriesId) fail("SOURCE_UNVERIFIED");
    const story = await realpath(host.storyFilmsRoot).catch(() => "");
    source = trustedMediaPath([series, ...(story ? [story] : [])], mediaUrlPath(source));
    const info = await stat(source);
    if (!info.isFile() || info.size <= 0 || info.size > 512 * 1024 * 1024) fail("LIMIT_EXCEEDED");
    const hash = await exportFileHash(source);
    const episode = join(series, "episodes", film.id);
    // Imported series music is shared intentionally; media under another episode is not.
    const local =
      within(episode, source) ||
      within(join(series, "media"), source) ||
      (lane === "score" && within(join(series, "music"), source));
    if (
      !local &&
      !(
        story &&
        within(story, source) &&
        host.storyOwner &&
        (await host.storyOwner(text(film.backendProjectId), source, hash))
      )
    )
      fail("SOURCE_UNVERIFIED");
    return { film, clip, source, offset, duration, hash };
  }
  let busy = false;
  return async (value: unknown): Promise<FilmAudioWaveformResult> => {
    if (busy) return { kind: "FAILED", code: "BUSY" };
    busy = true;
    try {
      const input = object(value);
      if (
        Object.keys(input).sort().join() !== "clipId,expectedSourceKey,projectId" ||
        !/^film_[a-z0-9]{16,40}$/.test(text(input.projectId)) ||
        !text(input.clipId) ||
        text(input.clipId).length > 128 ||
        !/^[a-f0-9]{64}$/.test(text(input.expectedSourceKey))
      )
        fail("INVALID_INPUT");
      const request = input as FilmAudioWaveformInput;
      const base = await snapshot(request);
      if (!base.source) return { kind: "EMPTY", code: "NO_SOURCE" };
      if (base.duration <= 0) return { kind: "EMPTY", code: "WINDOW_UNKNOWN" };
      const tools = await host.tools().catch(() => fail("TOOLS_UNAVAILABLE"));
      const probe = await execute(
        tools.ffprobePath,
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=duration:format=duration",
          "-of",
          "json",
          base.source,
        ],
        { timeout: 10000, maxBuffer: 65536, windowsHide: true },
      );
      const metadata = JSON.parse(probe.stdout);
      if (!Array.isArray(metadata.streams) || !metadata.streams.length)
        return { kind: "EMPTY", code: "NO_AUDIO" };
      const total = Number(metadata.streams[0]?.duration ?? metadata.format?.duration);
      if (!Number.isFinite(total) || total <= 0 || total > 1800 || base.offset >= total)
        fail("LIMIT_EXCEEDED");
      // Bin only decoded source coverage; the renderer leaves the unmeasured clip tail blank.
      const duration = Math.min(base.duration, total - base.offset);
      const decoded = await decodeAudioPeaks(tools.ffmpegPath, base.source, base.offset, duration);
      const latest = await snapshot(request);
      if (latest.source !== base.source || latest.hash !== base.hash) fail("SOURCE_CHANGED");
      return {
        kind: "READY",
        waveform: {
          schemaVersion: 1,
          sourceKey: request.expectedSourceKey,
          sourceSha256: base.hash!,
          offsetSeconds: base.offset,
          durationSeconds: base.duration,
          analyzedSeconds: decoded.analyzedSeconds,
          peaks: decoded.peaks,
        },
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return {
        kind: "FAILED",
        code: ([
          "INVALID_INPUT",
          "SOURCE_CHANGED",
          "SOURCE_UNVERIFIED",
          "LIMIT_EXCEEDED",
          "TOOLS_UNAVAILABLE",
        ].includes(code)
          ? code
          : "DECODE_FAILED") as Extract<FilmAudioWaveformResult, { kind: "FAILED" }>["code"],
      };
    } finally {
      busy = false;
    }
  };
}
export function registerFilmAudioWaveforms<T>(
  handle: (channel: string, listener: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  host: FilmAudioWaveformHost,
) {
  const produce = createFilmAudioWaveforms(host);
  handle("film:audio-waveform", async (event, ...args) => {
    if (!authorized(event) || args.length !== 1) return { kind: "FAILED", code: "INVALID_INPUT" };
    return produce(args[0]);
  });
}
