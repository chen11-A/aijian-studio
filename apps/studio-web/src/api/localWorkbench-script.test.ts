import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { localWorkbenchTransport } from "./localWorkbench";
import type { ScriptVersion, ScriptWriteCommand } from "../aivora/adapters/episodeScript";

const projectId = `prj_${"a".repeat(32)}`;
const episodeId = `ep_${"b".repeat(32)}`;
const versionId = `ver_${"c".repeat(32)}`;
const hash = `sha256:${"d".repeat(64)}`;
const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const base = `/api/v1/projects/${projectId}/episodes/${episodeId}/script`;
const transport = localWorkbenchTransport();
const fetchMock = vi.fn<typeof fetch>();
function draft(): ScriptWriteCommand["payload"] {
  return {
    content: {
      schema_version: "1.0.0",
      project_id: projectId,
      episode_id: episodeId,
      production_brief_version_id: null,
      story_bible_version_id: null,
      source_extraction_version_id: null,
      source_proposal_acceptance_id: null,
      scenes: [
        {
          scene_id: `scn_${"e".repeat(32)}`,
          ordinal: 1,
          heading: "合成测试场景",
          blocks: [
            {
              block_id: `sblk_${"1".repeat(32)}`,
              ordinal: 1,
              kind: "ACTION",
              text: "海边。",
              speaker: null,
              delivery: null,
            },
            {
              block_id: `sblk_${"2".repeat(32)}`,
              ordinal: 2,
              kind: "DIALOGUE",
              text: "信到了。",
              speaker: "甲",
              delivery: "ON_SCREEN",
            },
            {
              block_id: `sblk_${"3".repeat(32)}`,
              ordinal: 3,
              kind: "DIALOGUE",
              text: "等我。",
              speaker: "乙",
              delivery: "OFF_SCREEN",
            },
          ],
        },
      ],
    },
    parent_version_id: null,
    expected_revision: null,
    change_summary: "合成测试草稿",
  };
}
function version(payload = draft()): ScriptVersion {
  return {
    version_id: versionId,
    project_id: projectId,
    episode_id: episodeId,
    version_number: 1,
    head_revision: (payload.expected_revision ?? 0) + 1,
    parent_version_id: payload.parent_version_id,
    content: payload.content,
    content_hash: hash,
    author_actor_id: "synthetic-user",
    change_summary: payload.change_summary,
    created_at: "2026-09-14T00:00:00Z",
  };
}
function reply(data: unknown, etag: string, status = 200) {
  return Response.json(
    { data, request_id: requestId },
    {
      status,
      headers: {
        "X-Request-ID": requestId,
        ETag: `"${etag}"`,
      },
    },
  );
}
function rejection(status: number, code: string) {
  return Response.json(
    {
      request_id: requestId,
      error: {
        code,
        message: "rejected",
        retryable: false,
        details: {},
      },
    },
    { status, headers: { "X-Request-ID": requestId } },
  );
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("script read identity", () => {
  test.each([false, true])("reads latest or immutable version: %s", async (immutable) => {
    const data = version();
    fetchMock.mockResolvedValue(reply(data, immutable ? hash : "revision-1"));
    expect(
      await (immutable
        ? transport.getEpisodeScriptVersion(projectId, episodeId, versionId)
        : transport.getEpisodeScript(projectId, episodeId)),
    ).toEqual({ kind: "FOUND", receipt: { data, request_id: requestId } });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${base}${immutable ? `/versions/${versionId}` : ""}`,
      expect.objectContaining({ method: "GET" }),
    );
  });
  test("only a verified latest SCRIPT_NOT_FOUND establishes EMPTY", async () => {
    fetchMock.mockImplementation(async () => rejection(404, "SCRIPT_NOT_FOUND"));
    expect(await transport.getEpisodeScript(projectId, episodeId)).toEqual({ kind: "EMPTY" });
    expect(await transport.getEpisodeScriptVersion(projectId, episodeId, versionId)).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 404,
      code: "SCRIPT_NOT_FOUND",
      request_id: requestId,
    });
  });
  test.each([
    { project_id: `prj_${"f".repeat(32)}` },
    { episode_id: `ep_${"f".repeat(32)}` },
    { parent_version_id: "bad" },
    { author_actor_id: " " },
    { change_summary: " " },
    { created_at: "invalid" },
    { extra: true },
  ])("rejects inconsistent version data: %j", async (patch) => {
    fetchMock.mockResolvedValue(reply({ ...version(), ...patch }, "revision-1"));
    expect(await transport.getEpisodeScript(projectId, episodeId)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
  test("binds immutable reads to version id and content ETag", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(version(), hash))
      .mockResolvedValueOnce(reply(version(), "revision-1"));
    expect(
      await transport.getEpisodeScriptVersion(projectId, episodeId, `ver_${"f".repeat(32)}`),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await transport.getEpisodeScriptVersion(projectId, episodeId, versionId)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
});

describe("script writes", () => {
  test.each([false, true])(
    "preserves original operation identity and replay flag %s",
    async (replayed) => {
      const payload = draft();
      payload.parent_version_id = `ver_${"f".repeat(32)}`;
      payload.expected_revision = 4;
      const data = { version: version(payload), replayed };
      fetchMock.mockResolvedValue(reply(data, "revision-5", 201));
      expect(
        await transport.createEpisodeScriptVersion(projectId, episodeId, "original-key", payload),
      ).toEqual({ kind: "CREATED", receipt: { data, request_id: requestId } });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${base}/versions`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(payload),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Idempotency-Key": "original-key",
          },
        }),
      );
    },
  );
  test.each<[string, (payload: ScriptWriteCommand["payload"]) => void]>([
    [
      "unpaired parent and revision",
      (payload) => {
        payload.expected_revision = 1;
      },
    ],
    [
      "unpaired source acceptance",
      (payload) => {
        payload.content.source_extraction_version_id = versionId;
      },
    ],
    [
      "cross-project content",
      (payload) => {
        payload.content.project_id = `prj_${"f".repeat(32)}`;
      },
    ],
    [
      "out-of-order scene",
      (payload) => {
        payload.content.scenes[0]!.ordinal = 2;
      },
    ],
    [
      "duplicate scene",
      (payload) => {
        payload.content.scenes.push({ ...payload.content.scenes[0]!, ordinal: 2 });
      },
    ],
    [
      "out-of-order block",
      (payload) => {
        payload.content.scenes[0]!.blocks[0]!.ordinal = 2;
      },
    ],
    [
      "duplicate block",
      (payload) => {
        payload.content.scenes[0]!.blocks[1]!.block_id =
          payload.content.scenes[0]!.blocks[0]!.block_id;
      },
    ],
    [
      "spoken ACTION",
      (payload) => {
        payload.content.scenes[0]!.blocks[0]!.speaker = "甲";
      },
    ],
    [
      "speakerless DIALOGUE",
      (payload) => {
        payload.content.scenes[0]!.blocks[1]!.speaker = null;
      },
    ],
    [
      "undeliverable DIALOGUE",
      (payload) => {
        payload.content.scenes[0]!.blocks[1]!.delivery = null;
      },
    ],
    [
      "empty block",
      (payload) => {
        payload.content.scenes[0]!.blocks[0]!.text = " ";
      },
    ],
  ])("rejects %s before HTTP", async (_label, change) => {
    const payload = draft();
    change(payload);
    await expect(
      transport.createEpisodeScriptVersion(projectId, episodeId, "original-key", payload),
    ).rejects.toThrow("Invalid script write identity or payload");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each(["", "key with space", "a".repeat(241), "中文"])(
    "rejects invalid operation identity %s",
    async (key) => {
      await expect(
        transport.createEpisodeScriptVersion(projectId, episodeId, key, draft()),
      ).rejects.toThrow("Invalid script");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  test("refuses oversized UTF-8 content before POST", async () => {
    const payload = draft();
    payload.content.scenes[0]!.blocks = Array.from({ length: 40 }, (_, index) => ({
      block_id: `sblk_${index.toString(16).padStart(32, "0")}`,
      ordinal: index + 1,
      kind: "ACTION",
      text: "字".repeat(20_000),
      speaker: null,
      delivery: null,
    }));
    await expect(
      transport.createEpisodeScriptVersion(projectId, episodeId, "original-key", payload),
    ).rejects.toThrow("Invalid script");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each([
    { parent_version_id: `ver_${"f".repeat(32)}` },
    { head_revision: 2 },
    { change_summary: "other write" },
    { content: { ...draft().content, scenes: [] } },
  ])("never acknowledges a different write receipt: %j", async (patch) => {
    fetchMock.mockResolvedValue(
      reply({ version: { ...version(), ...patch }, replayed: false }, "revision-1", 201),
    );
    expect(
      await transport.createEpisodeScriptVersion(projectId, episodeId, "original-key", draft()),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test.each([
    [409, "SCRIPT_CONFLICT"],
    [413, "SCRIPT_TOO_LARGE"],
    [422, "SCRIPT_INPUT_REJECTED"],
    [428, "PRECONDITION_REQUIRED"],
  ] as const)("preserves verified %i %s without retry", async (status, code) => {
    fetchMock.mockResolvedValue(rejection(status, code));
    expect(
      await transport.createEpisodeScriptVersion(projectId, episodeId, "original-key", draft()),
    ).toEqual({ kind: "DEFINITE_SERVER_ERROR", status, code, request_id: requestId });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("lost response does not replay the write", async () => {
    fetchMock.mockRejectedValue(new Error("lost after commit"));
    expect(
      await transport.createEpisodeScriptVersion(projectId, episodeId, "original-key", draft()),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
