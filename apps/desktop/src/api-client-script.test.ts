import { describe, expect, test, vi } from "vitest";
import { createLocalApiClient, type LocalApiClient } from "./api-client";
import type {
  CreateEpisodeScriptVersionRequest,
  EpisodeScriptVersion,
} from "./episode-script-contract";
import type {
  CreateEpisodeScriptConfirmationRequest,
  EpisodeScriptConfirmationStatus,
} from "./episode-script-confirmation-contract";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const versionId = `ver_${"c".repeat(32)}`;
const confirmationId = `esc_${"d".repeat(32)}`;
const hash = `sha256:${"e".repeat(64)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
const draft: CreateEpisodeScriptVersionRequest = {
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
        scene_id: `scn_${"f".repeat(32)}`,
        ordinal: 1,
        heading: "Synthetic scene",
        blocks: [
          {
            block_id: `sblk_${"1".repeat(32)}`,
            ordinal: 1,
            kind: "ACTION",
            text: "Synthetic action",
            speaker: null,
            delivery: null,
          },
        ],
      },
    ],
  },
  parent_version_id: null,
  expected_revision: null,
  change_summary: "Synthetic first draft",
};
const version: EpisodeScriptVersion = {
  version_id: versionId,
  project_id: project,
  episode_id: episode,
  version_number: 1,
  head_revision: 1,
  parent_version_id: null,
  content: draft.content,
  content_hash: hash,
  author_actor_id: "synthetic-user",
  change_summary: draft.change_summary,
  created_at: "2026-09-14T00:00:00Z",
};
const confirmation: CreateEpisodeScriptConfirmationRequest = {
  version_id: versionId,
  expected_content_hash: hash,
  expected_head_revision: 1,
  confirm: true,
};
const confirmed: EpisodeScriptConfirmationStatus = {
  project_id: project,
  episode_id: episode,
  latest_version_id: versionId,
  latest_head_revision: 1,
  current: true,
  confirmation: {
    confirmation_id: confirmationId,
    project_id: project,
    episode_id: episode,
    artifact_id: `art_${"2".repeat(32)}`,
    version_id: versionId,
    content_hash: hash,
    head_revision: 1,
    actor_id: "synthetic-user",
    confirmed_at: "2026-09-14T00:00:00Z",
  },
};
function wire(data: unknown, status = 200) {
  return Response.json(
    { data, request_id: requestId },
    { status, headers: { "X-Request-ID": requestId } },
  );
}
type Operation = {
  name: string;
  path: string;
  method: "GET" | "POST";
  status: number;
  data: unknown;
  kind: string;
  call(c: LocalApiClient, p: string): Promise<unknown>;
};
const operations: Operation[] = [
  {
    name: "latest script",
    path: "script",
    method: "GET",
    status: 200,
    data: version,
    kind: "FOUND",
    call: (c, p) => c.getEpisodeScript(p, episode),
  },
  {
    name: "script version",
    path: `script/versions/${versionId}`,
    method: "GET",
    status: 200,
    data: version,
    kind: "FOUND",
    call: (c, p) => c.getEpisodeScriptVersion(p, episode, versionId),
  },
  {
    name: "create script",
    path: "script/versions",
    method: "POST",
    status: 201,
    data: { version, replayed: false },
    kind: "CREATED",
    call: (c, p) => c.createEpisodeScriptVersion(p, episode, "synthetic-script-key", draft),
  },
  {
    name: "confirmation status",
    path: "script/confirmation",
    method: "GET",
    status: 200,
    data: confirmed,
    kind: "FOUND",
    call: (c, p) => c.getEpisodeScriptConfirmation(p, episode),
  },
  {
    name: "create confirmation",
    path: "script/confirmations",
    method: "POST",
    status: 201,
    data: { status: confirmed, replayed: false },
    kind: "CREATED",
    call: (c, p) =>
      c.createEpisodeScriptConfirmation(p, episode, "synthetic-confirm-key", confirmation),
  },
  {
    name: "confirmation receipt",
    path: `script/confirmations/${confirmationId}`,
    method: "GET",
    status: 200,
    data: confirmed,
    kind: "FOUND",
    call: (c, p) => c.getEpisodeScriptConfirmationReceipt(p, episode, confirmationId),
  },
];

describe.each(operations)("episode $name transport", (operation) => {
  test("preserves the exact receipt and request identity", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      wire(operation.data, operation.status),
    );
    expect(await operation.call(createLocalApiClient(fetcher, session), project)).toEqual({
      kind: operation.kind,
      receipt: { data: operation.data, request_id: requestId },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      `${session.origin}/api/v1/projects/${project}/episodes/${episode}/${operation.path}`,
    );
    expect(init?.method ?? "GET").toBe(operation.method);
    if (operation.method === "POST") {
      const key =
        operation.name === "create script" ? "synthetic-script-key" : "synthetic-confirm-key";
      expect(init?.headers).toMatchObject({ "Idempotency-Key": key });
      expect(JSON.parse(String(init?.body))).toEqual(
        operation.name === "create script" ? draft : confirmation,
      );
    } else expect(init?.body).toBeUndefined();
  });

  test.each(["network", "JSON", "mismatched receipt", "untrusted HTTP"])(
    "retains unknown for %s without replay",
    async (outcome) => {
      const fetcher = vi.fn(async () => {
        if (outcome === "network") throw new Error("lost reply");
        if (outcome === "JSON") return new Response("{");
        return wire({}, outcome === "untrusted HTTP" ? 500 : operation.status);
      });
      expect(await operation.call(createLocalApiClient(fetcher, session), project)).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  test("retains a definite revision conflict without retrying", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          request_id: requestId,
          error: {
            code: "REVISION_CONFLICT",
            message: "Synthetic conflict",
            retryable: false,
            details: {},
          },
        },
        { status: 409, headers: { "X-Request-ID": requestId } },
      ),
    );
    expect(await operation.call(createLocalApiClient(fetcher, session), project)).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "REVISION_CONFLICT",
      request_id: requestId,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test("rejects noncanonical project before HTTP", async () => {
    const fetcher = vi.fn();
    await expect(
      operation.call(createLocalApiClient(fetcher, session), "../project"),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

test("only a trusted latest SCRIPT_NOT_FOUND means empty, not a missing historical version", async () => {
  const fetcher = vi.fn(async () =>
    Response.json(
      {
        request_id: requestId,
        error: {
          code: "SCRIPT_NOT_FOUND",
          message: "No script",
          retryable: false,
          details: {},
        },
      },
      { status: 404, headers: { "X-Request-ID": requestId } },
    ),
  );
  const client = createLocalApiClient(fetcher, session);
  expect(await client.getEpisodeScript(project, episode)).toEqual({ kind: "EMPTY" });
  expect(await client.getEpisodeScriptVersion(project, episode, versionId)).toMatchObject({
    kind: "DEFINITE_SERVER_ERROR",
    status: 404,
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("a confirmation receipt for another version cannot confirm this submission", async () => {
  const fetcher = vi.fn(async () =>
    wire(
      {
        status: {
          ...confirmed,
          current: false,
          confirmation: {
            ...confirmed.confirmation,
            version_id: `ver_${"3".repeat(32)}`,
          },
        },
        replayed: false,
      },
      201,
    ),
  );
  expect(
    await createLocalApiClient(fetcher, session).createEpisodeScriptConfirmation(
      project,
      episode,
      "synthetic-confirm-key",
      confirmation,
    ),
  ).toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(fetcher).toHaveBeenCalledOnce();
});
