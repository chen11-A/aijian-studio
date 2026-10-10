import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type {
  HumanShotPlanRequest,
  ShotPlanAdoptionRequest,
  ShotPlanGateway,
} from "@aijian/contracts/shot-plan";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import { createShotPlanClient } from "./shot-plan-client";
import { SHOT_PLAN_CHANNELS } from "./shot-plan-contract";
import { registerShotPlanHandlers } from "./shot-plan-ipc";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../packages/contracts/fixtures/shot-plan", `${name}.json`),
      "utf8",
    ),
  ) as T;
}
const scope = fixture<{
  project_id: string;
  episode_id: string;
  proposal_version_id: string;
  operation_id: string;
}>("scope");
const {
  project_id: project,
  episode_id: episode,
  proposal_version_id: version,
  operation_id: operation,
} = scope;
const human = fixture<HumanShotPlanRequest>("human-request");
const adoption = fixture<ShotPlanAdoptionRequest>("adoption-request");
const session = { origin: "http://127.0.0.1:43124", token: "t".repeat(43) };
const root = `${session.origin}/api/v1/projects/${project}/episodes/${episode}/shot-plan-proposals`;
const requestId = "00000000-0000-4000-8000-000000000001";
function response(body: unknown, status = 200, header?: string | null): Response {
  const inferred =
    body !== null && typeof body === "object" && "request_id" in body
      ? String(body.request_id)
      : requestId;
  return new Response(JSON.stringify(body), {
    status,
    headers: header === null ? {} : { "X-Request-ID": header ?? inferred },
  });
}
function error(code: string, retryable = false) {
  return {
    error: { code, message: "Safely rejected", details: {}, retryable },
    request_id: requestId,
  };
}
afterEach(() => vi.useRealTimers());

