import { spawnSync } from "node:child_process";
import { delimiter, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  FAKE_TIMELINE_CAPABILITY_LOSSES,
  fakeTimelineRunIdempotencyKey,
  isFakeTimelineRunCreateCommand,
  isFakeTimelineRunResponse,
  type FakeTimelineRunCreateCommand,
  type FakeTimelineRunResponse,
} from "./fake-timeline-run-contract";

const fakeTimelineRunProjectId = `prj_${"a".repeat(32)}`;
const fakeTimelineRunCommand: FakeTimelineRunCreateCommand = {
  operation_id: "7e0df32e-299a-4bb7-b77e-b85f20c41d61",
  input: {
    source_manifest_version_id: `ver_${"1".repeat(32)}`,
    source_document_id: `src_${"2".repeat(32)}`,
  },
};

function createdFakeTimelineRunResponse(
  statusPair: { attempt_status: string; task_status: string } = {
    attempt_status: "READY",
    task_status: "READY",
  },
): FakeTimelineRunResponse {
  return {
    data: {
      project_id: fakeTimelineRunProjectId,
      source_manifest_version_id: fakeTimelineRunCommand.input.source_manifest_version_id,
      source_document_id: fakeTimelineRunCommand.input.source_document_id,
      workflow_run_id: `wfr_${"3".repeat(32)}`,
      node_run_id: `node_${"4".repeat(32)}`,
      attempt_id: `att_${"5".repeat(32)}`,
      task_id: `task_${"6".repeat(32)}`,
      attempt_status:
        statusPair.attempt_status as FakeTimelineRunResponse["data"]["attempt_status"],
      task_status: statusPair.task_status as FakeTimelineRunResponse["data"]["task_status"],
      capability_losses: [...FAKE_TIMELINE_CAPABILITY_LOSSES],
    },
    request_id: "88ed7974-adc3-4e35-a5c8-38b9674fc45c",
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("test fixture must be an object");
  }
  return value as Record<string, unknown>;
}

const LEGAL_REPLAY_PAIRS = [
  ["READY", "READY"],
  ["LEASED", "LEASED"],
  ["RUNNING", "LEASED"],
  ["SUCCEEDED", "COMPLETED"],
  ["FAILED", "COMPLETED"],
  ["CANCELLED", "CANCELLED"],
] as const;

const ILLEGAL_STATUS_PAIRS = [
  ["READY", "LEASED"],
  ["LEASED", "READY"],
  ["RUNNING", "READY"],
  ["RUNNING", "COMPLETED"],
  ["SUCCEEDED", "READY"],
  ["SUCCEEDED", "LEASED"],
  ["FAILED", "FAILED"],
  ["FAILED", "READY"],
  ["CANCELLED", "COMPLETED"],
  ["CANCEL_REQUESTED", "CANCELLED"],
  ["LEASED", "COMPLETED"],
  ["READY", "COMPLETED"],
  ["READY", "CANCELLED"],
  ["PENDING", "READY"],
] as const;

