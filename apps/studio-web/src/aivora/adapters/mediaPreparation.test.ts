import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import f from "../../../../../packages/contracts/fixtures/media-preparation.json";
import {
  readPreparationJournal,
  preservePreparationJournal,
  savePreparation,
  recoverPreparation,
} from "./mediaPreparation";
import type {
  MediaPreparationCommand,
  MediaPreparationGateway,
  MediaPreparationOperation,
} from "@aijian/contracts/media-preparation";

const command = f.command as MediaPreparationCommand,
  operation = f.operation as MediaPreparationOperation;
const key = `aivora.media-preparation.pending.v1.${f.project_id}.${f.episode_id}`;
function gateway() {
  return {
    saveMediaPreparation: vi
      .fn<MediaPreparationGateway["saveMediaPreparation"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: operation, request_id: f.request_id } }),
    getMediaPreparationOperation: vi
      .fn<MediaPreparationGateway["getMediaPreparationOperation"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: operation, request_id: f.request_id } }),
  } as unknown as MediaPreparationGateway;
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());
test("original intent is persisted before single POST and duplicate pending cannot POST", async () => {
  const api = gateway();
  vi.mocked(api.saveMediaPreparation).mockImplementation(async () => {
    expect(readPreparationJournal(localStorage, f.project_id, f.episode_id).kind).toBe("PENDING");
    return { kind: "REMOTE_UNKNOWN" };
  });
  expect((await savePreparation(api, localStorage, command)).kind).toBe("UNKNOWN");
  expect((await savePreparation(api, localStorage, command)).kind).toBe("UNKNOWN");
  expect(api.saveMediaPreparation).toHaveBeenCalledOnce();
});
test("missing journal restores owned intent; only GET recovers actual original", async () => {
  const api = gateway();
  preservePreparationJournal(localStorage, command);
  localStorage.removeItem(key);
  expect((await recoverPreparation(api, localStorage, command)).kind).toBe("SAVED");
  expect(api.getMediaPreparationOperation).toHaveBeenCalledExactlyOnceWith(
    f.project_id,
    f.episode_id,
    command,
  );
  expect(api.saveMediaPreparation).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBeNull();
});
test("same UUID changed payload is retained and never queried/deleted as original", async () => {
  const api = gateway(),
    other = {
      ...command,
      payload: { ...command.payload, input: { ...command.payload.input, prompt: "replacement" } },
    };
  localStorage.setItem(key, JSON.stringify(other));
  expect((await recoverPreparation(api, localStorage, command)).kind).toBe("UNKNOWN");
  expect(api.getMediaPreparationOperation).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(other);
});
test("valid original cannot close a replace-during-GET journal", async () => {
  const api = gateway();
  preservePreparationJournal(localStorage, command);
  const other = { ...command, payload: { ...command.payload, expected_revision: 999 } };
  vi.mocked(api.getMediaPreparationOperation).mockImplementation(async () => {
    localStorage.setItem(key, JSON.stringify(other));
    return { kind: "FOUND", receipt: { data: operation, request_id: f.request_id } };
  });
  expect((await recoverPreparation(api, localStorage, command)).kind).toBe("UNKNOWN");
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(other);
});
test("remove no-op and obsolete ABA epoch preserve UNKNOWN", async () => {
  const api = gateway();
  preservePreparationJournal(localStorage, command);
  const s = {
    getItem: (k: string) => localStorage.getItem(k),
    setItem: (k: string, v: string) => localStorage.setItem(k, v),
    removeItem: vi.fn(),
  };
  expect((await recoverPreparation(api, s, command)).kind).toBe("UNKNOWN");
  expect(s.removeItem).toHaveBeenCalledOnce();
  expect((await recoverPreparation(api, localStorage, command, () => false)).kind).toBe("UNKNOWN");
  expect(localStorage.getItem(key)).not.toBeNull();
});
test.each(["wrong-hash", "old-schema", "unattributed-4xx"])(
  "bad evidence cannot settle owned pending input: %s",
  async (field) => {
    const api = gateway();
    preservePreparationJournal(localStorage, command);
    if (field === "unattributed-4xx") {
      vi.mocked(api.getMediaPreparationOperation).mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status: 404,
        code: "MEDIA_PREPARATION_OPERATION_UNKNOWN",
        request_id: f.request_id,
      } as never);
    } else {
      const bad = structuredClone(operation);
      if (field === "wrong-hash") bad.version.content_hash = `sha256:${"0".repeat(64)}`;
      else Object.assign(bad.version.content, { schema_version: "0.9.0" });
      vi.mocked(api.getMediaPreparationOperation).mockResolvedValue({
        kind: "FOUND",
        receipt: { data: bad, request_id: f.request_id },
      });
    }
    expect((await recoverPreparation(api, localStorage, command)).kind).toBe("UNKNOWN");
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(api.saveMediaPreparation).not.toHaveBeenCalled();
  },
);
