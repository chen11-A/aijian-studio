import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, normalize, parse } from "node:path";
import { hasControlCharacter, hasRequestId } from "./api-contract-guards";
import {
  isDraftExportJob,
  isDraftExportOperationId,
  isDraftExportScope,
  type DraftExportOutputErrorCode,
  type DraftExportOutputIdentity,
  type DraftExportPreviewResult,
  type DraftExportRevealResult,
} from "./draft-export-contract";
import type { DraftExportClient } from "./draft-export-ipc";

export const DRAFT_PREVIEW_LIMIT = 32 * 1024 * 1024;
export const DRAFT_OUTPUT_LIMIT = 2 * 1024 * 1024 * 1024;
export const DRAFT_VERIFY_TIMEOUT_MS = 120_000;
class OutputError extends Error {
  constructor(readonly code: DraftExportOutputErrorCode) {
    super(code);
  }
}
type PathEntry = { path: string; stat: BigIntStats };
function reject(code: DraftExportOutputErrorCode): never {
  throw new OutputError(code);
}
function requireCanonicalLocalPath(path: string, filename: string): void {
  if (
    !isAbsolute(path) ||
    normalize(path) !== path ||
    hasControlCharacter(path) ||
    path.startsWith("\\") ||
    path.startsWith("//") ||
    path.split(/[/\\]/).some((part) => part === "." || part === "..") ||
    basename(path) !== filename ||
    !path.toLowerCase().endsWith(".mp4")
  )
    reject("UNSAFE_PATH");
  if (process.platform === "win32") {
    if (
      !/^[A-Za-z]:\\/.test(path) ||
      path.includes("/") ||
      path
        .slice(3)
        .split("\\")
        .some(
          (part) =>
            /[:<>"|?*]/.test(part) ||
            /[. ]$/.test(part) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    )
      reject("UNSAFE_PATH");
  } else if (path.includes("\\") || path.includes(":") || /^\/(dev|proc|sys)(\/|$)/.test(path)) {
    reject("UNSAFE_PATH");
  }
}
function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}
function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    right.isFile() &&
    right.nlink === 1n
  );
}
async function inspectPath(path: string): Promise<PathEntry[]> {
  const paths = [path];
  while (paths[0] !== parse(path).root) paths.unshift(dirname(paths[0]!));
  const entries: PathEntry[] = [];
  for (const candidate of paths) {
    const stat = await lstat(candidate, { bigint: true });
    // Node reports Windows junctions as symlinks. Exact realpath also rejects aliases,
    // redirected ancestors and device/UNC resolutions. No normalized path is substituted.
    if (
      stat.isSymbolicLink() ||
      (await realpath(candidate)) !== candidate ||
      (candidate === path ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory())
    )
      reject("UNSAFE_PATH");
    entries.push({ path: candidate, stat });
  }
  return entries;
}
async function requireUnchangedPath(before: PathEntry[]): Promise<void> {
  const after = await inspectPath(before[before.length - 1]!.path);
  if (
    after.length !== before.length ||
    after.some(
      (entry, index) =>
        entry.path !== before[index]!.path ||
        (index === after.length - 1
          ? !sameFile(before[index]!.stat, entry.stat)
          : !sameIdentity(before[index]!.stat, entry.stat)),
    )
  )
    reject("FILE_CHANGED");
}
function hasMp4Header(header: Buffer, bytes: number): boolean {
  if (header.length < 16 || header.toString("ascii", 4, 8) !== "ftyp") return false;
  const boxLength = header.readUInt32BE(0);
  return (
    boxLength >= 16 &&
    boxLength <= bytes &&
    boxLength % 4 === 0 &&
    ["isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1"].includes(
      header.toString("ascii", 8, 12),
    )
  );
}

/** The scoped fresh getter independently rehashes the file and admits local volumes
 * (including Windows GetDriveType). Main then independently verifies exact path,
 * every ancestor, open-file identity, bounded bytes, MP4 magic and SHA-256. */