describe("fake timeline run creation contract", () => {
  test("accepts only the exact source identity command", () => {
    expect(isFakeTimelineRunCreateCommand(fakeTimelineRunCommand)).toBe(true);
    expect(
      isFakeTimelineRunCreateCommand({
        ...fakeTimelineRunCommand,
        operation_id: fakeTimelineRunCommand.operation_id.toUpperCase(),
      }),
    ).toBe(false);
    expect(isFakeTimelineRunCreateCommand({ ...fakeTimelineRunCommand, extra: true })).toBe(false);
    expect(
      isFakeTimelineRunCreateCommand({
        ...fakeTimelineRunCommand,
        input: { ...fakeTimelineRunCommand.input, extra: true },
      }),
    ).toBe(false);
    expect(
      isFakeTimelineRunCreateCommand({
        operation_id: fakeTimelineRunCommand.operation_id,
      }),
    ).toBe(false);
    expect(
      isFakeTimelineRunCreateCommand({
        ...fakeTimelineRunCommand,
        input: {
          source_manifest_version_id: fakeTimelineRunCommand.input.source_manifest_version_id,
        },
      }),
    ).toBe(false);
    expect(
      isFakeTimelineRunCreateCommand({
        ...fakeTimelineRunCommand,
        input: {
          ...fakeTimelineRunCommand.input,
          source_document_id: `SRC_${"2".repeat(32)}`,
        },
      }),
    ).toBe(false);
    expect(
      isFakeTimelineRunCreateCommand({
        ...fakeTimelineRunCommand,
        input: {
          ...fakeTimelineRunCommand.input,
          source_manifest_version_id: `ver_${"1".repeat(31)}G`,
        },
      }),
    ).toBe(false);
    expect(
      isFakeTimelineRunCreateCommand({
        ...fakeTimelineRunCommand,
        operation_id: "00000000-0000-1000-8000-000000000001",
      }),
    ).toBe(false);
  });

  test("maps the idempotency header from the caller-supplied operation identity only", () => {
    expect(fakeTimelineRunIdempotencyKey(fakeTimelineRunCommand)).toBe(
      `fake-timeline-run:create:v1:${fakeTimelineRunCommand.operation_id}`,
    );
    const changedInput = {
      ...fakeTimelineRunCommand,
      input: {
        ...fakeTimelineRunCommand.input,
        source_document_id: `src_${"9".repeat(32)}`,
      },
    };
    const otherOperation = {
      ...fakeTimelineRunCommand,
      operation_id: "87302cb8-71f8-4bb9-856a-162571f1ae6e",
    };
    expect(fakeTimelineRunIdempotencyKey(changedInput)).toBe(
      fakeTimelineRunIdempotencyKey(fakeTimelineRunCommand),
    );
    expect(fakeTimelineRunIdempotencyKey(otherOperation)).not.toBe(
      fakeTimelineRunIdempotencyKey(fakeTimelineRunCommand),
    );
  });

  test("validates every ownership field and every published id pattern", () => {
    const response = createdFakeTimelineRunResponse();
    expect(
      isFakeTimelineRunResponse(response, fakeTimelineRunProjectId, fakeTimelineRunCommand, true),
    ).toBe(true);

    const mutations: Array<[string, (value: FakeTimelineRunResponse) => void]> = [
      ["project ownership", (value) => (value.data.project_id = `prj_${"0".repeat(32)}`)],
      [
        "source document ownership",
        (value) => (value.data.source_document_id = `src_${"0".repeat(32)}`),
      ],
      [
        "source manifest ownership",
        (value) => (value.data.source_manifest_version_id = `ver_${"0".repeat(32)}`),
      ],
      ["project id pattern", (value) => (value.data.project_id = "prj_not-canonical")],
      [
        "source document id pattern",
        (value) => (value.data.source_document_id = `src_${"2".repeat(31)}G`),
      ],
      [
        "source manifest id pattern",
        (value) => (value.data.source_manifest_version_id = "ver_unsafe"),
      ],
      ["workflow run id pattern", (value) => (value.data.workflow_run_id = `wf_${"3".repeat(32)}`)],
      ["node run id pattern", (value) => (value.data.node_run_id = `node_${"4".repeat(31)}`)],
      ["attempt id pattern", (value) => (value.data.attempt_id = `attempt_${"5".repeat(32)}`)],
      ["task id pattern", (value) => (value.data.task_id = `task_${"6".repeat(31)}A`)],
      ["request id pattern", (value) => (value.request_id = "not-a-uuid")],
    ];
    for (const [, mutate] of mutations) {
      const invalid = structuredClone(response);
      mutate(invalid);
      expect(
        isFakeTimelineRunResponse(invalid, fakeTimelineRunProjectId, fakeTimelineRunCommand, true),
      ).toBe(false);
    }
  });

  test("requires the exact capability-loss tuple and rejects extra or sensitive keys", () => {
    const response = createdFakeTimelineRunResponse();
    expect(response.data.capability_losses).toEqual([
      "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
      "STATIC_FRAME_NO_MOTION_GENERATION",
      "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
    ]);

    const reordered = structuredClone(response);
    reordered.data.capability_losses = [
      "STATIC_FRAME_NO_MOTION_GENERATION",
      "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
      "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
    ] as unknown as FakeTimelineRunResponse["data"]["capability_losses"];
    expect(
      isFakeTimelineRunResponse(reordered, fakeTimelineRunProjectId, fakeTimelineRunCommand, true),
    ).toBe(false);

    const extraLoss = structuredClone(response);
    extraLoss.data.capability_losses = [
      ...FAKE_TIMELINE_CAPABILITY_LOSSES,
      "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
    ] as unknown as FakeTimelineRunResponse["data"]["capability_losses"];
    expect(
      isFakeTimelineRunResponse(extraLoss, fakeTimelineRunProjectId, fakeTimelineRunCommand, true),
    ).toBe(false);

    const extraField = structuredClone(response);
    record(record(extraField).data).extra = true;
    expect(
      isFakeTimelineRunResponse(extraField, fakeTimelineRunProjectId, fakeTimelineRunCommand, true),
    ).toBe(false);

    const sensitive = structuredClone(response);
    record(record(sensitive).data).api_key = "must-not-cross-boundary";
    expect(
      isFakeTimelineRunResponse(sensitive, fakeTimelineRunProjectId, fakeTimelineRunCommand, true),
    ).toBe(false);

    const nestedSensitive = structuredClone(response);
    record(record(nestedSensitive).data).provider = { access_token: "must-not-cross-boundary" };
    expect(
      isFakeTimelineRunResponse(
        nestedSensitive,
        fakeTimelineRunProjectId,
        fakeTimelineRunCommand,
        true,
      ),
    ).toBe(false);

    expect(
      isFakeTimelineRunResponse("not-json", fakeTimelineRunProjectId, fakeTimelineRunCommand, true),
    ).toBe(false);
    expect(
      isFakeTimelineRunResponse(null, fakeTimelineRunProjectId, fakeTimelineRunCommand, true),
    ).toBe(false);
  });

  test.each(LEGAL_REPLAY_PAIRS)(
    "accepts the explicit 200 status pair (%s, %s)",
    (attemptStatus, taskStatus) => {
      const response = createdFakeTimelineRunResponse({
        attempt_status: attemptStatus,
        task_status: taskStatus,
      });
      expect(
        isFakeTimelineRunResponse(
          response,
          fakeTimelineRunProjectId,
          fakeTimelineRunCommand,
          false,
        ),
      ).toBe(true);
    },
  );

  test.each(ILLEGAL_STATUS_PAIRS)(
    "rejects the illegal status pair (%s, %s)",
    (attemptStatus, taskStatus) => {
      const response = createdFakeTimelineRunResponse({
        attempt_status: attemptStatus,
        task_status: taskStatus,
      });
      expect(
        isFakeTimelineRunResponse(
          response,
          fakeTimelineRunProjectId,
          fakeTimelineRunCommand,
          false,
        ),
      ).toBe(false);
    },
  );

  test("201 accepts only READY/READY and refuses progressed states", () => {
    const fresh = createdFakeTimelineRunResponse();
    expect(
      isFakeTimelineRunResponse(fresh, fakeTimelineRunProjectId, fakeTimelineRunCommand, true),
    ).toBe(true);
    for (const [attemptStatus, taskStatus] of LEGAL_REPLAY_PAIRS) {
      if (attemptStatus === "READY" && taskStatus === "READY") continue;
      const progressed = createdFakeTimelineRunResponse({
        attempt_status: attemptStatus,
        task_status: taskStatus,
      });
      expect(
        isFakeTimelineRunResponse(
          progressed,
          fakeTimelineRunProjectId,
          fakeTimelineRunCommand,
          true,
        ),
      ).toBe(false);
      expect(
        isFakeTimelineRunResponse(
          progressed,
          fakeTimelineRunProjectId,
          fakeTimelineRunCommand,
          false,
        ),
      ).toBe(true);
    }
  });

  test("accepts actual fresh and replay receipts from the Sidecar contract", () => {
    const repositoryRoot = resolve(process.cwd(), "../..");
    const python = [
      "import json, runpy, tempfile",
      "from pathlib import Path",
      `root = Path(${JSON.stringify(repositoryRoot)})`,
      "ns = runpy.run_path(str(root / 'services/api/tests/test_fake_timeline_run_api.py'))",
      "operation_id = '7e0df32e-299a-4bb7-b77e-b85f20c41d61'",
      "with tempfile.TemporaryDirectory() as directory:",
      "    workspace = Path(directory) / 'workspace'",
      "    repository = ns['StudioRepository'](workspace / 'workspace.sqlite3')",
      "    generator = ns['_generator'](workspace)",
      "    factory = ns['FakeTimelineRunFactory'](repository, generator)",
      "    client = ns['_sidecar_client'](repository, factory)",
      "    project_id, source_id, version_id = ns['_project_and_source'](client, approve_manifest=True)",
      "    payload = ns['_command'](source_id, version_id)",
      "    headers = {'Idempotency-Key': 'fake-timeline-run:create:v1:' + operation_id}",
      "    path = f'/api/v1/projects/{project_id}/fake-timeline-runs'",
      "    fresh = client.post(path, json=payload, headers=headers)",
      "    replay = client.post(path, json=payload, headers=headers)",
      "    print(json.dumps({'project_id': project_id, 'command': {'operation_id': operation_id, 'input': payload}, 'fresh_status': fresh.status_code, 'fresh': fresh.json(), 'replay_status': replay.status_code, 'replay': replay.json()}, ensure_ascii=False))",
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
    expect(isFakeTimelineRunCreateCommand(actual.command)).toBe(true);
    if (!isFakeTimelineRunCreateCommand(actual.command)) throw new Error("invalid Sidecar command");
    expect(isFakeTimelineRunResponse(actual.fresh, actual.project_id, actual.command, true)).toBe(
      true,
    );
    expect(isFakeTimelineRunResponse(actual.replay, actual.project_id, actual.command, false)).toBe(
      true,
    );
  }, 30_000);
});
