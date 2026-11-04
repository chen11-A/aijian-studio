import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import { registerAssemblyReadinessHandler } from "./assembly-readiness-ipc";
import { ASSEMBLY_READINESS_CHANNEL } from "@aijian/contracts/assembly-readiness";
import f from "../../../packages/contracts/fixtures/manual-media-candidate.json";

const target = {
  version_id: f.assembly_operation.version.version_id,
  content_hash: f.assembly_operation.version.content_hash,
};
function receipt() {
  return {
    request_id: f.request_id,
    data: {
      assembly: structuredClone(f.assembly_operation.version),
      is_current_head: true,
      source_checks: [
        { scope: "SCRIPT", status: "NOT_BOUND", code: "SCRIPT_NOT_CONFIRMED" },
        { scope: "STORYBOARD", status: "BLOCKED", code: "STORYBOARD_NOT_APPROVED" },
      ],
      blockers: [
        { code: "PICTURE_LOCK_MISSING", scope: "PICTURE_LOCK", message: "缺少明确画面锁定" },
      ],
      checked_at: "2026-10-11T12:00:00Z",
      picture_lock_status: "NO_PICTURE_LOCK",
      export_status: "NO_EXPORT_CLAIM",
      formal_status: "BLOCKED",
    },
  };
}
function client(body: unknown, status = 200, header = f.request_id) {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { "X-Request-ID": header } }),
    );
  return {
    fetcher,
    api: createLocalApiClient(fetcher, { origin: "http://127.0.0.1:43124", token: "t".repeat(43) }),
  };
}
describe("read-only exact assembly readiness desktop bridge", () => {
  it("uses the actual local API GET with saved scope/version/hash and no request body", async () => {
    const c = client(receipt());
    expect((await c.api.getEpisodeAssemblyReadiness(f.project_id, f.episode_id, target)).kind).toBe(
      "FOUND",
    );
    expect(c.fetcher).toHaveBeenCalledOnce();
    const [url, init] = c.fetcher.mock.calls[0]!;
    expect(url).toBe(
      `http://127.0.0.1:43124/api/v1/projects/${f.project_id}/episodes/${f.episode_id}/media-assembly/versions/${target.version_id}/readiness?expected_content_hash=${encodeURIComponent(target.content_hash)}`,
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });
  it.each([
    "scope",
    "version",
    "hash",
    "approval",
    "duplicate",
    "order",
    "extra",
    "time",
    "geometry",
    "empty-blockers",
    "status-array",
    "scope-array",
    "invalid-date",
    "body-hash",
    "missing-media",
    "foreign-media",
    "media-array",
  ])("rejects %s receipt without dispatching a write", async (kind) => {
    const b = receipt();
    if (kind === "scope") b.data.assembly.content.episode_id = `ep_${"b".repeat(32)}`;
    if (kind === "version") b.data.assembly.version_id = `ver_${"b".repeat(32)}`;
    if (kind === "hash") b.data.assembly.content_hash = `sha256:${"b".repeat(64)}`;
    if (kind === "approval") b.data.formal_status = "APPROVED";
    if (kind === "duplicate") b.data.source_checks[1]!.scope = "SCRIPT";
    if (kind === "order") b.data.source_checks.reverse();
    if (kind === "extra") Object.assign(b.data, { approved: true });
    if (kind === "time") b.data.checked_at = "2026-10-11T12:00:00+08:00";
    if (kind === "geometry") b.data.assembly.content.visual_segments[0]!.end_frame = 0;
    if (kind === "empty-blockers") b.data.blockers = [];
    if (kind === "status-array") Object.assign(b.data.source_checks[0]!, { status: ["CURRENT"] });
    if (kind === "scope-array") Object.assign(b.data.blockers[0]!, { scope: ["PICTURE_LOCK"] });
    if (kind === "invalid-date") b.data.checked_at = "2026-02-30T12:00:00Z";
    if (kind === "body-hash") b.data.assembly.content.canvas_width = 161;
    if (kind === "missing-media") b.data.assembly.media_checks = [];
    if (kind === "foreign-media")
      b.data.assembly.media_checks[0]!.media.asset_version_id = `asv_${"b".repeat(32)}`;
    if (kind === "media-array")
      Object.assign(b.data.assembly.media_checks[0]!, { availability: ["VERIFIED"] });
    const c = client(b);
    expect(await c.api.getEpisodeAssemblyReadiness(f.project_id, f.episode_id, target)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(c.fetcher).toHaveBeenCalledOnce();
    expect(c.fetcher.mock.calls[0]![1].method).toBe("GET");
  });
  it("rejects mismatched request header, conflict, disconnect, and invalid target without retry", async () => {
    for (const c of [
      client(receipt(), 200, "00000000-0000-4000-8000-000000000001"),
      client(receipt(), 409),
    ]) {
      expect(await c.api.getEpisodeAssemblyReadiness(f.project_id, f.episode_id, target)).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      expect(c.fetcher).toHaveBeenCalledOnce();
    }
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    const api = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    expect(await api.getEpisodeAssemblyReadiness(f.project_id, f.episode_id, target)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(
      api.getEpisodeAssemblyReadiness(f.project_id, f.episode_id, {
        ...target,
        content_hash: "invalid",
      }),
    ).rejects.toThrow("exact scoped");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("authorizes the exact fixed IPC before selecting a client and rejects extra args or fields", async () => {
    const handlers = new Map<string, (e: boolean, ...args: unknown[]) => Promise<unknown>>();
    const c = client(receipt()),
      clientFor = vi.fn(() => c.api);
    registerAssemblyReadinessHandler<boolean>(
      (name, handler) => handlers.set(name, handler),
      clientFor,
      Boolean,
    );
    const read = handlers.get(ASSEMBLY_READINESS_CHANNEL)!;
    await expect(read(false, f.project_id, f.episode_id, target)).rejects.toThrow("not authorized");
    await expect(read(true, f.project_id, f.episode_id, target, true)).rejects.toThrow(
      "exact scoped",
    );
    await expect(
      read(true, f.project_id, f.episode_id, { ...target, approved: true }),
    ).rejects.toThrow("exact scoped");
    expect(clientFor).not.toHaveBeenCalled();
    expect(c.fetcher).not.toHaveBeenCalled();
    expect(((await read(true, f.project_id, f.episode_id, target)) as { kind: string }).kind).toBe(
      "FOUND",
    );
    expect([...handlers.keys()]).toEqual([ASSEMBLY_READINESS_CHANNEL]);
  });
  it("exposes only the fixed read call through the real sandbox preload", async () => {
    const source = readFileSync(resolve(__dirname, "preload.ts"), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    let bridge: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    const invoke = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    runInNewContext(js, {
      exports: {},
      require: (name: string) => {
        if (name !== "electron") throw new Error(`Unexpected preload import ${name}`);
        return {
          contextBridge: {
            exposeInMainWorld: (_name: string, value: typeof bridge) => {
              bridge = value;
            },
          },
          ipcRenderer: { invoke },
        };
      },
    });
    await bridge.getEpisodeAssemblyReadiness!(f.project_id, f.episode_id, target);
    expect(invoke).toHaveBeenCalledWith(
      ASSEMBLY_READINESS_CHANNEL,
      f.project_id,
      f.episode_id,
      target,
    );
    expect(bridge.invoke).toBeUndefined();
  });
});
