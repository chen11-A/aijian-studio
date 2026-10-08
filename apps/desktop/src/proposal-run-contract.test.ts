import { spawnSync } from "node:child_process";
import { delimiter, resolve } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  PROPOSAL_RUN_CHANNELS,
  createProposalRunPreload,
  isCreatedProposalRunResponse,
  isProposalRunCreateCommand,
  registerProposalRunHandlers,
} from "./proposal-run-contract";
import {
  createdProposalRunResponse,
  proposalRunCommand as command,
  proposalRunProjectId as projectId,
} from "./proposal-run-test-fixture";

const response = createdProposalRunResponse();

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("test fixture must be an object");
  }
  return value as Record<string, unknown>;
}

describe("proposal run creation contract", () => {
  test("accepts only the exact bounded source.extract command", () => {
    expect(isProposalRunCreateCommand(command)).toBe(true);
    expect(
      isProposalRunCreateCommand({ ...command, operation_id: command.operation_id.toUpperCase() }),
    ).toBe(false);
    expect(isProposalRunCreateCommand({ ...command, extra: true })).toBe(false);
    expect(
      isProposalRunCreateCommand({ ...command, input: { ...command.input, end_byte: 0 } }),
    ).toBe(false);
    expect(
      isProposalRunCreateCommand({
        ...command,
        input: {
          ...command.input,
          skill_definition: { definition_id: "screenplay.generate", version: "1.0.0" },
        },
      }),
    ).toBe(false);
  });

  test("maps one fixed IPC channel without generating operation identity", async () => {
    const invoke = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    const preload = createProposalRunPreload(invoke);
    await preload.createProposalRun(projectId, command);
    expect(PROPOSAL_RUN_CHANNELS).toEqual({ create: "proposal-runs:create" });
    expect(Object.isFrozen(PROPOSAL_RUN_CHANNELS)).toBe(true);
    expect(invoke).toHaveBeenCalledWith("proposal-runs:create", projectId, command);
  });

  test("validates the full fresh response ownership chain", () => {
    expect(isCreatedProposalRunResponse(response, projectId, command, true)).toBe(true);
    const detached = structuredClone(response);
    detached.data.skill_run.project_id = `prj_${"0".repeat(32)}`;
    expect(isCreatedProposalRunResponse(detached, projectId, command, true)).toBe(false);
    const progressed = structuredClone(response) as unknown as {
      data: {
        agent_run: { status: string };
        skill_run: { status: string; proposal_id: string | null };
      };
    };
    progressed.data.agent_run.status = "NEEDS_REVIEW";
    progressed.data.skill_run.status = "NEEDS_REVIEW";
    progressed.data.skill_run.proposal_id = `prp_${"1".repeat(32)}`;
    expect(isCreatedProposalRunResponse(progressed, projectId, command, false)).toBe(true);
    expect(isCreatedProposalRunResponse(progressed, projectId, command, true)).toBe(false);
  });

  test("accepts actual fresh and replay responses from the Sidecar contract", () => {
    const repositoryRoot = resolve(process.cwd(), "../..");
    const python = [
      "import json, runpy, tempfile",
      "from pathlib import Path",
      `root = Path(${JSON.stringify(repositoryRoot)})`,
      "ns = runpy.run_path(str(root / 'services/api/tests/test_proposal_run_create_api.py'))",
      "operation_id = '7e0df32e-299a-4bb7-b77e-b85f20c41d61'",
      "with tempfile.TemporaryDirectory() as directory:",
      "    client, _ = ns['sidecar_client'](Path(directory))",
      "    source = ns['accepted_source'](client)",
      "    payload = ns['create_payload'](source)",
      "    headers = {'Idempotency-Key': 'proposal-run:create:v1:' + operation_id}",
      "    fresh = client.post(f'/api/v1/projects/{source[0]}/proposal-runs', json=payload, headers=headers)",
      "    replay = client.post(f'/api/v1/projects/{source[0]}/proposal-runs', json=payload, headers=headers)",
      "    print(json.dumps({'project_id': source[0], 'command': {'operation_id': operation_id, 'input': payload}, 'fresh_status': fresh.status_code, 'fresh': fresh.json(), 'replay_status': replay.status_code, 'replay': replay.json()}, ensure_ascii=False))",
    ].join("\n");
    const result = spawnSync("uv", ["run", "python", "-c", python], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONPATH: [resolve(repositoryRoot, "services/api/src"), process.env.PYTHONPATH]
          .filter(Boolean)
          .join(delimiter),
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const actual = JSON.parse(result.stdout) as {
      project_id: string;
      command: unknown;
      fresh_status: number;
      fresh: unknown;
      replay_status: number;
      replay: unknown;
    };
    expect(actual.fresh_status).toBe(201);
    expect(actual.replay_status).toBe(200);
    expect(isProposalRunCreateCommand(actual.command)).toBe(true);
    if (!isProposalRunCreateCommand(actual.command)) throw new Error("invalid Sidecar command");
    expect(
      isCreatedProposalRunResponse(actual.fresh, actual.project_id, actual.command, true),
    ).toBe(true);
    expect(
      isCreatedProposalRunResponse(actual.replay, actual.project_id, actual.command, false),
    ).toBe(true);
  }, 30_000);

  test("binds a receipt to the exact operation and immutable input", () => {
    expect(
      isCreatedProposalRunResponse(
        response,
        projectId,
        { ...command, operation_id: "87302cb8-71f8-4bb9-856a-162571f1ae6e" },
        true,
      ),
    ).toBe(false);
    expect(
      isCreatedProposalRunResponse(
        response,
        projectId,
        { ...command, input: { ...command.input, end_byte: 25 } },
        true,
      ),
    ).toBe(false);
  });

  test("rejects a self-consistent manifest rebuilt around another source span", () => {
    const detachedSpan = createdProposalRunResponse({
      ref: `source:spn_${"0".repeat(32)}`,
      byte_count: 23,
    });
    expect(isCreatedProposalRunResponse(detachedSpan, projectId, command, true)).toBe(false);
  });

  test("rejects impossible replay lifecycle combinations", () => {
    const mismatch = structuredClone(response);
    mismatch.data.agent_run.status = "RUNNING";
    expect(isCreatedProposalRunResponse(mismatch, projectId, command, false)).toBe(false);

    const missingProposal = structuredClone(response);
    missingProposal.data.agent_run.status = "NEEDS_REVIEW";
    missingProposal.data.skill_run.status = "NEEDS_REVIEW";
    expect(isCreatedProposalRunResponse(missingProposal, projectId, command, false)).toBe(false);
  });

  test.each([
    [
      "run ownership",
      (value: unknown) => (record(record(value).data).run_id = `agr_${"0".repeat(32)}`),
    ],
    [
      "agent project",
      (value: unknown) =>
        (record(record(record(value).data).agent_run).project_id = `prj_${"0".repeat(32)}`),
    ],
    [
      "skill delegation",
      (value: unknown) =>
        (record(record(record(value).data).skill_run).skill_run_id = `skr_${"0".repeat(32)}`),
    ],
    [
      "context ownership",
      (value: unknown) =>
        (record(record(record(value).data).context_manifest).context_manifest_id =
          `ctx_${"0".repeat(32)}`),
    ],
    [
      "attempt ownership",
      (value: unknown) =>
        (record(record(record(value).data).attempt).attempt_id = `att_${"0".repeat(32)}`),
    ],
    [
      "definition",
      (value: unknown) =>
        (record(record(record(value).data).attempt).skill_definition_id = "prompt.plan"),
    ],
    [
      "hash",
      (value: unknown) => (record(record(record(value).data).attempt).input_hash = "sha256:BAD"),
    ],
    ["date", (value: unknown) => (record(record(value).data).created_at = "not-a-date")],
    ["extra field", (value: unknown) => (record(record(value).data).extra = true)],
    [
      "nested sensitive field",
      (value: unknown) => (record(record(record(value).data).context_manifest).api_key = "secret"),
    ],
  ])("rejects detached or unsafe %s response data", (_name, mutate) => {
    const invalid = structuredClone(response);
    mutate(invalid);
    expect(isCreatedProposalRunResponse(invalid, projectId, command, true)).toBe(false);
  });

  test("validates the sender before rejecting malformed IPC arguments", async () => {
    const listeners = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    const client = { createProposalRun: vi.fn() };
    const clientFor = vi.fn(() => client);
    registerProposalRunHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      clientFor,
    );

    await expect(
      listeners.get("proposal-runs:create")!({}, projectId, { ...command, extra: true }),
    ).rejects.toThrow("exact proposal run command");
    expect(clientFor).toHaveBeenCalledOnce();
    expect(client.createProposalRun).not.toHaveBeenCalled();
  });

  test("rejects an unauthorized sender before any proposal run client call", async () => {
    const listeners = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    registerProposalRunHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      () => {
        throw new Error("Local API is not available");
      },
    );
    expect(() => listeners.get("proposal-runs:create")!({}, projectId, command)).toThrow(
      "Local API is not available",
    );
  });
});
