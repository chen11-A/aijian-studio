import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

const SAFE = /^[A-Za-z0-9_]{1,40}$/;
const SECRET =
  /bearer\s|access_token|refresh_token|code_verifier|device_code=|user_code=|eyJ[A-Za-z0-9_-]{8,}/i;

export type GrokLoginLog = {
  path: string;
  event(event: string, fields?: { code?: string; httpStatus?: number }): Promise<void>;
};

/** Append-only login log. Callers can only write a short code and an HTTP status. */
export function createGrokLoginLog(filePath: string): GrokLoginLog {
  return {
    path: filePath,
    async event(event, fields) {
      const name = SAFE.test(event) ? event : "redacted";
      const code = fields?.code && SAFE.test(fields.code) ? fields.code : undefined;
      const httpStatus =
        typeof fields?.httpStatus === "number" &&
        Number.isInteger(fields.httpStatus) &&
        fields.httpStatus >= 100 &&
        fields.httpStatus <= 599
          ? fields.httpStatus
          : undefined;
      const line = JSON.stringify({
        t: new Date().toISOString(),
        event: name,
        ...(code ? { code } : {}),
        ...(httpStatus ? { httpStatus } : {}),
      });
      const safe = SECRET.test(line)
        ? JSON.stringify({ t: new Date().toISOString(), event: "redacted" })
        : line;
      try {
        await mkdir(dirname(filePath), { recursive: true });
        const handle = await open(
          filePath,
          constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await handle.appendFile(`${safe}\n`, "utf8");
        } finally {
          await handle.close();
        }
      } catch {
        // A log failure must not change the login result.
      }
    },
  };
}
