import { isAbsolute } from "node:path";
import { hasControlCharacter } from "./api-contract-guards";
import { isMediaToolchainStatus, type MediaToolchainResult } from "./media-toolchain-contract";

export type MediaToolchainClient = {
  getMediaToolchainStatus(): Promise<MediaToolchainResult>;
  selectMediaToolchainDirectory(directory: string): Promise<MediaToolchainResult>;
  clearMediaToolchain(): Promise<MediaToolchainResult>;
};
type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;

/** Only main's native folder picker supplies this directory. No PATH discovery or downloads. */
export function isNativeMediaToolchainDirectory(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 32_768 &&
    isAbsolute(value) &&
    !hasControlCharacter(value)
  );
}

export function createMediaToolchainClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): MediaToolchainClient {
  const base = "/api/v1/local-media-toolchain";
  async function request(
    path: string,
    method: "GET" | "PUT" | "DELETE",
    directory?: string,
  ): Promise<MediaToolchainResult> {
    try {
      const result = await readHttp(path, {
        method,
        headers:
          directory === undefined ? headers : { ...headers, "Content-Type": "application/json" },
        ...(directory === undefined ? {} : { body: JSON.stringify({ directory }) }),
      });
      return result?.status === 200 && isMediaToolchainStatus(result.payload)
        ? { kind: "STATUS", status: result.payload }
        : { kind: "REMOTE_UNKNOWN" };
    } catch {
      // A lost PUT/DELETE receipt does not mean the saved machine setting was unchanged.
      // The renderer must request a fresh status; never repeat a mutation automatically.
      return { kind: "REMOTE_UNKNOWN" };
    }
  }
  return {
    getMediaToolchainStatus: () => request(`${base}/status`, "GET"),
    selectMediaToolchainDirectory(directory) {
      if (!isNativeMediaToolchainDirectory(directory))
        throw new Error("Media toolchain requires a native absolute directory");
      return request(`${base}/selection`, "PUT", directory);
    },
    clearMediaToolchain: () => request(`${base}/selection`, "DELETE"),
  };
}
