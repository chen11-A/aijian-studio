import { readFileSync } from "node:fs";
import {
  isRemoteSourceExtractCreateCommand,
  isRemoteSourceExtractCreatedResponse,
  isSourceExtractionResponse,
  remoteSourceExtractIdempotencyKey,
} from "@qa-desktop/remote-source-extract-contract.ts";
import {
  registerRemoteSourceExtractHandlers,
  resolveRemoteSourceExtractTopFrameClient,
} from "@qa-desktop/remote-source-extract-ipc.ts";
import { createLocalApiClient } from "@qa-desktop/api-client.ts";
import { createdProposalRunResponse } from "@qa-desktop/proposal-run-test-fixture.ts";

const project = `prj_${"a".repeat(32)}`;
const otherProject = `prj_${"b".repeat(32)}`;
const version = `ver_${"c".repeat(32)}`;
const command = {
  operation_id: "123e4567-e89b-42d3-a456-426614174000",
  input: {
    source: {
      agent_definition: { definition_id: "writer.source-analyst", version: "1.1.0" },
      skill_definition: { definition_id: "source.extract", version: "1.1.0" },
      source_manifest_version_id: version,
      source_document_id: `src_${"d".repeat(32)}`,
      source_block_id: `srcb_${"e".repeat(32)}`,
      start_byte: 0,
      end_byte: 20,
    },
    selection: {
      connection_id: `pcn_${"f".repeat(32)}`,
      connection_revision: 2,
      model_id: "cpa-text-model",
    },
  },
};

test("strict remote 1.1 command and same operation idempotency key", () => {
  expect(isRemoteSourceExtractCreateCommand(command)).toBe(true);
  expect(isRemoteSourceExtractCreateCommand({
    ...command,
    input: { ...command.input, source: {
      ...command.input.source,
      skill_definition: { definition_id: "source.extract", version: "1.0.0" },
    } },
  })).toBe(false);
  expect(isRemoteSourceExtractCreateCommand({
    ...command,
    input: { ...command.input, source: {
      ...command.input.source,
      agent_definition: { definition_id: "writer.source-analyst", version: "1.0.0" },
    } },
  })).toBe(false);
  expect(isRemoteSourceExtractCreateCommand({
    ...command,
    input: { ...command.input, selection: { ...command.input.selection, extra: "secret" } },
  })).toBe(false);
  expect(remoteSourceExtractIdempotencyKey(command)).toBe(
    `remote-source-extract:create:v1:${command.operation_id}`,
  );
});

test("IPC rejects child frame and invalid arguments before client access", async () => {
  const frame = {};
  const child = {};
  const client = {
    createRemoteSourceExtractRun: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" })),
    readOriginalRemoteSourceExtractRun: vi.fn(),
    getSourceExtraction: vi.fn(),
    getSourceExtractionVersion: vi.fn(),
  };
  const clientFor = vi.fn(() => client);
  expect(() => resolveRemoteSourceExtractTopFrameClient(
    { senderFrame: child }, frame, clientFor,
  )).toThrow(/top-level frame/);
  expect(clientFor).not.toHaveBeenCalled();
  const handlers = new Map();
  registerRemoteSourceExtractHandlers(
    (channel, listener) => handlers.set(channel, listener),
    (event) => resolveRemoteSourceExtractTopFrameClient(event, frame, clientFor),
  );
  expect(() => handlers.get("remote-source-extract:create")(
    { senderFrame: frame }, project, { ...command, extra: true },
  )).toThrow(/Invalid remote source extract command/);
  expect(client.createRemoteSourceExtractRun).not.toHaveBeenCalled();
  expect(() => handlers.get("source-extraction:get-version")(
    { senderFrame: child }, project, version,
  )).toThrow(/top-level frame/);
  expect(client.getSourceExtractionVersion).not.toHaveBeenCalled();
});

