import type { BigIntStats } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath, writeFile, link, rm, mkdtemp } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
  FilmDeliveryEvidenceResult,
  FilmDeliveryFile,
  FilmDeliveryFileReference,
  FilmDeliveryManifest,
  FilmDeliveryTechnical,
  FilmDeliveryQcSummary,
} from "@aijian/contracts/film-delivery-evidence";
import type { FilmExportQcSettings } from "@aijian/contracts/film-export-qc";
import type { ExportWork } from "./film-export-operation";
import { exportFileHash } from "./film-export-io";

type Published = {
  aspectRatio: "16:9" | "9:16";
  path: string;
  subtitlePath?: string;
  coverPath?: string;
};
export type CheckedDeliveryOutput = {
  aspectRatio: "16:9" | "9:16";
  videoSha256: string;
  subtitleSha256?: string;
  coverSha256?: string;
  technical: FilmDeliveryTechnical | null;
  qc: FilmDeliveryQcSummary;
};
type Input = {
  directory: string;
  published: Published[];
  checked: CheckedDeliveryOutput[];
  selection: FilmDeliveryManifest["selection"];
  settings: FilmExportQcSettings;
  unverified: string[];
  complete: boolean;
  now: number;
  assertCurrent: () => Promise<void>;
  work?: ExportWork;
};
const sameFile = (left: BigIntStats, right: BigIntStats) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;
const entries = (output: Published) => [
  { role: "video" as const, path: output.path },
  ...(output.subtitlePath ? [{ role: "subtitles" as const, path: output.subtitlePath }] : []),
  ...(output.coverPath ? [{ role: "cover" as const, path: output.coverPath }] : []),
];
function reference(
  output: Published,
  path: string,
  role: FilmDeliveryFileReference["role"],
): FilmDeliveryFileReference {
  const fileName = basename(path);
  if (
    !fileName ||
    fileName.length > 255 ||
    [".", ".."].includes(fileName) ||
    /[\\/:]/.test(fileName) ||
    Array.from(fileName).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error("UNAVAILABLE");
  return { aspectRatio: output.aspectRatio, role, fileName };
}
async function existingReferences(input: Input): Promise<FilmDeliveryFileReference[]> {
  const refs: FilmDeliveryFileReference[] = [];
  for (const output of input.published)
    for (const entry of entries(output)) {
      try {
        if (
          (await lstat(entry.path, { bigint: true })).isFile() &&
          dirname(await realpath(entry.path)) === resolve(input.directory)
        )
          refs.push(reference(output, entry.path, entry.role));
      } catch {
        /* A missing or changed file is never invented in a failure receipt. */
      }
    }
  return refs;
}

/** Main-only final-file bookkeeping. Never accepts an execution path from renderer. */
export async function writeDeliveryManifest(
  input: Input,
  newId: () => string = randomUUID,
): Promise<FilmDeliveryEvidenceResult> {
  let stageDirectory = "",
    writing = false;
  let result: FilmDeliveryEvidenceResult = {
    kind: "FAILED",
    code: "EVIDENCE_UNAVAILABLE",
    files: [],
  };
  try {
    input.work?.signal.throwIfAborted();
    input.work?.cancellable(true);
    const directory = resolve(input.directory);
    if ((await realpath(directory)) !== directory || !input.published.length)
      throw new Error("UNAVAILABLE");
    if (new Set(input.published.map((item) => item.aspectRatio)).size !== input.published.length)
      throw new Error("UNAVAILABLE");
    if (
      input.complete &&
      (input.published.length !== input.checked.length ||
        input.checked.some(
          (item) => !input.published.some((output) => output.aspectRatio === item.aspectRatio),
        ))
    )
      throw new Error("UNAVAILABLE");
    const files: FilmDeliveryFile[] = [];
    const observed: { path: string; stat: BigIntStats }[] = [];
    for (const output of input.published) {
      const checked = input.checked.find((item) => item.aspectRatio === output.aspectRatio);
      if (
        !checked ||
        (input.complete &&
          ((checked.subtitleSha256 && !output.subtitlePath) ||
            (checked.coverSha256 && !output.coverPath)))
      )
        throw new Error("UNAVAILABLE");
      for (const entry of entries(output)) {
        input.work?.signal.throwIfAborted();
        const path = await realpath(entry.path);
        const before = await lstat(entry.path, { bigint: true });
        if (
          !before.isFile() ||
          dirname(path) !== directory ||
          before.size < 1n ||
          before.size > BigInt(Number.MAX_SAFE_INTEGER)
        )
          throw new Error("UNAVAILABLE");
        const expected =
          entry.role === "video"
            ? checked.videoSha256
            : entry.role === "subtitles"
              ? checked.subtitleSha256
              : checked.coverSha256;
        if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Error("UNAVAILABLE");
        const task = exportFileHash(path, input.work?.signal);
        const hash = await (input.work ? input.work.track(task) : task);
        const after = await lstat(entry.path, { bigint: true });
        if (hash !== expected || !sameFile(before, after)) throw new Error("UNAVAILABLE");
        observed.push({ path: entry.path, stat: after });
        files.push({
          ...reference(output, path, entry.role),
          sha256: hash,
          bytes: Number(after.size),
          technical: entry.role === "video" ? checked.technical : null,
          qc: entry.role === "video" ? checked.qc : null,
        });
      }
    }
    const manifest: FilmDeliveryManifest = {
      schemaVersion: 1,
      createdAt: new Date(input.now).toISOString(),
      status: input.complete ? "complete" : "partial",
      selection: structuredClone(input.selection),
      settings: {
        aspects: [...input.settings.aspects],
        quality: input.settings.quality,
        subtitles: input.settings.subtitles,
        style: input.settings.style,
        aiMark: input.settings.aiMark,
        autoAdjustVolume: input.settings.autoAdjustVolume ?? false,
      },
      files,
      unverified: [
        ...new Set([
          ...input.unverified,
          ...(!input.complete ? ["部分画幅或附带文件未完成交付；清单只列实际已落文件。"] : []),
          "技术检测不代表完整播放和试听；台词是否说完、人物动作连续性与口型仍未验证。",
          "QC只检查首条非封面视频轨和首条音轨；不检测其他音轨或烧录字幕。",
          ...(files.some((file) => file.role === "video" && !file.technical)
            ? ["部分最终文件技术信息未知，没有从工程设置推算。"]
            : []),
        ]),
      ],
    };
    const data = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (data.length > 1024 * 1024) throw new Error("UNAVAILABLE");
    const id = newId();
    if (!/^[0-9a-f-]{8,36}$/i.test(id)) throw new Error("UNAVAILABLE");
    const fileName = `aivora-delivery-${id}.json`;
    writing = true;
    // Stage on the selected target volume: linking from the app staging drive
    // would fail for an otherwise valid external/export drive.
    stageDirectory = await mkdtemp(join(directory, ".aivora-delivery-"));
    const stage = join(stageDirectory, "manifest.json");
    const write = writeFile(stage, data, { flag: "wx", mode: 0o600, signal: input.work?.signal });
    await (input.work ? input.work.track(write) : write);
    writing = false;
    await input.assertCurrent();
    input.work?.signal.throwIfAborted();
    for (const entry of observed)
      if (!sameFile(entry.stat, await lstat(entry.path, { bigint: true })))
        throw new Error("UNAVAILABLE");
    // Hash/IO remains cancellable; only the short exclusive final commit cannot stop.
    input.work?.cancellable(false);
    writing = true;
    await link(stage, join(directory, fileName));
    result = {
      kind: "WRITTEN",
      fileName,
      manifestSha256: createHash("sha256").update(data).digest("hex"),
      manifest,
    };
  } catch {
    result = {
      kind: "FAILED",
      code:
        writing && !input.work?.signal.aborted ? "EVIDENCE_WRITE_FAILED" : "EVIDENCE_UNAVAILABLE",
      files: await existingReferences(input),
    };
  } finally {
    if (stageDirectory) {
      try {
        await rm(stageDirectory, { recursive: true, force: true });
      } catch {
        input.work?.cleanupUnconfirmed?.();
        // Keep an already linked, hash-verified public manifest as a WRITTEN
        // fact. Cleanup uncertainty is independent; never rewrite user output.
        result = { ...result, cleanupUnconfirmed: true };
      }
    }
  }
  return result;
}
