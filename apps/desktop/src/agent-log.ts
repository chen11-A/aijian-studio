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
  body: string;
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

/** Append-only text-model log under the app data directory. Never stores a token. */
export function createAgentLog(filePath: string): AgentLog {
  return {
    write(line) {
      const row = JSON.stringify({
        t: new Date().toISOString(),
        agent: (line.agent ?? "").slice(0, 40),
        model: line.model.slice(0, 80),
        endpoint: line.endpoint.slice(0, 40),
        httpStatus: line.httpStatus,
        durationMs: line.durationMs ?? 0,
        parsed: (line.parsed ?? "").slice(0, 40),
        body: redactSecrets(line.body),
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
