import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import f from "../../../packages/contracts/fixtures/media-preparation.json";
import { createMediaPreparationClient } from "./media-preparation-client";
import { registerMediaPreparationHandlers } from "./media-preparation-ipc";
import {
  MEDIA_PREPARATION_CHANNELS,
  mediaHash,
  mediaCommand,
  type MediaPreparationCommand,
} from "@aijian/contracts/media-preparation";

const command = f.command as MediaPreparationCommand;
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, status = 200) => ({
  status,
  payload: { data, request_id: f.request_id },
  requestId: f.request_id,
});
test("actual SQLite inputs through fixed HTTP; original GET carries only full input hash", async () => {
  const http = vi.fn().mockResolvedValue(response(f.operation, 201));
  const c = createMediaPreparationClient(http, {
    Authorization: "Bearer controlled-non-runtime-header",
  });
  expect((await c.saveMediaPreparation(f.project_id, f.episode_id, command)).kind).toBe("FOUND");
  expect(http.mock.calls[0]![1].method).toBe("POST");
  expect(JSON.parse(http.mock.calls[0]![1].body)).toEqual(command.payload);
  http.mockResolvedValue(response(f.operation));
  expect((await c.getMediaPreparationOperation(f.project_id, f.episode_id, command)).kind).toBe(
    "FOUND",
  );
  const [url, init] = http.mock.calls[1]!;
  expect(init.method).toBe("GET");
  expect(url).toContain(command.operation_id);
  expect(new URL(url, "http://127.0.0.1").searchParams.get("payload_hash")).toBe(f.payload_hash);
  expect(url).not.toContain("prompt");
});
test.each(["header", "hash", "scope", "shot", "schema", "payload", "actor"])(
  "bad recovery receipt remains UNKNOWN: %s",
  async (field) => {
    const data = structuredClone(f.operation);
    let header = f.request_id;
    if (field === "header") header = "bad";
    if (field === "hash") data.version.content_hash = `sha256:${"0".repeat(64)}`;
    if (field === "scope") data.version.content.input.episode_id = `ep_${"f".repeat(32)}`;
    if (field === "shot") data.version.content.snapshot.shot.shot_id = `shp_${"f".repeat(32)}`;
    if (field === "schema") Object.assign(data.version.content.input, { schema_version: "0.9.0" });
    if (field === "payload") data.payload.expected_revision = 999 as never;
    if (field === "actor") Object.assign(data.version, { author_actor_id: "other-actor" });
    const http = vi.fn().mockResolvedValue({ ...response(data), requestId: header });
    expect(
      await createMediaPreparationClient(http, {}).getMediaPreparationOperation(
        f.project_id,
        f.episode_id,
        command,
      ),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(http).toHaveBeenCalledOnce();
    expect(http.mock.calls[0]![1].method).toBe("GET");
  },
);
test.each([
  [404, "MEDIA_PREPARATION_OPERATION_UNKNOWN"],
  [422, "UNRELATED_ERROR"],
  [500, "MEDIA_PREPARATION_INPUT_REJECTED"],
])("unattributed POST failure stays UNKNOWN (%s %s)", async (status, code) => {
  const http = vi.fn().mockResolvedValue({
    status,
    payload: {
      error: { code, message: "controlled", details: {}, retryable: false },
      request_id: f.request_id,
    },
    requestId: f.request_id,
  });
  expect(
    await createMediaPreparationClient(http, {}).saveMediaPreparation(
      f.project_id,
      f.episode_id,
      command,
    ),
  ).toEqual({ kind: "REMOTE_UNKNOWN" });
});

test.each([
  "duplicate characters",
  "blank title",
  "environment without location",
  "visual without library",
])("rehashed but contradictory source snapshot stays UNKNOWN: %s", async (field) => {
  const data = structuredClone(f.operation);
  const snapshot = data.version.content.snapshot;
  if (field === "duplicate characters") {
    Object.assign(snapshot, { creative_library_version_id: `ver_${"a".repeat(32)}` });
    Object.assign(snapshot.shot, {
      character_ids: [`chr_${"a".repeat(32)}`, `chr_${"a".repeat(32)}`],
    });
  }
  if (field === "blank title") snapshot.shot.title = " \t\n";
  if (field === "visual without library") {
    Object.assign(snapshot, {
      storyboard_schema_version: "1.2.0",
      visual_bible_version_id: `ver_${"a".repeat(32)}`,
    });
    Object.assign(snapshot.shot, { character_bindings: [] });
  }
  if (field === "environment without location") {
    Object.assign(snapshot, { storyboard_schema_version: "1.4.0" });
    Object.assign(snapshot.shot, {
      character_bindings: [],
      coverage_notes: "",
      continuity_notes: "",
      transition_notes: "",
      environment_binding: { variant_id: `scv_${"a".repeat(32)}`, reference_ids: [] },
    });
  }
  data.version.content_hash = (await mediaHash(data.version.content))!;
  const http = vi.fn().mockResolvedValue(response(data));
  expect(
    await createMediaPreparationClient(http, {}).getMediaPreparationOperation(
      f.project_id,
      f.episode_id,
      command,
    ),
  ).toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(http).toHaveBeenCalledOnce();
  expect(http.mock.calls[0]![1].method).toBe("GET");
});
test("only exact actual rejection code/status settles failed POST", async () => {
  const http = vi.fn().mockResolvedValue({
    status: 409,
    payload: {
      error: {
        code: "MEDIA_PREPARATION_CONFLICT",
        message: "controlled",
        details: {},
        retryable: false,
      },
      request_id: f.request_id,
    },
    requestId: f.request_id,
  });
  expect(
    (
      await createMediaPreparationClient(http, {}).saveMediaPreparation(
        f.project_id,
        f.episode_id,
        command,
      )
    ).kind,
  ).toBe("DEFINITE_SERVER_ERROR");
});
test("array details in otherwise attributable rejection remain UNKNOWN", async () => {
  const http = vi.fn().mockResolvedValue({
    status: 422,
    payload: {
      error: {
        code: "MEDIA_PREPARATION_INPUT_REJECTED",
        message: "controlled",
        details: [],
        retryable: false,
      },
      request_id: f.request_id,
    },
    requestId: f.request_id,
  });
  expect(
    await createMediaPreparationClient(http, {}).saveMediaPreparation(
      f.project_id,
      f.episode_id,
      command,
    ),
  ).toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(http).toHaveBeenCalledOnce();
});
test.each([
  ["\u001c\u0085", "REMOTE_UNKNOWN"],
  ["\ufeff", "FOUND"],
])("native snapshot nonblank exactly matches stored Python whitespace: %j", async (title, kind) => {
  const data = structuredClone(f.operation);
  data.version.content.snapshot.shot.title = title;
  data.version.content_hash = (await mediaHash(data.version.content))!;
  const http = vi.fn().mockResolvedValue(response(data));
  expect(
    (
      await createMediaPreparationClient(http, {}).getMediaPreparationOperation(
        f.project_id,
        f.episode_id,
        command,
      )
    ).kind,
  ).toBe(kind);
});
test("complete input uses Python blank semantics, including control separators and FEFF", () => {
  const c = structuredClone(command);
  c.payload.input.prompt = "\u001c\u0085";
  expect(mediaCommand(c, f.project_id, f.episode_id)).toBe(false);
  c.payload.input.prompt = "\ufeff";
  expect(mediaCommand(c, f.project_id, f.episode_id)).toBe(true);
});
test("closed page and exact version hashes; alternate episode fails closed", async () => {
  const http = vi.fn().mockResolvedValue(response(f.page));
  const c = createMediaPreparationClient(http, {});
  expect((await c.listMediaPreparations(f.project_id, f.episode_id)).kind).toBe("FOUND");
  expect((await c.listMediaPreparations(f.project_id, `ep_${"f".repeat(32)}`)).kind).toBe(
    "REMOTE_UNKNOWN",
  );
  http.mockResolvedValue(response(f.operation.version));
  expect(
    (await c.getMediaPreparation(f.project_id, f.episode_id, f.operation.version.version_id)).kind,
  ).toBe("FOUND");
});
test("IPC requires exact arguments, scope and authorized top frame before I/O", async () => {
  const listeners = new Map<
    string,
    (e: { top: boolean }, ...args: unknown[]) => Promise<unknown>
  >();
  const client = createMediaPreparationClient(vi.fn().mockResolvedValue(response(f.operation)), {});
  const get = vi.spyOn(client, "getMediaPreparationOperation");
  registerMediaPreparationHandlers<{ top: boolean }>(
    (c, h) => listeners.set(c, h),
    () => client,
    (e) => e.top,
  );
  const original = listeners.get(MEDIA_PREPARATION_CHANNELS.original)!;
  await expect(original({ top: false }, f.project_id, f.episode_id, command)).rejects.toThrow(
    "frame",
  );
  await expect(
    original({ top: true }, f.project_id, f.episode_id, command, "extra"),
  ).rejects.toThrow("scope");
  await expect(
    original({ top: true }, f.project_id, `ep_${"f".repeat(32)}`, command),
  ).rejects.toThrow("command");
  expect(get).not.toHaveBeenCalled();
  expect(
    ((await original({ top: true }, f.project_id, f.episode_id, command)) as { kind: string }).kind,
  ).toBe("FOUND");
});
