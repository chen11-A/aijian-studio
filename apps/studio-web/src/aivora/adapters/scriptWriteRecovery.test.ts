import { createHash, webcrypto } from "node:crypto";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import {
  preserveScriptJournal,
  readScriptJournal,
  recoverScriptWrite,
  saveScriptVersion,
  type PendingScriptWrite,
  type ScriptGateway,
  type ScriptVersion,
} from "./episodeScript";
const project = `prj_${"1".repeat(32)}`;
const episode = `ep_${"2".repeat(32)}`;
const operation = "11111111-1111-4111-8111-111111111111";
const key = `aivora.episode-script.pending.v1.${project}.${episode}`;
const hash = (v: unknown) =>
  `sha256:${createHash("sha256").update(impactCanonical(v)).digest("hex")}`;
function intent(): PendingScriptWrite {
  return {
    project_id: project,
    episode_id: episode,
    command: {
      operation_id: operation,
      payload: {
        parent_version_id: `ver_${"3".repeat(32)}`,
        expected_revision: 1,
        change_summary: "Original full request",
        content: {
          schema_version: "1.0.0",
          project_id: project,
          episode_id: episode,
          production_brief_version_id: null,
          story_bible_version_id: null,
          source_extraction_version_id: null,
          source_proposal_acceptance_id: null,
          scenes: [
            {
              scene_id: `scn_${"4".repeat(32)}`,
              ordinal: 1,
              heading: "Scene",
              blocks: [
                {
                  block_id: `sblk_${"5".repeat(32)}`,
                  ordinal: 1,
                  kind: "ACTION",
                  text: "完整正文 😀",
                  speaker: null,
                  delivery: null,
                },
              ],
            },
          ],
        },
      },
    },
  };
}
function evidence(pending = intent()) {
  const payload = pending.command.payload;
  const version: ScriptVersion = {
    version_id: `ver_${"6".repeat(32)}`,
    project_id: project,
    episode_id: episode,
    version_number: 2,
    head_revision: 3,
    parent_version_id: payload.parent_version_id,
    content: structuredClone(payload.content),
    content_hash: hash(payload.content),
    author_actor_id: "local-user",
    change_summary: payload.change_summary,
    created_at: "2026-10-11T00:00:00Z",
  };
  return {
    operation_id: operation,
    project_id: project,
    episode_id: episode,
    idempotency_key_hash: hash({ value: operation }),
    request_hash: hash({
      project_id: project,
      episode_id: episode,
      actor_id: version.author_actor_id,
      payload,
    }),
    version,
  };
}
function gateway(data = evidence()) {
  return {
    getEpisodeScript: vi
      .fn<ScriptGateway["getEpisodeScript"]>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    createEpisodeScriptVersion: vi
      .fn<ScriptGateway["createEpisodeScriptVersion"]>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getEpisodeScriptWriteOperation: vi
      .fn<NonNullable<ScriptGateway["getEpisodeScriptWriteOperation"]>>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data, request_id: operation } }),
    getEpisodeScriptVersion: vi.fn<ScriptGateway["getEpisodeScriptVersion"]>().mockResolvedValue({
      kind: "FOUND",
      receipt: { data: structuredClone(data.version), request_id: operation },
    }),
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

