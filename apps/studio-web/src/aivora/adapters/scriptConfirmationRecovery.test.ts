import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import f from "../../../../../packages/contracts/fixtures/script-confirmation-impact.json";
import {
  closeConfirmationJournal,
  preserveConfirmationJournal,
  readConfirmationJournal,
  recoverScriptConfirmation,
  type PendingConfirmation,
} from "./episodeScript";
import type {
  ScriptConfirmationOperation,
  ScriptImpactGateway,
} from "@aijian/contracts/script-confirmation-impact";

const pending: PendingConfirmation = {
  project_id: f.project_id,
  episode_id: f.episode_id,
  operation_id: f.operation_id,
  payload: { ...f.payload, confirm: true },
};
const key = `aivora.episode-script.confirmation.pending.v1.${f.project_id}.${f.episode_id}`;
const operation = f.operation as ScriptConfirmationOperation;
function gateway() {
  return {
    getEpisodeScriptConfirmationOperation: vi
      .fn<ScriptImpactGateway["getEpisodeScriptConfirmationOperation"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: operation, request_id: f.request_id } }),
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe("original confirmation attribution with durable intent", () => {
  test("actual stored source report resolves original full input and clears only its journal", async () => {
    expect(preserveConfirmationJournal(localStorage, pending)).toBe(true);
    const api = gateway();
    expect((await recoverScriptConfirmation(api, localStorage, pending)).kind).toBe("RECOVERED");
    expect(api.getEpisodeScriptConfirmationOperation).toHaveBeenCalledExactlyOnceWith(
      f.project_id,
      f.episode_id,
      f.operation_id,
      pending.payload,
    );
    expect(readConfirmationJournal(localStorage, f.project_id, f.episode_id).kind).toBe("EMPTY");
  });
  test("missing durable journal restores owned original before UNKNOWN GET", async () => {
    preserveConfirmationJournal(localStorage, pending);
    localStorage.removeItem(key);
    const api = gateway();
    api.getEpisodeScriptConfirmationOperation.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    expect(await recoverScriptConfirmation(api, localStorage, pending)).toEqual({
      kind: "UNKNOWN",
    });
    expect(readConfirmationJournal(localStorage, f.project_id, f.episode_id)).toEqual({
      kind: "PENDING",
      pending,
    });
  });
  test("same UUID with changed full payload is retained and cannot be deleted or queried as original", async () => {
    const replacement = {
      ...pending,
      payload: {
        ...pending.payload,
        expected_head_revision: pending.payload.expected_head_revision + 1,
      },
    };
    localStorage.setItem(key, JSON.stringify(replacement));
    const api = gateway();
    expect(await recoverScriptConfirmation(api, localStorage, pending)).toEqual({
      kind: "UNKNOWN",
    });
    expect(api.getEpisodeScriptConfirmationOperation).not.toHaveBeenCalled();
    expect(closeConfirmationJournal(localStorage, f.project_id, f.episode_id, pending)).toBe(false);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(replacement);
  });
  test("replacement while GET is pending survives a valid original response", async () => {
    preserveConfirmationJournal(localStorage, pending);
    const api = gateway();
    api.getEpisodeScriptConfirmationOperation.mockImplementation(async () => {
      localStorage.setItem(
        key,
        JSON.stringify({
          ...pending,
          payload: { ...pending.payload, expected_content_hash: `sha256:${"0".repeat(64)}` },
        }),
      );
      return { kind: "FOUND", receipt: { data: operation, request_id: f.request_id } };
    });
    expect(await recoverScriptConfirmation(api, localStorage, pending)).toEqual({
      kind: "UNKNOWN",
    });
    expect(JSON.parse(localStorage.getItem(key)!).payload.expected_content_hash).toBe(
      `sha256:${"0".repeat(64)}`,
    );
  });
  test("remove no-op keeps UNKNOWN after exact success and hash verification", async () => {
    preserveConfirmationJournal(localStorage, pending);
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: vi.fn(),
    };
    expect(await recoverScriptConfirmation(gateway(), storage, pending)).toEqual({
      kind: "UNKNOWN",
    });
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(readConfirmationJournal(localStorage, f.project_id, f.episode_id).kind).toBe("PENDING");
  });
  test("A → B → A older completion cannot settle the newer generation", async () => {
    preserveConfirmationJournal(localStorage, pending);
    let generation = 1;
    let resolve!: (
      result: Awaited<ReturnType<ScriptImpactGateway["getEpisodeScriptConfirmationOperation"]>>,
    ) => void;
    const api = gateway();
    api.getEpisodeScriptConfirmationOperation.mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    const recovery = recoverScriptConfirmation(
      api,
      localStorage,
      pending,
      undefined,
      () => generation === 1,
    );
    generation = 3;
    resolve({ kind: "FOUND", receipt: { data: operation, request_id: f.request_id } });
    expect(await recovery).toEqual({ kind: "UNKNOWN" });
    expect(readConfirmationJournal(localStorage, f.project_id, f.episode_id).kind).toBe("PENDING");
  });
  test.each(["hash", "actor", "payload", "source", "old-schema"])(
    "bad evidence preserves UNKNOWN: %s",
    async (field) => {
      preserveConfirmationJournal(localStorage, pending);
      const bad = structuredClone(operation);
      if (field === "hash") bad.lookup.report!.assessment_hash = `sha256:${"0".repeat(64)}`;
      if (field === "actor") bad.lookup.confirmation.actor_id = "other-actor";
      if (field === "payload") bad.payload.expected_head_revision += 1;
      if (field === "source") bad.lookup.confirmation.content_hash = `sha256:${"0".repeat(64)}`;
      if (field === "old-schema")
        Object.assign(bad.lookup.report!.assessment, { schema_version: "0.9.0" });
      const api = gateway();
      api.getEpisodeScriptConfirmationOperation.mockResolvedValue({
        kind: "FOUND",
        receipt: { data: bad, request_id: f.request_id },
      });
      expect(await recoverScriptConfirmation(api, localStorage, pending)).toEqual({
        kind: "UNKNOWN",
      });
      expect(readConfirmationJournal(localStorage, f.project_id, f.episode_id).kind).toBe(
        "PENDING",
      );
    },
  );
});
