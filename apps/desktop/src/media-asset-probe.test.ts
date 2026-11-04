import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import { registerMediaAssetProbeHandlers } from "./media-asset-probe-ipc";
import {
  isMediaAssetProbeEvidenceResponse,
  MEDIA_ASSET_PROBE_CHANNELS,
} from "./media-asset-probe-contract";

const receipt = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../packages/contracts/fixtures/media-asset-probe-evidence.json"),
    "utf8",
  ),
);
const scope: [string, string, string] = [
  receipt.data.project_id,
  receipt.data.asset_id,
  receipt.data.version_id,
];
const response = (payload: unknown, status: number) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": receipt.request_id },
  });
const error = (code: string) => ({
  error: { code, message: "Safe probe status", details: {}, retryable: false },
  request_id: receipt.request_id,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("exact-version native media probe", () => {
  it("decodes actual backend model bytes with prefixed source identity", () => {
    expect(isMediaAssetProbeEvidenceResponse(receipt, ...scope, receipt.request_id)).toBe(true);
    const wrong = structuredClone(receipt);
    wrong.data.probe.source_asset_sha256 = receipt.data.asset_sha256;
    expect(isMediaAssetProbeEvidenceResponse(wrong, ...scope, receipt.request_id)).toBe(false);
    expect(
      isMediaAssetProbeEvidenceResponse(
        receipt,
        scope[0],
        scope[1],
        `asv_${"f".repeat(32)}`,
        receipt.request_id,
      ),
    ).toBe(false);
  });
  it("authenticates exact GET/POST routes with no path-bearing body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(receipt, 200))
      .mockResolvedValueOnce(response(receipt, 201));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43219",
      token: "t".repeat(43),
    });
    expect(await client.getMediaAssetProbeEvidence(...scope)).toEqual({ kind: "FOUND", receipt });
    expect(await client.probeSelectedMediaAssetVersion(...scope)).toEqual({
      kind: "PROBED",
      receipt,
    });
    const path = `http://127.0.0.1:43219/api/v1/projects/${scope[0]}/assets/${scope[1]}/versions/${scope[2]}/probe-evidence`;
    for (const [index, method] of ["GET", "POST"].entries()) {
      expect(fetcher.mock.calls[index]![0]).toBe(path);
      expect(fetcher.mock.calls[index]![1]).toMatchObject({
        method,
        headers: { Authorization: `Bearer ${"t".repeat(43)}`, Origin: "app://aijian" },
      });
      expect(fetcher.mock.calls[index]![1].body).toBeUndefined();
    }
  });
  it("never retries unknown writes and distinguishes only pre-probe tool failure", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost receipt"))
      .mockResolvedValueOnce(response(error("PROBE_NOT_FOUND"), 404))
      .mockResolvedValueOnce(response(error("TOOLCHAIN_UNAVAILABLE"), 503))
      .mockResolvedValueOnce(response(error("PROBE_WRITE_UNKNOWN"), 503));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43219",
      token: "t".repeat(43),
    });
    expect(await client.probeSelectedMediaAssetVersion(...scope)).toEqual({
      kind: "PROBE_UNKNOWN",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await client.getMediaAssetProbeEvidence(...scope)).toMatchObject({
      kind: "DEFINITE_SERVER_ERROR",
      code: "PROBE_NOT_FOUND",
    });
    expect(await client.probeSelectedMediaAssetVersion(...scope)).toMatchObject({
      kind: "DEFINITE_SERVER_ERROR",
      code: "TOOLCHAIN_UNAVAILABLE",
      status: 503,
    });
    expect(await client.probeSelectedMediaAssetVersion(...scope)).toEqual({
      kind: "PROBE_UNKNOWN",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("rejects malformed scope before HTTP and mismatched replies as unknown", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({ ...receipt, request_id: "22222222-2222-4222-8222-222222222222" }, 201),
      );
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43219",
      token: "t".repeat(43),
    });
    await expect(
      client.probeSelectedMediaAssetVersion("../other", scope[1], scope[2]),
    ).rejects.toThrow("canonical");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await client.probeSelectedMediaAssetVersion(...scope)).toEqual({
      kind: "PROBE_UNKNOWN",
    });
  });
  it("registers canonical IPC, suppresses duplicates and discards stale sender results", async () => {
    const handlers = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    let authorized = true;
    const pending = deferred<{ kind: "PROBED"; receipt: typeof receipt }>();
    const client = {
      getMediaAssetProbeEvidence: vi.fn().mockResolvedValue({ kind: "FOUND", receipt }),
      probeSelectedMediaAssetVersion: vi.fn().mockReturnValue(pending.promise),
    };
    registerMediaAssetProbeHandlers(
      (name, fn) => handlers.set(name, fn),
      () => client,
      () => authorized,
    );
    const read = handlers.get(MEDIA_ASSET_PROBE_CHANNELS.get)!;
    const write = handlers.get(MEDIA_ASSET_PROBE_CHANNELS.probe)!;
    await expect(write({}, ...scope, "/injected")).rejects.toThrow("canonical");
    await expect(write({}, scope[0], scope[1], "bad")).rejects.toThrow("canonical");
    const active = write({}, ...scope);
    expect(await write({}, ...scope)).toEqual({ kind: "PROBE_UNKNOWN" });
    expect(client.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1);
    authorized = false;
    pending.resolve({ kind: "PROBED", receipt });
    await expect(active).rejects.toThrow("not authorized");
    await expect(read({}, ...scope)).rejects.toThrow("not authorized");
  });
  it("actual preload exposes exactly the three canonical ids and main registers handlers", () => {
    const compiled = ts.transpileModule(
      readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const surfaces = new Map<string, Record<string, (...args: unknown[]) => unknown>>();
    const invoke = vi.fn();
    runInNewContext(compiled, {
      exports: {},
      require: (name: string) => {
        if (name !== "electron") throw new Error(name);
        return {
          contextBridge: {
            exposeInMainWorld: (
              key: string,
              value: Record<string, (...args: unknown[]) => unknown>,
            ) => surfaces.set(key, value),
          },
          ipcRenderer: { invoke },
        };
      },
    });
    surfaces.get("aijian")!.getMediaAssetProbeEvidence!(...scope, "/ignored");
    expect(invoke).toHaveBeenLastCalledWith(MEDIA_ASSET_PROBE_CHANNELS.get, ...scope);
    surfaces.get("aijian")!.probeSelectedMediaAssetVersion!(...scope, "/ignored");
    expect(invoke).toHaveBeenLastCalledWith(MEDIA_ASSET_PROBE_CHANNELS.probe, ...scope);
    expect(readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8")).toContain(
      "registerMediaAssetProbeHandlers<IpcMainInvokeEvent>(",
    );
  });
});