describe("shot plan privileged native HTTP client", () => {
  test("maps all seven typed fixed routes using authenticated main-only session headers", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createLocalApiClient(fetcher, session);
    const cases: [string, string, string, number, () => Promise<unknown>][] = [
      [
        "preparation",
        "/preparation",
        "PREPARED",
        200,
        () => client.prepareHumanShotPlan(project, episode),
      ],
      ["proposal", "", "FOUND", 200, () => client.getShotPlanProposal(project, episode)],
      [
        "proposal",
        `/versions/${version}`,
        "FOUND",
        200,
        () => client.getShotPlanProposalVersion(project, episode, version),
      ],
      [
        "write-status",
        `/human-operations/${operation}`,
        "STATUS",
        200,
        () => client.getHumanShotPlanWriteStatus(project, episode, operation),
      ],
      [
        "adoption-status",
        `/versions/${version}/adoption`,
        "STATUS",
        200,
        () => client.getShotPlanAdoptionStatus(project, episode, version),
      ],
      [
        "created",
        "/human",
        "CREATED",
        201,
        () => client.createHumanShotPlanProposal(project, episode, operation, human),
      ],
      [
        "adopted",
        `/versions/${version}/adopt`,
        "ADOPTED",
        200,
        () => client.adoptHumanShotPlanProposal(project, episode, version, operation, adoption),
      ],
    ];
    for (const [name, path, kind, status, action] of cases) {
      fetcher.mockResolvedValueOnce(response(fixture(name), status));
      expect(await action()).toMatchObject({ kind });
      expect(fetcher.mock.lastCall?.[0]).toBe(root + path);
      expect(fetcher.mock.lastCall?.[1]?.headers).toMatchObject({
        Origin: "app://aijian",
        Authorization: `Bearer ${session.token}`,
      });
      if (kind === "CREATED" || kind === "ADOPTED")
        expect(fetcher.mock.lastCall?.[1]).toMatchObject({
          method: "POST",
          headers: { "Idempotency-Key": operation, "Content-Type": "application/json" },
        });
      else expect(fetcher.mock.lastCall?.[1]?.method).toBeUndefined();
    }
    expect(fetcher).toHaveBeenCalledTimes(7);
  });
  test("a direct authenticated seam failure remains unknown without a retry", async () => {
    const read = vi.fn().mockRejectedValue(new Error("transport failure"));
    const client = createShotPlanClient(read, {});
    expect(await client.getShotPlanProposal(project, episode)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(read).toHaveBeenCalledTimes(1);
  });
  test("latest EMPTY is reserved for the genuine missing-plan error, not inaccessible or corrupt data", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createLocalApiClient(fetcher, session);
    fetcher.mockResolvedValueOnce(response(error("SHOT_PLAN_NOT_FOUND"), 404));
    expect(await client.getShotPlanProposal(project, episode)).toEqual({ kind: "EMPTY" });
    for (const [code, status] of [
      ["PROJECT_NOT_FOUND", 404],
      ["SHOT_PLAN_SCRIPT_STALE", 409],
      ["FORBIDDEN", 403],
    ] as const) {
      fetcher.mockResolvedValueOnce(response(error(code), status));
      expect(await client.getShotPlanProposal(project, episode)).toMatchObject({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code,
      });
    }
    fetcher.mockResolvedValueOnce(response(error("SHOT_PLAN_NOT_FOUND"), 404));
    expect(await client.getShotPlanProposalVersion(project, episode, version)).toMatchObject({
      kind: "DEFINITE_SERVER_ERROR",
      status: 404,
    });
    fetcher.mockResolvedValueOnce(response(error("SHOT_PLAN_NOT_FOUND", true), 404));
    expect(await client.getShotPlanProposal(project, episode)).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  test("lost mutation responses never retry; only explicit read-only status recovers an existing receipt", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createLocalApiClient(fetcher, session);
    fetcher.mockRejectedValueOnce(new Error("response lost after commit"));
    expect(await client.createHumanShotPlanProposal(project, episode, operation, human)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(response(fixture("write-status")));
    expect(await client.getHumanShotPlanWriteStatus(project, episode, operation)).toMatchObject({
      kind: "STATUS",
    });
    expect(fetcher.mock.lastCall?.[1]?.method).toBeUndefined();
    fetcher.mockRejectedValueOnce(new Error("adoption response lost"));
    expect(
      await client.adoptHumanShotPlanProposal(project, episode, version, operation, adoption),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockResolvedValueOnce(response(fixture("adoption-status")));
    expect(await client.getShotPlanAdoptionStatus(project, episode, version)).toMatchObject({
      kind: "STATUS",
    });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
  test("unreadable, request-id-mismatched, foreign-version or server-failure responses remain unknown", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createLocalApiClient(fetcher, session);
    for (const reply of [
      response(fixture("created"), 201, null),
      response(fixture("created"), 201, requestId),
      response({}, 201),
      new Response("{", { status: 201 }),
      response(error("SHOT_PLAN_STORAGE_FAILED"), 500),
    ]) {
      fetcher.mockResolvedValueOnce(reply);
      expect(await client.createHumanShotPlanProposal(project, episode, operation, human)).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
    }
    fetcher.mockRejectedValueOnce(new Error("read unavailable"));
    expect(await client.getShotPlanAdoptionStatus(project, episode, version)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    const otherVersion = `ver_${"f".repeat(32)}`;
    fetcher.mockResolvedValueOnce(response(fixture("proposal")));
    expect(await client.getShotPlanProposalVersion(project, episode, otherVersion)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    fetcher.mockResolvedValueOnce(response(fixture("created")));
    expect(
      await client.adoptHumanShotPlanProposal(project, episode, version, operation, adoption),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  test("bounded HTTP covers stalled fetch and body reads without resending writes", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(() => {}));
    const client = createLocalApiClient(fetcher, session);
    const stalledFetch = client.createHumanShotPlanProposal(project, episode, operation, human);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await stalledFetch).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'));
      },
    });
    fetcher.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { "X-Request-ID": requestId } }),
    );
    const stalledBody = client.getHumanShotPlanWriteStatus(project, episode, operation);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await stalledBody).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  test("preparation reads have their own 9 MB safety ceiling", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { headers: { "Content-Length": "9000001" } }));
    const client = createLocalApiClient(fetcher, session);
    expect(await client.prepareHumanShotPlan(project, episode)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test("snapshots a validated write before await; renderer mutation cannot alter readback comparison", async () => {
    const payload = structuredClone(human);
    let finish: (value: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = createLocalApiClient(fetcher, session);
    const pending = client.createHumanShotPlanProposal(project, episode, operation, payload);
    payload.content.visual_constraints = ["changed after invocation"];
    finish(response(fixture("created"), 201));
    expect(await pending).toMatchObject({ kind: "CREATED" });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(human));
  });
  test("rejects invalid paths, UUIDs, forged provenance and non-boolean decisions before transport", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createLocalApiClient(fetcher, session);
    const actions = [
      () => client.prepareHumanShotPlan("../escape", episode),
      () => client.getShotPlanProposal(project, "https://evil.test"),
      () => client.getShotPlanProposalVersion(project, episode, "../secret"),
      () => client.getHumanShotPlanWriteStatus(project, episode, "operation"),
      () => client.getShotPlanAdoptionStatus(project, episode, "version"),
      () => client.createHumanShotPlanProposal(project, episode, "key", human),
      () =>
        client.createHumanShotPlanProposal(project, episode, operation, {
          ...human,
          content: { ...human.content, provenance: "AI" },
        } as unknown as HumanShotPlanRequest),
      () =>
        client.adoptHumanShotPlanProposal(project, episode, version, operation, {
          ...adoption,
          confirm: 1,
        } as unknown as ShotPlanAdoptionRequest),
      () => client.adoptHumanShotPlanProposal(project, episode, version, "key", adoption),
    ];
    for (const action of actions) await expect(action()).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("shot plan native IPC and sandbox preload boundaries", () => {
  test("top-level frame and sender checks precede argument validation and all dispatch", async () => {
    const handlers = new Map<
      string,
      (event: { trusted: boolean; sender: boolean }, ...args: unknown[]) => Promise<unknown>
    >();
    const client: ShotPlanGateway = {
      prepareHumanShotPlan: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      getShotPlanProposal: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      getShotPlanProposalVersion: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      getHumanShotPlanWriteStatus: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      getShotPlanAdoptionStatus: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      createHumanShotPlanProposal: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      adoptHumanShotPlanProposal: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    };
    const clientFor = vi.fn((event: { sender: boolean }) => {
      if (!event.sender) throw new Error("sender unavailable");
      return client;
    });
    registerShotPlanHandlers<{ trusted: boolean; sender: boolean }>(
      (channel, handler) => handlers.set(channel, handler),
      clientFor,
      (event) => event.trusted,
    );
    const cases = [
      [SHOT_PLAN_CHANNELS.prepare, "prepareHumanShotPlan", [project, episode]],
      [SHOT_PLAN_CHANNELS.latest, "getShotPlanProposal", [project, episode]],
      [SHOT_PLAN_CHANNELS.version, "getShotPlanProposalVersion", [project, episode, version]],
      [
        SHOT_PLAN_CHANNELS.writeStatus,
        "getHumanShotPlanWriteStatus",
        [project, episode, operation],
      ],
      [SHOT_PLAN_CHANNELS.adoptionStatus, "getShotPlanAdoptionStatus", [project, episode, version]],
      [
        SHOT_PLAN_CHANNELS.create,
        "createHumanShotPlanProposal",
        [project, episode, operation, human],
      ],
      [
        SHOT_PLAN_CHANNELS.adopt,
        "adoptHumanShotPlanProposal",
        [project, episode, version, operation, adoption],
      ],
    ] as const;
    expect([...handlers.keys()]).toEqual(Object.values(SHOT_PLAN_CHANNELS));
    for (const [channel, method, args] of cases) {
      const handler = handlers.get(channel)!;
      await expect(handler({ trusted: false, sender: true }, ...args)).rejects.toThrow("frame");
      expect(clientFor).not.toHaveBeenCalled();
      await expect(handler({ trusted: true, sender: false }, ...args)).rejects.toThrow("sender");
      clientFor.mockClear();
      for (const badArgs of [
        args.slice(0, -1),
        [...args, "extra"],
        ["../escape", ...args.slice(1)],
      ])
        await expect(handler({ trusted: true, sender: true }, ...badArgs)).rejects.toThrow();
      expect(client[method]).not.toHaveBeenCalled();
      await handler({ trusted: true, sender: true }, ...args);
      expect(client[method]).toHaveBeenCalledWith(...args);
      clientFor.mockClear();
    }
    await expect(
      handlers.get(SHOT_PLAN_CHANNELS.create)!(
        { trusted: true, sender: true },
        project,
        episode,
        operation,
        { ...human, provider_id: "made-up" },
      ),
    ).rejects.toThrow("closed");
    await expect(
      handlers.get(SHOT_PLAN_CHANNELS.adopt)!(
        { trusted: true, sender: true },
        project,
        episode,
        version,
        operation,
        { ...adoption, confirm: "true" },
      ),
    ).rejects.toThrow("true");
    const main = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(main).toContain("event.sender !== mainWindow.webContents");
    expect(main).toMatch(
      /registerShotPlanHandlers<IpcMainInvokeEvent>\([\s\S]*?clientFor,[\s\S]*?event\.senderFrame === mainWindow\.webContents\.mainFrame/,
    );
  });
  test("preload has electron as its only runtime import, fixed channels and a separate typed HUMAN surface", async () => {
    const source = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exposures = new Map<string, Record<string, (...args: unknown[]) => Promise<unknown>>>();
    const invoke = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    runInNewContext(compiled, {
      exports: {},
      require: (name: string) => {
        expect(name).toBe("electron");
        return {
          contextBridge: {
            exposeInMainWorld: (
              name: string,
              bridge: Record<string, (...args: unknown[]) => Promise<unknown>>,
            ) => exposures.set(name, bridge),
          },
          ipcRenderer: { invoke },
        };
      },
    });
    expect([...exposures.keys()].filter((name) => name !== "aijianShotPlan")).toEqual([
      "aijianChatGPT",
      "aijianAssistantChat",
      "aijianOfficialText",
      "aijianOfficialDirector",
      "aijian",
    ]);
    expect([...exposures.keys()].at(-1)).toBe("aijian");
    const bridge = exposures.get("aijianShotPlan")!;
    const calls: [string, string, unknown[]][] = [
      ["prepareHumanShotPlan", SHOT_PLAN_CHANNELS.prepare, [project, episode]],
      ["getShotPlanProposal", SHOT_PLAN_CHANNELS.latest, [project, episode]],
      ["getShotPlanProposalVersion", SHOT_PLAN_CHANNELS.version, [project, episode, version]],
      [
        "getHumanShotPlanWriteStatus",
        SHOT_PLAN_CHANNELS.writeStatus,
        [project, episode, operation],
      ],
      ["getShotPlanAdoptionStatus", SHOT_PLAN_CHANNELS.adoptionStatus, [project, episode, version]],
      [
        "createHumanShotPlanProposal",
        SHOT_PLAN_CHANNELS.create,
        [project, episode, operation, human],
      ],
      [
        "adoptHumanShotPlanProposal",
        SHOT_PLAN_CHANNELS.adopt,
        [project, episode, version, operation, adoption],
      ],
    ];
    expect(Object.keys(bridge)).toEqual(calls.map(([name]) => name));
    for (const [method, channel, args] of calls) {
      await bridge[method]!(...args);
      expect(invoke.mock.lastCall).toEqual([channel, ...args]);
    }
    const assistant = exposures.get("aijianAssistantChat")!;
    const previewRequest = {
      sessionId: operation,
      scope: { projectId: project, episodeId: episode, page: "storyboard" },
      userText: "这一镜如何更紧张？",
      model: "fixture",
      expectedProfileId: operation,
      references: [],
    };
    const sendRequest = {
      previewId: operation,
      operationId: operation,
      inputHash: `sha256:${"a".repeat(64)}`,
      expectedProfileId: operation,
    };
    const assistantCalls: [string, string, unknown[]][] = [
      ["preview", "assistant-chat:preview", [previewRequest]],
      ["send", "assistant-chat:send", [sendRequest]],
      ["discardPreview", "assistant-chat:discard-preview", [operation]],
      [
        "getOperation",
        "assistant-chat:get-operation",
        [{ operationId: operation, expectedProfileId: operation }],
      ],
      [
        "listPending",
        "assistant-chat:list-pending",
        [{ scope: previewRequest.scope, expectedProfileId: operation }],
      ],
    ];
    expect(Object.keys(assistant)).toEqual(assistantCalls.map(([name]) => name));
    for (const [method, channel, args] of assistantCalls) {
      await assistant[method]!(...args);
      expect(invoke.mock.lastCall).toEqual([channel, ...args]);
    }
    expect(source).toContain('import type { ShotPlanGateway } from "@aijian/contracts/shot-plan"');
    expect(source).not.toMatch(
      /ipcRenderer\.invoke\(channel|ipcRenderer\.send|Authorization|fetch\(/,
    );
    for (const forbidden of ["token", "origin", "fetch", "invoke", "generate", "complete"])
      for (const surface of [bridge, assistant]) expect(surface).not.toHaveProperty(forbidden);
    expect(exposures.get("aijian")).not.toHaveProperty("createHumanShotPlanProposal");
  });
});
