import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { nativePreviewPlanResponse } from "@aijian/contracts/native-preview-plan";
import { visualJson } from "@aijian/contracts/visual-bible";
import { createNativePreviewPlanClient } from "./media-preview-plan-client";
import { registerNativePreviewPlanHandler } from "./media-preview-plan-ipc";
import { createUnavailableMediaPreviewHost } from "./media-preview-host";
import { registerMediaPreviewSessionHandlers } from "./media-preview-session-ipc";
import { MEDIA_PREVIEW_CHANNELS } from "./media-preview-session-contract";

const fixture = () =>
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../packages/contracts/fixtures/native-preview-plan.json"),
      "utf8",
    ),
  );
const source = fixture().data.plan.source;
const args = [source.project_id, source.episode_id, source.assembly_version_id] as const;
const requestId = fixture().request_id;
const hash = (plan: unknown) =>
  `sha256:${createHash("sha256").update(visualJson(plan)).digest("hex")}`;

describe("native plan canonical read boundary", () => {
  it("accepts the Python-derived fixture and sends only the exact readonly GET", async () => {
    const receipt = fixture();
    expect(nativePreviewPlanResponse(receipt, ...args, requestId)).toBe(true);
    expect(hash(receipt.data.plan)).toBe(receipt.data.plan_hash);
    const read = vi.fn().mockResolvedValue({ status: 200, payload: receipt, requestId });
    expect(
      await createNativePreviewPlanClient(read, {
        Authorization: "test-only",
      }).getNativeMediaPreviewPlan(...args),
    ).toEqual({ kind: "READY", receipt });
    expect(read).toHaveBeenCalledExactlyOnceWith(
      `/api/v1/projects/${args[0]}/episodes/${args[1]}/media-assembly/versions/${args[2]}/native-preview-plan`,
      { method: "GET", headers: { Authorization: "test-only" } },
    );
  });
  it.each([
    "hash",
    "request",
    "scope",
    "engineering",
    "extra",
    "gap",
    "overflow",
    "audio",
    "subtitle",
    "probe",
    "scale",
    "duplicate",
  ])("rejects %s without retry", async (fault) => {
    const payload = fixture();
    const plan = payload.data.plan;
    const clip = plan.video_tracks[0].clips[0];
    if (fault === "hash") payload.data.plan_hash = "sha256:" + "0".repeat(64);
    if (fault === "request") payload.request_id = "22222222-2222-4222-8222-222222222222";
    if (fault === "scope") plan.source.episode_id = "ep_" + "f".repeat(32);
    if (fault === "engineering") {
      plan.scope = "ENGINEERING_TEST";
      plan.source.origin = "ART04_TEST_SPEC";
    }
    if (fault === "extra") plan.path = "C:/secret";
    if (fault === "gap") clip.start_frame = 1;
    if (fault === "overflow") clip.source_in_frame = Number.MAX_SAFE_INTEGER;
    if (fault === "audio") plan.audio_tracks = [{}];
    if (fault === "subtitle") plan.subtitle_output_mode = "BURN_IN";
    if (fault === "probe") clip.media.probe_sha256 = "bad";
    if (fault === "scale") clip.scale_mode = "FIT";
    if (fault === "duplicate") plan.video_tracks[0].clips.push(structuredClone(clip));
    if (fault !== "hash") payload.data.plan_hash = hash(plan);
    const read = vi.fn().mockResolvedValue({ status: 200, payload, requestId });
    expect(
      await createNativePreviewPlanClient(read, {}).getNativeMediaPreviewPlan(...args),
    ).toEqual({ kind: "UNKNOWN" });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it.each([null, "bad", "different"])(
    "never treats uncorrelated error %s as a refusal",
    async (correlation) => {
      const read = vi.fn().mockResolvedValue({
        status: 409,
        requestId: correlation,
        payload: {
          request_id: correlation,
          error: { code: "MEDIA_NOT_READY", message: "Synthetic", details: {}, retryable: false },
        },
      });
      expect(
        await createNativePreviewPlanClient(read, {}).getNativeMediaPreviewPlan(...args),
      ).toEqual({ kind: "UNKNOWN" });
    },
  );
  it("accepts only correlated definitive refusal and keeps server failure UNKNOWN", async () => {
    const read = vi.fn().mockResolvedValue({
      status: 409,
      requestId,
      payload: {
        request_id: requestId,
        error: { code: "MEDIA_NOT_READY", message: "Synthetic", details: {}, retryable: false },
      },
    });
    const client = createNativePreviewPlanClient(read, {});
    expect(await client.getNativeMediaPreviewPlan(...args)).toEqual({
      kind: "REJECTED",
      code: "MEDIA_NOT_READY",
      status: 409,
    });
    read.mockResolvedValueOnce({ status: 503, requestId, payload: {} });
    expect(await client.getNativeMediaPreviewPlan(...args)).toEqual({ kind: "UNKNOWN" });
    read.mockRejectedValueOnce(new Error("timeout"));
    expect(await client.getNativeMediaPreviewPlan(...args)).toEqual({ kind: "UNKNOWN" });
  });
});

describe("main document native preview IPC", () => {
  it("requires three canonical plan ids and checks authority after the read", async () => {
    let handler!: (event: object, ...args: unknown[]) => Promise<unknown>;
    let finish!: (value: { kind: "UNKNOWN" }) => void;
    const client = {
      getNativeMediaPreviewPlan: vi.fn(
        () =>
          new Promise<{ kind: "UNKNOWN" }>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    let epoch = 0;
    let allowed = true;
    registerNativePreviewPlanHandler(
      (_channel, callback) => {
        handler = callback;
      },
      () => client,
      () => allowed,
      () => epoch,
    );
    await expect(handler({}, ...args, "path")).rejects.toThrow();
    allowed = false;
    await expect(handler({}, ...args)).rejects.toThrow();
    allowed = true;
    expect(client.getNativeMediaPreviewPlan).not.toHaveBeenCalled();
    const pending = handler({}, ...args);
    epoch += 2;
    finish({ kind: "UNKNOWN" });
    await expect(pending).rejects.toThrow("document changed");
  });
  it("registers all existing session channels and never claims an installed host", async () => {
    const handlers = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    registerMediaPreviewSessionHandlers(
      (channel, listener) => handlers.set(channel, listener),
      createUnavailableMediaPreviewHost(),
      () => true,
    );
    expect([...handlers.keys()]).toEqual(Object.values(MEDIA_PREVIEW_CHANNELS));
    const identity = {
      project_id: args[0],
      episode_id: args[1],
      assembly_artifact_id: source.assembly_artifact_id,
      assembly_version_id: args[2],
      assembly_content_hash: source.assembly_content_hash,
      assembly_head_revision: source.assembly_head_revision,
      plan_hash: fixture().data.plan_hash,
    };
    expect(
      await handlers.get(MEDIA_PREVIEW_CHANNELS.open)!(
        {},
        { open_request_id: "pvo_" + "a".repeat(32), identity },
      ),
    ).toEqual({ kind: "UNAVAILABLE", reason: "NATIVE_HOST_NOT_INSTALLED" });
    await expect(
      handlers.get(MEDIA_PREVIEW_CHANNELS.open)!({}, { open_request_id: "bad", identity }),
    ).rejects.toThrow();
  });
  it("does not return a native reply after a document ABA", async () => {
    const handlers = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    let finish!: (value: { kind: "UNKNOWN" }) => void;
    let epoch = 0;
    const host = createUnavailableMediaPreviewHost();
    host.status = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    registerMediaPreviewSessionHandlers(
      (channel, listener) => handlers.set(channel, listener),
      host,
      () => true,
      () => epoch,
    );
    const pending = handlers.get(MEDIA_PREVIEW_CHANNELS.status)!(
      {},
      { open_request_id: "pvo_" + "b".repeat(32) },
    );
    epoch += 2;
    finish({ kind: "UNKNOWN" });
    expect(await pending).toEqual({ kind: "UNKNOWN" });
  });
  it("has actual main/preload bindings without runtime relative imports in sandboxed preload", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
    const preload = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
    expect(main).toContain("registerNativePreviewPlanHandler<IpcMainInvokeEvent>");
    expect(main).toContain("registerMediaPreviewSessionHandlers<IpcMainInvokeEvent>");
    expect(main).toContain('"did-start-navigation"');
    for (const channel of [...Object.values(MEDIA_PREVIEW_CHANNELS), "media-preview:plan"])
      expect(preload).toContain(`"${channel}"`);
    expect(preload).not.toMatch(/import\s+\{[^}]+\}\s+from\s+"\.\//);
  });
});
