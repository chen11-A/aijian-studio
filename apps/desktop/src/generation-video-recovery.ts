import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type {
  GenerationVideoRecoveryListResult,
  GenerationVideoRecoveryResult,
  RecoveredGenerationVideoFile,
  SaveRecoveredGenerationVideoResult,
} from "@aijian/contracts/generation-video-recovery";
import {
  attestGenerationAccount,
  type GenerationDispatchAccount,
} from "./generation-dispatch-account";
import { canonicalLoopbackOrigin } from "./sidecar-origin";

const projectPattern = /^prj_[0-9a-f]{32}$/;
const attemptPattern = /^[0-9a-f]{32}$/;
const maxBytes = 80 * 1024 * 1024;
type Session = { token: string; origin: string };
type Media = () => Promise<string | GenerationDispatchAccount | null>;
const unavailable = { kind: "FAILED", code: "UNAVAILABLE" } as const;
const accountUnavailable = { kind: "FAILED", code: "ACCOUNT_UNAVAILABLE" } as const;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
function file(v: unknown, attempt: string): v is RecoveredGenerationVideoFile {
  return (
    object(v) &&
    Object.keys(v).length === 3 &&
    v.fileName === `recovered-${attempt}.mp4` &&
    typeof v.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(v.sha256) &&
    Number.isSafeInteger(v.bytes) &&
    (v.bytes as number) > 0 &&
    (v.bytes as number) <= maxBytes
  );
}
function account(v: Awaited<ReturnType<Media>>): v is GenerationDispatchAccount {
  return (
    !!v &&
    typeof v === "object" &&
    /^[0-9a-f]{64}$/.test(v.accountSha256) &&
    !!v.bearer &&
    v.bearer.length <= 8192 &&
    !Array.from(v.bearer).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}
export async function generationVideoRecovery(
  fetcher: typeof fetch,
  sessionFor: () => Session,
  media: Media,
  project: string,
  mode: "list" | "recover" | "save",
  attempt?: string,
  choose?: (suggestedName: string) => Promise<string | null>,
  isCurrent: () => boolean = () => true,
): Promise<
  | GenerationVideoRecoveryListResult
  | GenerationVideoRecoveryResult
  | SaveRecoveredGenerationVideoResult
> {
  if (
    !projectPattern.test(project) ||
    (mode !== "list" && (!attempt || !attemptPattern.test(attempt)))
  )
    throw new Error("Invalid video recovery scope");
  if (!isCurrent()) return unavailable;
  const identity = await media();
  if (!account(identity)) return accountUnavailable;
  if (!isCurrent()) return unavailable;
  let bearer = identity.bearer;
  const request = async (suffix: string, method: "GET" | "POST") => {
    const session = sessionFor();
    const key = `story-film:v1:${randomUUID()}`;
    return fetcher(
      `${canonicalLoopbackOrigin(session.origin)}/api/v1/projects/${project}/generation-video-recoveries${suffix}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
          "Idempotency-Key": key,
          "X-Aivora-Media-Bearer": bearer,
          "X-Aivora-Generation-Account": attestGenerationAccount({
            sessionKey: session.token,
            projectId: project,
            idempotencyKey: key,
            body: "",
            account: { ...identity, bearer },
          }),
        },
      },
    );
  };
  try {
    const response = await request(
      mode === "list" ? "" : `/${attempt}`,
      mode === "recover" ? "POST" : "GET",
    );
    if (!response.ok) return response.status === 403 ? accountUnavailable : unavailable;
    const value: unknown = await response.json();
    const currentAccount = await media();
    if (!isCurrent()) return unavailable;
    if (!account(currentAccount) || currentAccount.accountSha256 !== identity.accountSha256)
      return accountUnavailable;
    if (mode === "list") {
      if (
        !object(value) ||
        Object.keys(value).length !== 3 ||
        value.kind !== "ATTEMPTS" ||
        !Array.isArray(value.items) ||
        value.items.length > 100 ||
        typeof value.hasMore !== "boolean"
      )
        return unavailable;
      const ids = new Set<string>();
      for (const item of value.items) {
        if (
          !object(item) ||
          !exact(item, ["attemptId", "state", "file"]) ||
          typeof item.attemptId !== "string" ||
          !attemptPattern.test(item.attemptId) ||
          ids.has(item.attemptId) ||
          !(
            (item.state === "UNKNOWN" && item.file === undefined) ||
            (item.state === "RECOVERED" && file(item.file, item.attemptId))
          )
        )
          return unavailable;
        ids.add(item.attemptId);
      }
      return value as GenerationVideoRecoveryListResult;
    }
    if (!object(value)) return unavailable;
    if (
      value.kind === "FAILED" &&
      Object.keys(value).length === 2 &&
      ["BUSY", "NOT_FOUND", "UNAVAILABLE", "WRITE_UNCONFIRMED"].includes(String(value.code))
    )
      return value as GenerationVideoRecoveryResult;
    if (
      value.kind === "UNKNOWN" &&
      Object.keys(value).length === 3 &&
      value.attemptId === attempt &&
      ["WAITING", "UNREACHABLE", "NO_VALID_VIDEO", "PROVIDER_FAILED"].includes(String(value.reason))
    )
      return value as GenerationVideoRecoveryResult;
    if (
      value.kind !== "RECOVERED" ||
      Object.keys(value).length !== 3 ||
      value.attemptId !== attempt ||
      !file(value.file, attempt!)
    )
      return unavailable;
    if (mode === "recover") return value as GenerationVideoRecoveryResult;
    if (!choose || !isCurrent()) return unavailable;
    const destination = await choose(value.file.fileName);
    if (destination === null) return { kind: "CANCELLED" };
    if (!isCurrent()) return unavailable;
    const fresh = await media();
    if (!account(fresh) || fresh.accountSha256 !== identity.accountSha256)
      return accountUnavailable;
    // Do not use a stale bearer after the native picker wait.
    bearer = fresh.bearer;
    const downloaded = await request(`/${attempt}/file`, "GET");
    if (!downloaded.ok) return unavailable;
    const declared = downloaded.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return unavailable;
    const reader = downloaded.body?.getReader();
    if (!reader) return unavailable;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > value.file.bytes || size > maxBytes) {
          await reader.cancel();
          return unavailable;
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    if (
      size !== value.file.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== value.file.sha256
    )
      return unavailable;
    const beforeWrite = await media();
    if (!isCurrent()) return unavailable;
    if (!account(beforeWrite) || beforeWrite.accountSha256 !== identity.accountSha256)
      return accountUnavailable;
    try {
      await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    } catch {
      return { kind: "FAILED", code: "WRITE_UNCONFIRMED" };
    }
    return { kind: "SAVED", file: value.file };
  } catch {
    return unavailable;
  }
}
