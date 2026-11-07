import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  FilmAssemblyInput,
  FilmAssemblyArtifact,
  FilmAssemblyResult,
  FilmAssemblyFailure,
} from "@aijian/contracts/film-assembly";
import { audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import { filmHistoryRecordHash } from "./film-history";
import {
  joinClips,
  mediaUrlPath,
  readProject,
  transactFilmProject,
  type FilmRecord,
} from "./film-library";
import { resolveAudioMix } from "./film-audio-mix-sources";
import { renderAudioMix } from "./film-audio-mix";
import { copyExportFile, exportFileHash } from "./film-export-io";
import { normalizeMixedAudio, type AudioNormalizer } from "./film-audio-normalize";
import {
  subtitleAss,
  validCues,
  SUBTITLE_LOOKS,
  SUBTITLE_FONT_FILE,
  type ExportCue,
  type SubtitleLook,
} from "./film-subtitles";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
import type { ExportWork } from "./film-export-operation";
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) => (typeof value === "string" ? value : "");
function fail(code: string): never {
  throw Error(code);
}
export function assemblyInput(value: unknown): FilmAssemblyInput {
  const v = object(value);
  if (
    !v ||
    Object.keys(v).sort().join() !== "expectedHash,expectedSelection,projectId" ||
    !/^film_[a-z0-9]{16,40}$/.test(text(v.projectId)) ||
    !/^[a-f0-9]{64}$/.test(text(v.expectedHash)) ||
    !Array.isArray(v.expectedSelection) ||
    !v.expectedSelection.length ||
    v.expectedSelection.length > 128
  )
    fail("INVALID_INPUT");
  const entries = v.expectedSelection as unknown[];
  const selected = entries.map((value) => {
    const item = object(value);
    if (
      !item ||
      Object.keys(item).sort().join() !== "shotId,takeId" ||
      ![item.shotId, item.takeId].every(
        (id) => typeof id === "string" && id.length > 0 && id.length <= 160 && !id.includes("\0"),
      )
    )
      fail("INVALID_INPUT");
    return { shotId: item.shotId as string, takeId: item.takeId as string };
  });
  if (new Set(selected.map((row) => row.shotId)).size !== selected.length) fail("INVALID_INPUT");
  return {
    projectId: v.projectId as string,
    expectedHash: v.expectedHash as string,
    expectedSelection: selected,
  };
}
export type FilmAssemblyHost = {
  filmsRoot: string;
  storyFilmsRoot: string;
  temporaryRoot: string;
  tools: (signal?: AbortSignal) => Promise<QcTools>;
  runner: () => Promise<QcRunner>;
  font: () => string;
  normalizer?: () => Promise<AudioNormalizer>;
  videoOwner?: Parameters<typeof resolveAudioMix>[2]["videoOwner"];
  audioOwner?: Parameters<typeof resolveAudioMix>[2]["audioOwner"];
  beforeCommit?: () => Promise<void>;
  afterResolve?: () => Promise<void>;
};
function selected(record: FilmRecord, input: FilmAssemblyInput) {
  if (
    record.id !== input.projectId ||
    filmHistoryRecordHash(record) !== input.expectedHash ||
    !Array.isArray(record.shots)
  )
    fail("PROJECT_CHANGED");
  const rows = record.shots.map(object);
  if (
    rows.some((row) => !row || !text(row.id)) ||
    new Set(rows.map((row) => row!.id)).size !== rows.length
  )
    fail("PROJECT_CHANGED");
  let previous = -1;
  return input.expectedSelection.map((expected) => {
    const index = rows.findIndex((shot) => shot!.id === expected.shotId),
      shot = rows[index];
    if (index <= previous || !shot || !Array.isArray(shot.takes)) fail("PROJECT_CHANGED");
    previous = index;
    const takes = shot.takes.map(object);
    if (
      takes.some((take) => !take || !text(take.id)) ||
      new Set(takes.map((take) => take!.id)).size !== takes.length
    )
      fail("PROJECT_CHANGED");
    const chosen =
      text(shot.selectedTakeId) ||
      text(takes.find((take) => take!.status === "done" && text(take!.videoPath))?.id);
    const take = takes.find((take) => take!.id === expected.takeId);
    if (
      chosen !== expected.takeId ||
      !take ||
      take.shotId !== shot.id ||
      take.status !== "done" ||
      !/\.mp4$/i.test(mediaUrlPath(text(take.videoPath)))
    )
      fail("MISSING_MEDIA");
    return {
      shot,
      take,
      shotId: expected.shotId,
      takeId: expected.takeId,
      videoPath: mediaUrlPath(text(take.videoPath)),
      visualPath: mediaUrlPath(text(take.cleanVideoPath) || text(take.videoPath)),
    };
  });
}
async function visualInfo(path: string, tools: QcTools, run: QcRunner, signal?: AbortSignal) {
  const { stdout } = await run(
    tools.ffprobePath,
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration",
      "-of",
      "json",
      path,
    ],
    { signal, timeoutMs: 30_000, maxBuffer: 65536 },
  );
  const raw = JSON.parse(stdout),
    stream = raw.streams?.[0],
    width = Number(stream?.width),
    height = Number(stream?.height),
    duration = Number(stream?.duration);
  if (
    !Number.isInteger(width) ||
    width < 2 ||
    width > 8192 ||
    !Number.isInteger(height) ||
    height < 2 ||
    height > 8192 ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    fail("SOURCE_TIME_MISMATCH");
  return { width, height, duration };
}
/** One trusted assembly path: raw join then the existing shared mixer, never legacy dub/music. */
export function createFilmAssemblies(host: FilmAssemblyHost) {
  const active = new Set<string>();
  return {
    async assemble(value: unknown, work?: ExportWork): Promise<FilmAssemblyResult> {
      let ownedDestination = "",
        projectId = "",
        folder = "",
        destination = "",
        acquired = false,
        completed = false,
        cleanupFailed = false;
      let outcome: FilmAssemblyResult;
      try {
        const input = assemblyInput(value);
        projectId = input.projectId;
        if (active.has(projectId)) fail("BUSY");
        active.add(projectId);
        acquired = true;
        work?.signal.throwIfAborted();
        const record = await readProject(host.filmsRoot, projectId);
        if (!record || record.id !== projectId) fail("PROJECT_CHANGED");
        const choices = selected(record, input);
        const tools = await host.tools(work?.signal).catch(() => fail("TOOLS_UNAVAILABLE")),
          execute = await host.runner();
        const run: QcRunner = (binary, args, options) => {
          const job = execute(binary, args, {
            ...options,
            signal: work?.signal ?? options?.signal,
          });
          return work ? work.track(job) : job;
        };
        const mix = await resolveAudioMix(record, choices, {
          ...host,
          tools,
          run,
          signal: work?.signal,
        });
        await host.afterResolve?.();
        const sources: string[] = [],
          cues: ExportCue[] = [];
        const limitations = [
          ...mix.plan.limitations,
          "技术粗剪不代表完整观看、试听或对白完整性已经验证。",
        ];
        for (const [index, choice] of choices.entries()) {
          work?.signal.throwIfAborted();
          const clock = mix.plan.shots[index]!,
            pinned = mix.selectedSources[index];
          if (!pinned || pinned.shotId !== choice.shotId || pinned.takeId !== choice.takeId)
            fail("SOURCE_CHANGED");
          const native = pinned.native.path,
            visual = pinned.visual.path;
          const supplied = choice.take.subtitleCues;
          const valid = validCues(supplied ?? []);
          // A filtered subset cannot establish that the original layout is complete.
          const layout = Array.isArray(supplied) && supplied.length === valid.length ? valid : [];
          if (visual !== native && layout.length) {
            if (layout.some((cue) => cue.end > clock.durationSeconds + 0.05))
              fail("SOURCE_TIME_MISMATCH");
            sources.push(visual);
            cues.push(
              ...layout.map((cue) => ({
                ...cue,
                start: cue.start + clock.startSeconds,
                end: cue.end + clock.startSeconds,
              })),
            );
          } else {
            const nativeInfo = await visualInfo(native, tools, run, work?.signal);
            if (Math.abs(nativeInfo.duration - clock.durationSeconds) > 0.001)
              fail("SOURCE_TIME_MISMATCH");
            sources.push(native);
            if (visual !== native)
              limitations.push("缺少可靠字幕布局，保留原视频画面；未重新验证其中的烧录文字。");
          }
        }
        work?.signal.throwIfAborted();
        await mkdir(host.temporaryRoot, { recursive: true });
        folder = await mkdtemp(join(host.temporaryRoot, "assembly-"));
        const joined = join(folder, "joined.mp4"),
          mixed = join(folder, "mixed.mp4");
        work?.phase("joining");
        await joinClips(sources, joined, async (args) => {
          await run(tools.ffmpegPath, args, {
            signal: work?.signal,
            timeoutMs: 600000,
            maxBuffer: 1024 * 1024,
          });
        });
        work?.phase("mixing");
        let output = joined,
          incomplete: FilmAssemblyArtifact["incomplete"];
        try {
          output = await renderAudioMix(
            joined,
            mixed,
            mix.plan,
            mix.paths,
            tools,
            run,
            work?.signal,
          );
        } catch (cause) {
          if (
            work?.signal.aborted ||
            (cause instanceof Error && cause.message === "AUDIO_MIX_LIMIT")
          )
            throw cause;
          incomplete = "audio";
          limitations.push("声音混合未完成；后续音量和字幕步骤未执行。");
        }
        if (
          !incomplete &&
          audioMixSettings(record.audioMix).autoAdjustVolume &&
          mix.plan.tracks.length
        ) {
          try {
            if (!host.normalizer) fail("TOOLS_UNAVAILABLE");
            output = await normalizeMixedAudio(
              output,
              join(folder, "normalized.mp4"),
              await host.normalizer(),
              tools,
              run,
              work?.signal,
            );
          } catch (cause) {
            if (work?.signal.aborted) throw cause;
            incomplete = "loudness";
            limitations.push("音量整理未完成；字幕步骤未继续执行。");
          }
        }
        if (!incomplete && cues.length) {
          try {
            work?.phase("rendering");
            const frame = await visualInfo(output, tools, run, work?.signal);
            await mkdir(join(folder, "fonts"));
            await copyFile(host.font(), join(folder, "fonts", SUBTITLE_FONT_FILE));
            await writeFile(
              join(folder, "fonts.conf"),
              '<?xml version="1.0"?><fontconfig><dir prefix="relative">fonts</dir><cachedir prefix="relative">fontcache</cachedir></fontconfig>',
              { flag: "wx" },
            );
            const style = SUBTITLE_LOOKS.includes(record.subtitleStyle as SubtitleLook)
              ? (record.subtitleStyle as SubtitleLook)
              : "white";
            await writeFile(join(folder, "subtitles.ass"), subtitleAss(cues, style, frame), {
              flag: "wx",
            });
            const rendered = join(folder, "subtitled.mp4");
            await run(
              tools.ffmpegPath,
              [
                "-nostdin",
                "-n",
                "-i",
                output,
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-vf",
                "ass=subtitles.ass:fontsdir=fonts",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "copy",
                rendered,
              ],
              {
                cwd: folder,
                env: { ...process.env, FONTCONFIG_FILE: join(folder, "fonts.conf") },
                signal: work?.signal,
                timeoutMs: 600000,
                maxBuffer: 1024 * 1024,
              },
            );
            output = rendered;
          } catch (cause) {
            if (work?.signal.aborted) throw cause;
            incomplete = "subtitles";
            limitations.push("字幕处理未完成，请核对后重新合成。");
          }
        }
        const final = await visualInfo(output, tools, run, work?.signal);
        if (Math.abs(final.duration - mix.plan.durationSeconds) > 0.05)
          fail("SOURCE_TIME_MISMATCH");
        await host.beforeCommit?.();
        await transactFilmProject(host.filmsRoot, projectId, async (current) => {
          if (!current) fail("PROJECT_CHANGED");
          selected(current, input);
          for (const [index, choice] of choices.entries()) {
            const pinned = mix.selectedSources[index]!;
            if (
              (await realpath(choice.videoPath)) !== pinned.native.path ||
              (await realpath(choice.visualPath)) !== pinned.visual.path
            )
              fail("SOURCE_CHANGED");
          }
          for (const [path, hash] of Object.entries(mix.hashes))
            if ((await exportFileHash(path, work?.signal)) !== hash) fail("SOURCE_CHANGED");
          work?.signal.throwIfAborted();
          const root = await realpath(host.filmsRoot),
            series = await realpath(join(root, current.seriesId)),
            episode = await realpath(join(series, "episodes", projectId));
          if (
            relative(root, series) !== current.seriesId ||
            relative(series, episode) !== join("episodes", projectId)
          )
            fail("SOURCE_UNVERIFIED");
          await mkdir(join(episode, "media"), { recursive: true });
          const media = await realpath(join(episode, "media"));
          if (relative(episode, media) !== "media") fail("SOURCE_UNVERIFIED");
          ownedDestination = await mkdtemp(join(media, "assembly-"));
          destination = join(ownedDestination, "film.mp4");
          const copying = copyExportFile(output, destination, work?.signal);
          await (work ? work.track(copying) : copying);
          work?.signal.throwIfAborted();
          // The copy may take time. Recheck actual bytes and the canonical record before
          // returning a usable artifact; this queue still excludes ordinary project writers.
          const latest = await readProject(host.filmsRoot, projectId);
          if (!latest) fail("PROJECT_CHANGED");
          selected(latest, input);
          for (const [index, choice] of choices.entries()) {
            const pinned = mix.selectedSources[index]!;
            if (
              (await realpath(choice.videoPath)) !== pinned.native.path ||
              (await realpath(choice.visualPath)) !== pinned.visual.path
            )
              fail("SOURCE_CHANGED");
          }
          for (const [path, hash] of Object.entries(mix.hashes))
            if ((await exportFileHash(path, work?.signal)) !== hash) fail("SOURCE_CHANGED");
        });
        completed = true;
        outcome = {
          kind: incomplete ? "PARTIAL" : "ASSEMBLED",
          ...(incomplete ? { incomplete } : {}),
          projectId,
          projectHash: input.expectedHash,
          path: destination,
          durationSeconds: mix.plan.durationSeconds,
          shots: mix.plan.shots.map(({ shotId, takeId, startSeconds, durationSeconds }) => ({
            shotId,
            takeId,
            startSeconds,
            durationSeconds,
          })),
          limitations: [...new Set(limitations)],
        };
      } catch (cause) {
        const received = cause instanceof Error ? cause.message : "";
        const codes = [
          "INVALID_INPUT",
          "PROJECT_CHANGED",
          "MISSING_MEDIA",
          "SOURCE_UNVERIFIED",
          "SOURCE_CHANGED",
          "SOURCE_TIME_MISMATCH",
          "TOOLS_UNAVAILABLE",
          "AUDIO_MIX_LIMIT",
          "BUSY",
        ];
        const code = work?.signal.aborted
          ? "OPERATION_STOPPED"
          : codes.includes(received)
            ? received
            : "ASSEMBLY_FAILED";
        outcome = { kind: "FAILED", code: code as FilmAssemblyFailure["code"] };
      } finally {
        try {
          if (ownedDestination && !completed)
            await rm(ownedDestination, { recursive: true, force: true }).catch(() => {
              cleanupFailed = true;
            });
          if (folder)
            await rm(folder, { recursive: true, force: true }).catch(() => {
              cleanupFailed = true;
            });
        } finally {
          if (acquired) active.delete(projectId);
        }
      }
      // Do not confirm stopped/cleaned when the private request directory could not be removed.
      if (cleanupFailed) throw Error("ASSEMBLY_CLEANUP_UNCONFIRMED");
      return outcome;
    },
  };
}
