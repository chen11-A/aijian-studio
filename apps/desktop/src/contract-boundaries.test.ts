import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";
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

function relativeRuntimeModuleLoads(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "preload-boundary.ts",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const loads: string[] = [];
  const isRelative = (specifier: ts.Expression | undefined): specifier is ts.StringLiteral =>
    specifier !== undefined && ts.isStringLiteral(specifier) && specifier.text.startsWith(".");
  const record = (kind: string, specifier: ts.StringLiteral) =>
    loads.push(`${kind}:${specifier.text}`);
  const importsRuntimeBinding = (declaration: ts.ImportDeclaration): boolean => {
    const clause = declaration.importClause;
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    if (clause.name || !clause.namedBindings) return true;
    if (ts.isNamespaceImport(clause.namedBindings)) return true;
    return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      isRelative(node.moduleSpecifier) &&
      importsRuntimeBinding(node)
    ) {
      record("import", node.moduleSpecifier);
    } else if (
      ts.isExportDeclaration(node) &&
      isRelative(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      record("export", node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isRelative(node.moduleReference.expression)
    ) {
      record("import-equals", node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      isRelative(node.arguments[0])
    ) {
      record("dynamic-import", node.arguments[0]);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      isRelative(node.arguments[0])
    ) {
      record("require", node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return loads;
}
const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const projectId = `prj_${"1".repeat(32)}`;

describe("privileged contract boundaries", () => {
  test("allows compiler-erased relative types and rejects relative runtime module loads", () => {
    expect(relativeRuntimeModuleLoads('import type { Token } from "./types";')).toEqual([]);
    expect(relativeRuntimeModuleLoads('import { type Token } from "./types";')).toEqual([]);
    expect(relativeRuntimeModuleLoads('type Token = import("./types").Token;')).toEqual([]);
    expect(relativeRuntimeModuleLoads('import "./runtime";')).toEqual(["import:./runtime"]);
    expect(relativeRuntimeModuleLoads('import { runtime } from "./runtime";')).toEqual([
      "import:./runtime",
    ]);
    expect(relativeRuntimeModuleLoads('import value = require("./runtime");')).toEqual([
      "import-equals:./runtime",
    ]);
    expect(relativeRuntimeModuleLoads('const value = require("./runtime");')).toEqual([
      "require:./runtime",
    ]);
  });
  test("keeps the sandboxed preload self-contained", () => {
    const preloadSource = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
    expect(relativeRuntimeModuleLoads(preloadSource)).toEqual([]);
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
    expect(preloadSource).toMatch(
      /ipcRenderer\.invoke\(\s*"fake-timeline-runs:create",\s*projectId,\s*command,?\s*\)/,
    );
    expect(preloadSource).not.toMatch(/ipcRenderer\.invoke\(channel|ipcRenderer\.send/);
  });

  test("wires invalidation detail through the exact privileged boundary", () => {
    const preloadSource = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
    const mainSource = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");

    expect(relativeRuntimeModuleLoads(preloadSource)).toEqual([]);
    expect(preloadSource).toMatch(
      /ipcRenderer\.invoke\(\s*"invalidation-operations:get",\s*projectId,\s*operationId,?\s*\)/,
    );
    expect(preloadSource).not.toMatch(/ipcRenderer\.invoke\(channel|ipcRenderer\.send/);
    expect(mainSource).toContain("registerInvalidationOperationHandlers<IpcMainInvokeEvent>(");
    expect(mainSource).not.toContain('ipcMain.handle("invalidation-operations:get"');
    expect(preloadSource).toMatch(
      /ipcRenderer\.invoke\(\s*"invalidation-operations:list",\s*projectId,\s*query === undefined \? \{\} : query,?\s*\)/,
    );
    expect(preloadSource).not.toContain("query ?? {}");
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
    expect(mainSource).toContain("registerFakeTimelineRunHandlers<IpcMainInvokeEvent>(");
    expect(mainSource).not.toContain('ipcMain.handle("fake-timeline-runs:create"');
    expect(mainSource).toMatch(
      /shouldEnableE2EFakeTimelineRunResponseFault\(\{[\s\S]*isPackaged: app\.isPackaged,[\s\S]*hasIsolatedUserDataProfile: hasIsolatedE2EUserDataProfile,[\s\S]*mode: process\.env\.AIJIAN_E2E_FAKE_TIMELINE_RUN_RESPONSE_FAULT,[\s\S]*\}\)/,
    );
    expect(mainSource).toMatch(
      /createE2EFakeTimelineRunResponseFault\(\s*createE2EProposalRunResponseFault\(fetch, proposalRunResponseFault\),\s*fakeTimelineRunResponseFault,?\s*\)/,
    );
  });

  test("does not expose proposal run creation through the ordinary Web HTTP transport", () => {
    const studioSource = readFileSync(
      resolve(process.cwd(), "../studio-web/src/api/studio.ts"),
      "utf8",
    );
    expect(studioSource).toContain("proposalRuns: {");
    expect(studioSource).not.toContain("/proposal-runs");
    expect(studioSource).toContain("fakeTimelineRuns:");
    expect(studioSource).not.toContain("/fake-timeline-runs");
    expect(studioSource).toContain('typeof bridge.createFakeTimelineRun === "function"');
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
