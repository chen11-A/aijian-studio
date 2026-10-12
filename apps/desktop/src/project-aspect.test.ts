import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isProjectAspectRatio, type ProjectAspectRatio } from "@aijian/contracts/project-aspect";
import {
  settingsCommand,
  settingsIdentity,
  settingsReceipt,
  settingsResponse,
  type SettingsCommand,
  type SettingsReceipt,
  type SettingsResponse,
} from "@aijian/contracts/project-settings";
import { createLocalApiClient, type CreateProjectInput } from "./api-client";

const p = `prj_${"a".repeat(32)}`;
const other = `prj_${"b".repeat(32)}`;
const op = `pso_${"c".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000000";
const date = "2026-10-11T10:00:00Z";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
const aspects: ProjectAspectRatio[] = ["16:9", "9:16"];
const invalidAspects: unknown[] = ["4:3", "1:1", "16:09", "16:9 ", "", null, ["16:9"], 16];

function project(aspectRatio: unknown, change = {}) {
  return {
    id: p,
    name: "Saved project",
    aspect_ratio: aspectRatio,
    target_duration_seconds: 90,
    source_language: "zh-CN",
    status: "active",
    revision: 1,
    created_at: date,
    updated_at: date,
    ...change,
  };
}
function createInput(aspectRatio: unknown): CreateProjectInput {
  return {
    name: "Saved project",
    aspect_ratio: aspectRatio,
    target_duration_seconds: 90,
    source_language: "zh-CN",
  } as CreateProjectInput;
}
function response(data: unknown, revision?: number) {
  return Response.json(
    { data, request_id: requestId },
    {
      headers: {
        "X-Request-ID": requestId,
        ...(revision === undefined ? {} : { ETag: `"revision-${revision}"` }),
      },
    },
  );
}
const boundary: SettingsResponse["boundary"] = {
  settings_scope: "PROJECT_METADATA_ONLY",
  existing_artifact_versions_modified: false,
  sequence_timebase_effect: "DECLARED_DEFAULT_REQUIRES_EXPLICIT_ADOPTION",
  aspect_duration_language: "READ_ONLY_PENDING_CONSUMER_CAPABILITIES",
  episode_settings: "SEPARATE_EPISODE_CAS",
  production_intent: "SEPARATE_PRODUCTION_BRIEF_VERSION",
  generation_remote_version_policies: "NO_EDITABLE_PROJECT_POLICY_CONTRACT",
};
const settingsInput: SettingsCommand = {
  operation_id: op,
  expected_project_revision: 1,
  changes: { description: "Saved metadata" },
};
function currentSettings(aspectRatio: ProjectAspectRatio): SettingsResponse {
  return {
    data: {
      schema_version: 1,
      project_id: p,
      name: "Saved project",
      description: "",
      status: "active",
      sequence_timebase: null,
      aspect_ratio: aspectRatio,
      target_duration_seconds: 90,
      source_language: "zh-CN",
      revision: 1,
      created_at: date,
      updated_at: date,
    },
    boundary: structuredClone(boundary),
    request_id: requestId,
  };
}
function savedSettings(aspectRatio: ProjectAspectRatio): SettingsReceipt {
  return {
    data: {
      operation_id: op,
      project_id: p,
      request_hash: `sha256:${createHash("sha256").update(settingsIdentity(p, settingsInput)).digest("hex")}`,
      base_revision: 1,
      result_revision: 2,
      result: {
        ...currentSettings(aspectRatio).data,
        revision: 2,
        description: settingsInput.changes.description!,
      },
      created_at: date,
    },
    boundary: structuredClone(boundary),
    request_id: requestId,
  };
}
function settingsHttp(value: unknown) {
  return Response.json(value, { headers: { "X-Request-ID": requestId } });
}

describe("finite project aspect metadata through the desktop client", () => {
  it.each(aspects)(
    "creates, lists and reads the selected %s without replacing it",
    async (aspect) => {
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => response(project(aspect)));
      const api = createLocalApiClient(fetcher, session);
      const input = createInput(aspect);
      expect((await api.createProject(input)).data.aspect_ratio).toBe(aspect);
      expect(fetcher.mock.calls[0]).toEqual([
        `${session.origin}/api/v1/projects`,
        expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
      ]);
      expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
      });
      fetcher.mockImplementationOnce(async () => response([project(aspect)]));
      expect((await api.listProjects()).data[0]?.aspect_ratio).toBe(aspect);
      expect((await api.getProject(p)).data.aspect_ratio).toBe(aspect);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(fetcher.mock.calls.slice(1).map(([url, init]) => [url, init?.method])).toEqual([
        [`${session.origin}/api/v1/projects`, undefined],
        [`${session.origin}/api/v1/projects/${p}`, undefined],
      ]);
    },
  );

  it("reads both saved ratios in one project list without normalizing either", async () => {
    const data = [project("16:9"), project("9:16", { id: other })];
    const fetcher = vi.fn(async () => response(data));
    expect((await createLocalApiClient(fetcher, session).listProjects()).data).toEqual(data);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(invalidAspects)(
    "rejects unsupported creation aspect %j before dispatch",
    async (aspect) => {
      expect(isProjectAspectRatio(aspect)).toBe(false);
      const fetcher = vi.fn();
      await expect(
        createLocalApiClient(fetcher, session).createProject(createInput(aspect)),
      ).rejects.toThrow("valid project input");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(aspects)(
    "rejects a different legal creation receipt from selected %s without retry",
    async (aspect) => {
      const input = createInput(aspect);
      let finish!: (value: Response) => void;
      const fetcher = vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
      const pending = createLocalApiClient(fetcher, session).createProject(input);
      const otherAspect = aspect === "16:9" ? "9:16" : "16:9";
      input.aspect_ratio = otherAspect;
      finish(response(project(otherAspect)));
      await expect(pending).rejects.toThrow("published contract");
      expect(fetcher).toHaveBeenCalledOnce();
      expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).aspect_ratio).toBe(aspect);
    },
  );

  it.each(["4:3", null, ["16:9"]])(
    "refuses unsupported saved aspect %j in create, list and detail",
    async (aspect) => {
      const fetcher = vi.fn(async () => response(project(aspect)));
      const api = createLocalApiClient(fetcher, session);
      await expect(api.createProject(createInput("16:9"))).rejects.toThrow("published contract");
      fetcher.mockImplementationOnce(async () => response([project(aspect)]));
      await expect(api.listProjects()).rejects.toThrow("published contract");
      await expect(api.getProject(p)).rejects.toThrow("published contract");
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it.each(aspects)("preserves saved %s in name-only PATCH receipts", async (aspect) => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      response(project(aspect, { name: "Renamed", revision: 2 }), 2),
    );
    const result = await createLocalApiClient(fetcher, session).updateProject(p, {
      expectedRevision: 1,
      name: "Renamed",
    });
    expect(result).toMatchObject({
      kind: "SUCCEEDED",
      receipt: { data: { aspect_ratio: aspect } },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]).toEqual([
      `${session.origin}/api/v1/projects/${p}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed" }),
        headers: expect.objectContaining({ "If-Match": '"revision-1"' }),
      }),
    ]);
  });

  it.each(["4:3", null, ["16:9"]])(
    "keeps unsupported PATCH receipt aspect %j UNKNOWN without retry",
    async (aspect) => {
      const fetcher = vi.fn(async () =>
        response(project(aspect, { name: "Renamed", revision: 2 }), 2),
      );
      expect(
        await createLocalApiClient(fetcher, session).updateProject(p, {
          expectedRevision: 1,
          name: "Renamed",
        }),
      ).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each(aspects)(
    "reads immutable %s settings and saves metadata with the ratio still read-only",
    async (aspect) => {
      const current = currentSettings(aspect);
      const saved = savedSettings(aspect);
      expect(isProjectAspectRatio(aspect)).toBe(true);
      expect(settingsResponse(current, p, requestId)).toBe(true);
      expect(settingsReceipt(saved, p, op, requestId)).toBe(true);
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => settingsHttp(saved));
      fetcher.mockImplementationOnce(async () => settingsHttp(current));
      const api = createLocalApiClient(fetcher, session);
      expect(await api.getProjectSettings(p)).toEqual({ kind: "FOUND", receipt: current });
      expect(await api.getProjectSettingsReceipt(p, op)).toEqual({ kind: "FOUND", receipt: saved });
      expect(await api.updateProjectSettings(p, settingsInput)).toEqual({
        kind: "FOUND",
        receipt: saved,
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
        [`${session.origin}/api/v1/projects/${p}/settings`, undefined],
        [`${session.origin}/api/v1/projects/${p}/settings/operations/${op}`, undefined],
        [`${session.origin}/api/v1/projects/${p}/settings`, "POST"],
      ]);
      expect(JSON.parse(String(fetcher.mock.calls[2]![1]?.body))).toEqual(settingsInput);
      expect(saved.boundary).toEqual(boundary);
      expect(saved.data.result.aspect_ratio).toBe(aspect);
    },
  );

  it.each(["4:3", null, ["16:9"]])(
    "keeps invalid saved settings aspect %j UNKNOWN across original reads and metadata writes",
    async (aspect) => {
      const current = {
        ...currentSettings("16:9"),
        data: { ...currentSettings("16:9").data, aspect_ratio: aspect },
      };
      const original = savedSettings("16:9");
      const saved = {
        ...original,
        data: { ...original.data, result: { ...original.data.result, aspect_ratio: aspect } },
      };
      expect(settingsResponse(current, p, requestId)).toBe(false);
      expect(settingsReceipt(saved, p, op, requestId)).toBe(false);
      const fetcher = vi.fn(async () => settingsHttp(saved));
      fetcher.mockImplementationOnce(async () => settingsHttp(current));
      const api = createLocalApiClient(fetcher, session);
      expect(await api.getProjectSettings(p)).toEqual({ kind: "UNKNOWN" });
      expect(await api.getProjectSettingsReceipt(p, op)).toEqual({ kind: "UNKNOWN" });
      expect(await api.updateProjectSettings(p, settingsInput)).toEqual({ kind: "UNKNOWN" });
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it("does not turn the metadata declaration into an aspect PATCH or settings write", async () => {
    const fetcher = vi.fn();
    const api = createLocalApiClient(fetcher, session);
    const patch = { expectedRevision: 1, name: "Renamed", aspect_ratio: "16:9" };
    expect(await api.updateProject(p, patch)).toEqual({ kind: "INVALID_INPUT" });
    const command = { ...settingsInput, changes: { aspect_ratio: "16:9" } };
    expect(settingsCommand(command)).toBe(false);
    await expect(
      api.updateProjectSettings(p, command as unknown as SettingsCommand),
    ).rejects.toThrow("Invalid project settings command");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