export async function accessDraftExportOutput(
  client: Pick<DraftExportClient, "getDraftExport">,
  projectId: string,
  episodeId: string,
  operationId: string,
  action: "preview" | "reveal",
  revealOutput: (trustedPath: string) => void,
): Promise<DraftExportPreviewResult | DraftExportRevealResult> {
  if (!isDraftExportScope(projectId, episodeId) || !isDraftExportOperationId(operationId))
    return { kind: "OUTPUT_UNAVAILABLE", code: "RECEIPT_MISMATCH" };
  let result;
  try {
    result = await client.getDraftExport(projectId, episodeId, operationId);
  } catch {
    return { kind: "REMOTE_UNKNOWN" };
  }
  if (result.kind !== "FOUND") {
    return ["REMOTE_UNKNOWN", "NOT_FOUND", "DEFINITE_SERVER_ERROR"].includes(result.kind)
      ? result
      : { kind: "REMOTE_UNKNOWN" };
  }
  const { data: job } = result.receipt;
  if (!hasRequestId(result.receipt) || !isDraftExportJob(job, projectId, episodeId, operationId))
    return { kind: "OUTPUT_UNAVAILABLE", code: "RECEIPT_MISMATCH" };
  if (
    job.status !== "SUCCEEDED" ||
    typeof job.output_path !== "string" ||
    typeof job.output_sha256 !== "string" ||
    typeof job.output_bytes !== "number"
  )
    return { kind: "OUTPUT_UNAVAILABLE", code: "NOT_SUCCEEDED" };
  const path = job.output_path;
  const identity: DraftExportOutputIdentity = {
    project_id: projectId,
    episode_id: episodeId,
    operation_id: operationId,
    output_sha256: job.output_sha256,
    output_bytes: job.output_bytes,
  };
  try {
    const started = performance.now();
    const withinDeadline = () => {
      if (performance.now() - started > DRAFT_VERIFY_TIMEOUT_MS) reject("FILE_UNAVAILABLE");
    };
    requireCanonicalLocalPath(path, job.output_filename);
    if (job.output_bytes > DRAFT_OUTPUT_LIMIT) reject("OUTPUT_TOO_LARGE");
    const before = await inspectPath(path);
    const fileStat = before[before.length - 1]!.stat;
    if (fileStat.size !== BigInt(job.output_bytes)) reject("FILE_CHANGED");
    if (action === "preview" && job.output_bytes > DRAFT_PREVIEW_LIMIT)
      return {
        kind: "PREVIEW_TOO_LARGE",
        output_bytes: job.output_bytes,
        limit_bytes: DRAFT_PREVIEW_LIMIT,
      };
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      if (!sameFile(fileStat, await handle.stat({ bigint: true }))) reject("FILE_CHANGED");
      await requireUnchangedPath(before);
      const hash = createHash("sha256");
      const preview = action === "preview" ? new Uint8Array(job.output_bytes) : null;
      const chunk = Buffer.alloc(Math.min(1024 * 1024, job.output_bytes));
      let header = Buffer.alloc(0);
      let offset = 0;
      while (offset < job.output_bytes) {
        withinDeadline();
        const { bytesRead } = await handle.read(
          chunk,
          0,
          Math.min(chunk.length, job.output_bytes - offset),
          offset,
        );
        if (!bytesRead) reject("FILE_CHANGED");
        const bytes = chunk.subarray(0, bytesRead);
        if (header.length < 16) header = Buffer.concat([header, bytes]).subarray(0, 16);
        hash.update(bytes);
        preview?.set(bytes, offset);
        offset += bytesRead;
      }
      // Explicitly reject growth; never read an unbounded stream into the renderer.
      if ((await handle.read(chunk, 0, 1, offset)).bytesRead !== 0) reject("FILE_CHANGED");
      if (!sameFile(fileStat, await handle.stat({ bigint: true }))) reject("FILE_CHANGED");
      await requireUnchangedPath(before);
      if (hash.digest("hex") !== job.output_sha256) reject("HASH_MISMATCH");
      if (!hasMp4Header(header, offset)) reject("INVALID_MP4");
      withinDeadline();
      if (preview) return { kind: "READY", mime_type: "video/mp4", bytes: preview, identity };
      try {
        revealOutput(path);
      } catch {
        reject("REVEAL_FAILED");
      }
      return { kind: "REVEALED", identity };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return {
      kind: "OUTPUT_UNAVAILABLE",
      code: error instanceof OutputError ? error.code : "FILE_UNAVAILABLE",
    };
  }
}