test("transport classifies lost create response UNKNOWN and preserves exact operation identity", async () => {
  const fetcher = vi.fn(async () => { throw Error("connection reset"); });
  const client = createLocalApiClient(fetcher, {
    origin: "http://127.0.0.1:43123", token: "s".repeat(43),
  });
  await expect(client.createRemoteSourceExtractRun(project, command)).resolves.toEqual({
    kind: "REMOTE_UNKNOWN",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(`http://127.0.0.1:43123/api/v1/projects/${project}/remote-source-extract-runs`);
  expect(init.method).toBe("POST");
  expect(new Headers(init.headers).get("Idempotency-Key")).toBe(
    `remote-source-extract:create:v1:${command.operation_id}`,
  );
  expect(JSON.parse(init.body)).toEqual(command.input);
});

test("SourceExtraction GET uses exact version path and refuses cross-project/malformed receipt", async () => {
  const fetcher = vi.fn(async () => Response.json({ error: {
    code: "SOURCE_EXTRACTION_NOT_FOUND", message: "missing", retryable: false, details: {},
  }, request_id: "88ed7974-adc3-4e35-a5c8-38b9674fc45c" }, { status: 404 }));
  const client = createLocalApiClient(fetcher, {
    origin: "http://127.0.0.1:43123", token: "s".repeat(43),
  });
  await expect(client.getSourceExtractionVersion(project, version)).resolves.toEqual({ kind: "NOT_FOUND" });
  expect(fetcher.mock.calls[0][0]).toBe(
    `http://127.0.0.1:43123/api/v1/projects/${project}/source-extraction/versions/${version}`,
  );
  expect(isSourceExtractionResponse({ data: { project_id: otherProject } }, project, version)).toBe(false);
});

test("accepts actual queue-only Sidecar remote 1.1 receipt", async () => {
  const actual = JSON.parse(readFileSync(new URL("./fixture02.stdout.json", import.meta.url), "utf8"));
  expect(actual.status).toBe(201);
  expect(isRemoteSourceExtractCreateCommand(actual.command)).toBe(true);
  expect(actual.receipt.data.context_manifest.entries[0].version).toBe("1.1.0");
  expect(actual.receipt.data.context_manifest.entries[1].version).toBe("1.1.0");
  expect(isRemoteSourceExtractCreatedResponse(
    actual.receipt, actual.project_id, actual.command, true,
  )).toBe(true);
  const client = createLocalApiClient(
    vi.fn(async () => Response.json(actual.receipt, { status: 201 })),
    { origin: "http://127.0.0.1:43123", token: "s".repeat(43) },
  );
  await expect(client.createRemoteSourceExtractRun(actual.project_id, actual.command)).resolves.toMatchObject({
    kind: "QUEUED", replayed: false,
  });
});

test("remote validator does not accept a local 1.0 proposal-run receipt", () => {
  const actual = JSON.parse(readFileSync(new URL("./fixture02.stdout.json", import.meta.url), "utf8"));
  const local = createdProposalRunResponse();
  expect(local.data.agent_run.agent_definition.version).toBe("1.0.0");
  expect(isRemoteSourceExtractCreatedResponse(
    local, actual.project_id, actual.command, true,
  )).toBe(false);
});

test("desktop reads actual accepted draft latest and exact GET with ETag and producer truth", async () => {
  const actual = JSON.parse(readFileSync(new URL("./accepted02.json", import.meta.url), "utf8"));
  expect(actual.latest.status).toBe(200);
  expect(actual.exact.status).toBe(200);
  expect(isSourceExtractionResponse(actual.latest.receipt, actual.project_id)).toBe(true);
  expect(isSourceExtractionResponse(actual.exact.receipt, actual.project_id, actual.version_id)).toBe(true);
  const fetcher = vi.fn(async (url) => {
    const exact = url.endsWith(`/versions/${actual.version_id}`);
    const selected = exact ? actual.exact : actual.latest;
    return Response.json(selected.receipt, {
      status: 200, headers: { ETag: selected.etag },
    });
  });
  const client = createLocalApiClient(fetcher, {
    origin: "http://127.0.0.1:43123", token: "s".repeat(43),
  });
  const latest = await client.getSourceExtraction(actual.project_id);
  const exact = await client.getSourceExtractionVersion(actual.project_id, actual.version_id);
  expect(latest.kind).toBe("FOUND");
  expect(exact.kind).toBe("FOUND");
  expect(exact.receipt.data.version.id).toBe(actual.version_id);
  expect(exact.receipt.data.provenance.proposal_id).toBe(actual.proposal_id);
  expect(exact.receipt.data.provenance.producer_attempt_id).toBe(actual.producer_attempt_id);
  expect(fetcher.mock.calls[1][0]).toContain(
    `/projects/${actual.project_id}/source-extraction/versions/${actual.version_id}`,
  );

  const foreign = structuredClone(actual.exact.receipt);
  foreign.data.project_id = otherProject;
  const foreignClient = createLocalApiClient(
    vi.fn(async () => Response.json(foreign, {
      status: 200, headers: { ETag: actual.exact.etag },
    })),
    { origin: "http://127.0.0.1:43123", token: "s".repeat(43) },
  );
  await expect(foreignClient.getSourceExtractionVersion(actual.project_id, actual.version_id))
    .resolves.toEqual({ kind: "REMOTE_UNKNOWN" });

  const wrongEtagClient = createLocalApiClient(
    vi.fn(async () => Response.json(actual.exact.receipt, {
      status: 200, headers: { ETag: '"wrong"' },
    })),
    { origin: "http://127.0.0.1:43123", token: "s".repeat(43) },
  );
  await expect(wrongEtagClient.getSourceExtractionVersion(actual.project_id, actual.version_id))
    .resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
});
