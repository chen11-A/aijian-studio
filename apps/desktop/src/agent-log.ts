import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

export type AgentLogLine = {
  agent?: string;
  model: string;
  endpoint: string;
  httpStatus: number;
  durationMs?: number;
  parsed?: string;
  /** Legacy callers may supply a body; it is never persisted. */
  body?: string;
  responseChars?: number;
  requestChars?: number;
  referenceImageCount?: number;
  selectedReferenceImageCount?: number;
  requestDispatched?: boolean;
  imageLimit?: number;
  videoReferenceLimit?: number;
  errorCode?: string;
};

export type AgentLog = {
  write(line: AgentLogLine): void;
};

const SECRET =
  /bearer\s+\S+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:access_token|refresh_token|api_key|authorization)\s*["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi;

/** Drop tokens and control characters before a line is written. */
export function redactSecrets(value: string): string {
  const stripped = value.replace(SECRET, "[redacted]");
  return Array.from(stripped)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .slice(0, 500);
}

const agents = new Set([
  "writer",
  "director",
  "action",
  "performance",
  "art",
  "prompter",
  "qc",
  "probe",
  "image",
]);
const endpoints = new Set([
  "responses",
  "chat",
  "text",
  "parse",
  "probe",
  "reference-images",
  "first-last-frame",
  "keyframes",
  "video-voice",
  "vision",
  "tts-timestamps",
  "image-edit",
  "quality-medium",
]);
const parsedKinds = new Set([
  "text",
  "error",
  "shots",
  "scenes",
  "beats",
  "performance",
  "art",
  "prompt",
  "qc",
  "offline",
  "accepted",
  "rejected",
  "image",
  "no-token",
]);
const errorCodes = new Set([
  "TEXT_FAILED",
  "TEXT_TIMEOUT",
  "STALL_RETRYING",
  "TEXT_CANCELLED",
  "REAUTH_REQUIRED",
  "ENTITLEMENT_DENIED",
  "NOT_CONNECTED",
  "IMAGE_FAILED",
]);
const count = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;

/** Append-only metadata log. Neither model replies nor provider error bodies are persisted. */
export function createAgentLog(filePath: string, options: { debug?: boolean } = {}): AgentLog {
  return {
    write(line) {
      const row = JSON.stringify({
        t: new Date().toISOString(),
        agent: agents.has(line.agent ?? "") ? line.agent : "other",
        model: /^grok-[a-z0-9.-]{1,70}$/.test(line.model) ? line.model : "other",
        endpoint: endpoints.has(line.endpoint) ? line.endpoint : "other",
        httpStatus: count(line.httpStatus),
        durationMs: count(line.durationMs),
        parsed: parsedKinds.has(line.parsed ?? "") ? line.parsed : "other",
        responseChars: count(line.responseChars),
        requestChars: count(line.requestChars),
        referenceImageCount: count(line.referenceImageCount),
        ...(line.selectedReferenceImageCount !== undefined
          ? { selectedReferenceImageCount: count(line.selectedReferenceImageCount) }
          : {}),
        ...(typeof line.requestDispatched === "boolean"
          ? { requestDispatched: line.requestDispatched }
          : {}),
        ...(line.imageLimit !== undefined ? { imageLimit: count(line.imageLimit) } : {}),
        ...(line.videoReferenceLimit !== undefined
          ? { videoReferenceLimit: count(line.videoReferenceLimit) }
          : {}),
        ...(options.debug === true ? { debug: true } : {}),
        errorCode: errorCodes.has(line.errorCode ?? "") ? line.errorCode : undefined,
      });
      void mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
        .then(() =>
          open(
            filePath,
            constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
            0o600,
          ),
        )
        .then(async (handle) => {
          try {
            await handle.appendFile(`${row}\n`);
          } finally {
            await handle.close();
          }
        })
        .catch(() => undefined);
    },
  };
}