test("original complete request and immutable version recover by GET while current head is later", async () => {
  const pending = intent();
  preserveScriptJournal(localStorage, pending);
  const api = gateway();
  expect(await recoverScriptWrite(api, localStorage, pending)).toMatchObject({
    kind: "SAVED",
    version: { version_number: 2, head_revision: 3 },
  });
  expect(api.getEpisodeScriptWriteOperation).toHaveBeenCalledWith(
    project,
    episode,
    operation,
    pending.command.payload,
  );
  expect(api.getEpisodeScriptVersion).toHaveBeenCalledWith(
    project,
    episode,
    evidence().version.version_id,
  );
  expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
  expect(readScriptJournal(localStorage, project, episode)).toEqual({ kind: "EMPTY" });
});
test.each([
  "operation",
  "project",
  "episode",
  "key_hash",
  "request_hash",
  "body",
  "content_hash",
  "parent",
  "revision",
  "actor",
  "summary",
  "extra",
])("original evidence mismatch %s preserves exact pending bytes", async (damage) => {
  const pending = intent();
  preserveScriptJournal(localStorage, pending);
  const raw = localStorage.getItem(key);
  const data = evidence();
  if (damage === "operation") data.operation_id = "22222222-2222-4222-8222-222222222222";
  if (damage === "project") data.project_id = `prj_${"9".repeat(32)}`;
  if (damage === "episode") data.episode_id = `ep_${"9".repeat(32)}`;
  if (damage === "key_hash") data.idempotency_key_hash = hash({ value: "wrong" });
  if (damage === "request_hash") data.request_hash = hash({ wrong: true });
  if (damage === "body") data.version.content.scenes[0]!.blocks[0]!.text = "Other body";
  if (damage === "content_hash") data.version.content_hash = hash({ wrong: true });
  if (damage === "parent") data.version.parent_version_id = null;
  if (damage === "revision") data.version.version_number = 3;
  if (damage === "actor") data.version.author_actor_id = "other-user";
  if (damage === "summary") data.version.change_summary = "Other summary";
  if (damage === "extra") Object.assign(data, { executed: false });
  const api = gateway(data);
  expect(await recoverScriptWrite(api, localStorage, pending)).toEqual({ kind: "UNKNOWN" });
  expect(localStorage.getItem(key)).toBe(raw);
  expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
});
test.each([404, 401, 403, 500, "throw", "malformed", "unavailable"])(
  "GET %s cannot close or resend UNKNOWN",
  async (fault) => {
    const pending = intent();
    preserveScriptJournal(localStorage, pending);
    const raw = localStorage.getItem(key);
    const api = gateway();
    if (fault === "throw")
      api.getEpisodeScriptWriteOperation.mockRejectedValue(new Error("Read failed"));
    else if (fault === "unavailable") Reflect.deleteProperty(api, "getEpisodeScriptWriteOperation");
    else api.getEpisodeScriptWriteOperation.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    expect(await recoverScriptWrite(api, localStorage, pending)).toEqual({ kind: "UNKNOWN" });
    expect(localStorage.getItem(key)).toBe(raw);
    expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
  },
);
test.each(["scope", "same-ID-body", "missing"])(
  "late original GET cannot clear %s journal or another scope",
  async (race) => {
    const pending = intent();
    preserveScriptJournal(localStorage, pending);
    const api = gateway();
    let active = true;
    api.getEpisodeScriptWriteOperation.mockImplementation(async () => {
      if (race === "scope") active = false;
      if (race === "same-ID-body") {
        const replacement = intent();
        replacement.command.payload.change_summary = "Replacement";
        localStorage.setItem(key, JSON.stringify(replacement));
      }
      if (race === "missing") localStorage.removeItem(key);
      return { kind: "FOUND", receipt: { data: evidence(), request_id: operation } };
    });
    expect(await recoverScriptWrite(api, localStorage, pending, () => active)).toEqual({
      kind: "UNKNOWN",
    });
    if (race === "missing") expect(preserveScriptJournal(localStorage, pending)).toBe(true);
    expect(readScriptJournal(localStorage, project, episode).kind).toBe("PENDING");
    expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
  },
);
test("second immutable read drift and cleanup failure preserve UNKNOWN", async () => {
  const pending = intent();
  preserveScriptJournal(localStorage, pending);
  const api = gateway();
  const bad = evidence().version;
  bad.change_summary = "Drift";
  api.getEpisodeScriptVersion.mockResolvedValue({
    kind: "FOUND",
    receipt: { data: bad, request_id: operation },
  });
  expect(await recoverScriptWrite(api, localStorage, pending)).toEqual({ kind: "UNKNOWN" });
  api.getEpisodeScriptVersion.mockResolvedValue({
    kind: "FOUND",
    receipt: { data: evidence().version, request_id: operation },
  });
  const storage = {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: localStorage.setItem.bind(localStorage),
    removeItem: () => {
      throw new Error("Quota");
    },
  };
  expect(await recoverScriptWrite(api, storage, pending)).toEqual({ kind: "UNKNOWN" });
  expect(readScriptJournal(localStorage, project, episode).kind).toBe("PENDING");
});
test("save snapshots the body and stale completed POST cannot settle a new scope", async () => {
  const pending = intent();
  const api = gateway();
  let active = true;
  api.createEpisodeScriptVersion.mockImplementation(async (_p, _e, _op, payload) => {
    pending.command.payload.change_summary = "Mutation after dispatch";
    active = false;
    expect(payload.change_summary).toBe("Original full request");
    return {
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "SCRIPT_CONFLICT",
      request_id: operation,
    };
  });
  expect(
    await saveScriptVersion(api, localStorage, project, episode, pending.command, {
      canFinalize: () => active,
    }),
  ).toEqual({ kind: "UNKNOWN" });
  expect(readScriptJournal(localStorage, project, episode)).toMatchObject({
    kind: "PENDING",
    pending: { command: { payload: { change_summary: "Original full request" } } },
  });
  expect(api.createEpisodeScriptVersion).toHaveBeenCalledTimes(1);
});
test("unrelated rejection code cannot end the original write intent", async () => {
  const api = gateway();
  api.createEpisodeScriptVersion.mockResolvedValue({
    kind: "DEFINITE_SERVER_ERROR",
    status: 409,
    code: "OTHER_CONFLICT",
    request_id: operation,
  });
  expect(await saveScriptVersion(api, localStorage, project, episode, intent().command)).toEqual({
    kind: "UNKNOWN",
  });
  expect(readScriptJournal(localStorage, project, episode).kind).toBe("PENDING");
});

test("invalid revision cannot be coerced by the pending JSON snapshot", async () => {
  const api = gateway();
  const invalid = intent().command;
  invalid.payload.parent_version_id = null;
  invalid.payload.expected_revision = Number.NaN;
  expect(await saveScriptVersion(api, localStorage, project, episode, invalid)).toMatchObject({
    kind: "BLOCKED",
  });
  expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBeNull();
});
