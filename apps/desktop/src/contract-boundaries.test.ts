import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  AGENT_SKILL_CATALOG_CHANNELS,
  createAgentSkillCatalogPreload,
  registerAgentSkillCatalogHandlers,
} from "./agent-skill-catalog-ipc";
import { isHealthResponse } from "./health-contract";
import { isCreateProviderConnectionInput } from "./provider-connection-contract";
import { canonicalLoopbackOrigin } from "./sidecar-origin";
import { isTaskQueueResponse } from "./task-queue-contract";

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const projectId = `prj_${"1".repeat(32)}`;

describe("privileged contract boundaries", () => {
  test("keeps the sandboxed preload self-contained", () => {
    const preloadSource = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
    expect(preloadSource).not.toMatch(/from\s+["']\.\//);
    expect(preloadSource).toContain('ipcRenderer.invoke("proposals:get", projectId, proposalId)');
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("proposals:accept-as-draft", projectId, proposalId, input)',
    );
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("proposals:reject", projectId, proposalId, input)',
    );
    expect(preloadSource).toContain('ipcRenderer.invoke("agents:list", projectId)');
    expect(preloadSource).toContain('ipcRenderer.invoke("skills:list", projectId)');
    expect(preloadSource).toMatch(
      /ipcRenderer\.invoke\(\s*"proposal-runs:create",\s*projectId,\s*command,?\s*\)/,
    );
    expect(preloadSource).not.toMatch(/ipcRenderer\.invoke\(channel|ipcRenderer\.send/);
  });

  test("registers proposal run creation only through the exact main-process handler", () => {
    const mainSource = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(mainSource).toContain("registerProposalRunHandlers<IpcMainInvokeEvent>(");
    expect(mainSource).not.toContain('ipcMain.handle("proposal-runs:create"');
    expect(mainSource).toContain(
      "const hasIsolatedE2EUserDataProfile = configureDevelopmentUserData();",
    );
    expect(mainSource).toMatch(
      /shouldEnableE2EProposalRunResponseFault\(\{[\s\S]*isPackaged: app\.isPackaged,[\s\S]*hasIsolatedUserDataProfile: hasIsolatedE2EUserDataProfile,[\s\S]*mode: process\.env\.AIJIAN_E2E_PROPOSAL_RUN_RESPONSE_FAULT,[\s\S]*\}\)/,
    );
    expect(mainSource).toContain(
      "createE2EProposalRunResponseFault(fetch, proposalRunResponseFault)",
    );
  });

  test("does not expose proposal run creation through the ordinary Web HTTP transport", () => {
    const studioSource = readFileSync(
      resolve(process.cwd(), "../studio-web/src/api/studio.ts"),
      "utf8",
    );
    expect(studioSource).toContain("proposalRuns: {");
    expect(studioSource).not.toContain("/proposal-runs");
  });

  test("rejects malformed nested health payloads", () => {
    expect(isHealthResponse({ data: null, request_id: requestId })).toBe(false);
  });

  test("rejects an unparseable provider URL before privileged fetch", () => {
    expect(
      isCreateProviderConnectionInput({
        provider_kind: "OLLAMA",
        display_name: "坏地址",
        base_url: "http://[",
        enabled: true,
        models: [{ model_id: "qwen-local", capabilities: ["TEXT"] }],
      }),
    ).toBe(false);
  });

  test("rejects malformed task response layers and task items", () => {
    expect(isTaskQueueResponse({}, projectId)).toBe(false);
    expect(
      isTaskQueueResponse(
        {
          data: {
            project_id: `prj_${"2".repeat(32)}`,
            summary: { total: 0, attention: 0, active: 0, completed: 0 },
            tasks: [],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
    expect(
      isTaskQueueResponse(
        {
          data: {
            project_id: projectId,
            summary: { total: 1, attention: 0, active: 1, completed: 0 },
            tasks: [null],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
  });

  test("accepts only a canonical sidecar origin", () => {
    expect(canonicalLoopbackOrigin("http://127.0.0.1:43123")).toBe("http://127.0.0.1:43123");
    expect(() => canonicalLoopbackOrigin("not-a-url")).toThrow("canonical loopback");
    expect(() => canonicalLoopbackOrigin("http://localhost:43123")).toThrow("canonical loopback");
  });

  test("keeps Agent and Skill catalog IPC read-only and exact-keyed", () => {
    expect(AGENT_SKILL_CATALOG_CHANNELS).toEqual({
      listProjectAgents: "agents:list",
      listProjectSkills: "skills:list",
    });
    expect(Object.isFrozen(AGENT_SKILL_CATALOG_CHANNELS)).toBe(true);
  });

  test("maps catalog preload calls and main handlers to the exact read methods", async () => {
    const invoke = vi.fn().mockResolvedValue({});
    const bridge = createAgentSkillCatalogPreload(invoke);
    await bridge.listProjectAgents(projectId);
    await bridge.listProjectSkills(projectId);
    expect(invoke).toHaveBeenNthCalledWith(1, "agents:list", projectId);
    expect(invoke).toHaveBeenNthCalledWith(2, "skills:list", projectId);

    const listeners = new Map<
      string,
      (event: object, scopedProjectId: string) => Promise<unknown>
    >();
    const event = {};
    const client = {
      listProjectAgents: vi.fn().mockResolvedValue({}),
      listProjectSkills: vi.fn().mockResolvedValue({}),
    };
    registerAgentSkillCatalogHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      () => client,
    );
    await listeners.get("agents:list")!(event, projectId);
    await listeners.get("skills:list")!(event, projectId);
    expect([...listeners]).toHaveLength(2);
    expect(client.listProjectAgents).toHaveBeenCalledWith(projectId);
    expect(client.listProjectSkills).toHaveBeenCalledWith(projectId);
  });
});
