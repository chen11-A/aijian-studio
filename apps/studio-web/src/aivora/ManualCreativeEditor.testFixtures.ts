import { vi } from "vitest";
import { cloneCreativeContent } from "./adapters/creativeLibrary";
import type { CreativeGateway, CreativeVersion } from "./adapters/creativeLibrary";

export const project = `prj_${"a".repeat(32)}`;
export const other = `prj_${"b".repeat(32)}`;
export const requestId = "123e4567-e89b-42d3-a456-426614174000";
export function makeGateway() {
  const heads = new Map<string, CreativeVersion>();
  const versions = new Map<string, CreativeVersion>();
  const operations = new Map<string, CreativeVersion>();
  let number = 0;
  const api: CreativeGateway = {
    getProjectCreativeLibrary: vi.fn<CreativeGateway["getProjectCreativeLibrary"]>(async (id) => {
      const current = heads.get(id);
      return current
        ? { kind: "FOUND", receipt: { data: current, request_id: requestId } }
        : { kind: "EMPTY" };
    }),
    getProjectCreativeLibraryVersion: vi.fn<CreativeGateway["getProjectCreativeLibraryVersion"]>(
      async (_id, versionId) => {
        const saved = versions.get(versionId);
        return saved
          ? { kind: "FOUND", receipt: { data: saved, request_id: requestId } }
          : { kind: "REMOTE_UNKNOWN" };
      },
    ),
    createProjectCreativeLibraryVersion: vi.fn<
      CreativeGateway["createProjectCreativeLibraryVersion"]
    >(async (id, operationId, payload) => {
      const existing = operations.get(operationId);
      if (existing)
        return {
          kind: "CREATED",
          receipt: { data: { version: existing, replayed: true }, request_id: requestId },
        };
      const count = (heads.get(id)?.head_revision ?? 0) + 1;
      const saved: CreativeVersion = {
        project_id: id,
        episode_id: null,
        version_id: `ver_${(++number).toString(16).padStart(32, "0")}`,
        version_number: count,
        head_revision: count,
        parent_version_id: payload.parent_version_id,
        content: cloneCreativeContent(payload.content),
        content_hash: `sha256:${number.toString(16).padStart(64, "0")}`,
        author_actor_id: "local-user",
        change_summary: payload.change_summary,
        created_at: "2026-10-08T03:00:00Z",
      };
      heads.set(id, saved);
      versions.set(saved.version_id, saved);
      operations.set(operationId, saved);
      return {
        kind: "CREATED",
        receipt: { data: { version: saved, replayed: false }, request_id: requestId },
      };
    }),
  };
  return { api, heads, versions };
}
