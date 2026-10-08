import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPendingProductionBriefCommand } from "./adapters/productionBriefWorkspace";
import { createAivoraSampleFixture, DemoProvider, moveShot, shotAtTime, useDemo } from "./model";
import { initialShots } from "./data";

const projectA = "prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const projectB = "prj_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const pendingKey = "aivora.production-brief.pending.v1";

async function sourceSha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const legalProductionBriefCommand = () => ({
  operation_id: "123e4567-e89b-42d3-a456-426614174000",
  input: {
    parent_version_id: null,
    expected_revision: null,
    change_summary: "initial brief",
    content: {
      schema_version: "1.0.0",
      creative_entry: { kind: "original_idea", origin_statement: "original", references: [] },
      creative: { premise: "premise", intent: "intent", constraints: [] },
      delivery: {
        width_px: 1920,
        height_px: 1080,
        language: "zh-CN",
        display_aspect_ratio: { num: 16, den: 9 },
        frame_rate: { num: 24, den: 1 },
      },
      duration_intent: { episode_mode: "unspecified", work_seconds: null, episode_seconds: null },
      budget_intent: { state: "declared", amount_micros: 1200000, currency: "USD" },
      rights_declaration: { state: "user_declared", statement: "I hold the necessary rights." },
    },
  },
});

let demo: ReturnType<typeof useDemo> | null = null;
function CaptureDemo() {
  demo = useDemo();
  return null;
}
function twoProjectFixture() {
  const fixture = createAivoraSampleFixture();
  fixture.projects = [
    {
      id: 1,
      backendId: projectA,
      name: "Project A",
      episode: "Episode A",
      image: "",
      status: "active",
      favorite: false,
      updated: "2026-09-15",
      revision: 1,
    },
    {
      id: 2,
      backendId: projectB,
      name: "Project B",
      episode: "Episode B",
      image: "",
      status: "active",
      favorite: false,
      updated: "2026-09-15",
      revision: 1,
    },
  ];
  fixture.values.projectId = "1";
  return fixture;
}
function productionBriefBridge(overrides: Record<string, unknown> = {}) {
  return {
    listProjects: vi.fn(() => new Promise(() => {})),
    importTextSource: vi
      .fn()
      .mockResolvedValue({ data: { id: "src_x", filename: "pasted-source.txt", blocks: [] } }),
    getProductionBrief: vi.fn().mockResolvedValue(null),
    createProductionBriefVersion: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    listProviderConnections: vi.fn().mockResolvedValue({ data: [] }),
    listProjectTasks: vi.fn().mockResolvedValue({ data: [] }),
    listInvalidationOperations: vi.fn().mockResolvedValue({ data: [], next_cursor: null }),
    getInvalidationOperation: vi.fn(),
    ...overrides,
  };
}
async function mountDemo(bridge: Record<string, unknown>) {
  Object.defineProperty(window, "aijian", { configurable: true, value: bridge });
  const view = render(
    <DemoProvider fixture={twoProjectFixture()}>
      <CaptureDemo />
    </DemoProvider>,
  );
  await act(async () => {});
  return view;
}

afterEach(() => {
  cleanup();
  demo = null;
  localStorage.clear();
  delete (window as { aijian?: unknown }).aijian;
  vi.restoreAllMocks();
});

describe("demo animatic timeline", () => {
  it("Q1 rejects a late import after project switch without clearing the new draft", async () => {
    let resolvePost!: (value: unknown) => void;
    const post = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const text = "旧项目原文";
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const response = {
      data: {
        id: `src_${"3".repeat(32)}`,
        project_id: projectA,
        raw_sha256: hash,
        filename: "pasted-source.txt",
        blocks: [{ text }],
      },
    };
    await mountDemo(
      productionBriefBridge({
        importTextSource: post,
        getSource: vi.fn().mockResolvedValue(response),
        listSources: vi.fn().mockResolvedValue({ data: [] }),
        getSourceManifest: vi.fn().mockResolvedValue(null),
      }),
    );
    let pending!: ReturnType<NonNullable<typeof demo>["importPastedSource"]>;
    await act(async () => {
      pending = demo!.importPastedSource(text);
    });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await act(async () => {
      await demo!.selectRealProject(2);
      demo!.put("source", "新项目未保存草稿");
    });
    expect(demo!.backendProjectId).toBe(projectB);
    let outcome: unknown;
    await act(async () => {
      resolvePost(response);
      outcome = await pending;
    });
    expect(outcome).toEqual({ kind: "STALE" });
    expect(demo!.backendProjectId).toBe(projectB);
    expect(demo!.value("source")).toBe("新项目未保存草稿");
    expect(demo!.sourceImportState.kind).not.toBe("saved");
  });
  it("Q1 retains UNKNOWN across remount and unlocks only matching identity without another POST", async () => {
    const text = "未决中文正文";
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const source = {
      id: `src_${"3".repeat(32)}`,
      project_id: projectA,
      raw_sha256: hash,
      filename: "pasted-source.txt",
      blocks: [{ text }],
    };
    const post = vi.fn().mockRejectedValue(new Error("unknown response"));
    const listSources = vi.fn().mockResolvedValue({ data: [] });
    const getSource = vi.fn().mockResolvedValue({ data: source });
    const getSourceText = vi.fn().mockResolvedValue({
      data: {
        id: source.id,
        project_id: projectA,
        raw_sha256: hash,
        normalized_text: text,
        normalized_sha256: hash,
      },
    });
    const bridge = productionBriefBridge({
      importTextSource: post,
      listSources,
      getSource,
      getSourceText,
      getSourceManifest: vi.fn().mockResolvedValue(null),
    });
    const first = await mountDemo(bridge);
    await act(async () => {
      await demo!.importPastedSource(text);
    });
    expect(demo!.sourceImportState.kind).toBe("unknown");
    const stored = localStorage.getItem(`aivora.source-import.v1:${projectA}`);
    expect(stored).toContain("UNKNOWN");
    first.unmount();
    await mountDemo(bridge);
    await act(async () => {
      await demo!.selectRealProject(1);
      await demo!.importPastedSource(text);
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`aivora.source-import.v1:${projectA}`)).toBe(stored);
    listSources.mockResolvedValue({ data: [{ ...source, raw_sha256: "b".repeat(64) }] });
    await act(async () => {
      await demo!.refreshRealSourceStage();
    });
    expect(demo!.sourceImportState.kind).not.toBe("saved");
    listSources.mockResolvedValue({ data: [source] });
    await act(async () => {
      await demo!.refreshRealSourceStage();
    });
    await waitFor(() => expect(demo!.sourceImportState.kind).toBe("saved"));
    expect(demo!.value("source")).toBe(text);
    expect(localStorage.getItem(`aivora.source-import.v1:${projectA}`)).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("Q1 refuses to dispatch when the local import journal cannot be written", async () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("aivora.source-import.v1:")) throw new Error("storage unavailable");
      return originalSetItem.call(this, key, value);
    });
    const post = vi.fn();
    const view = await mountDemo(productionBriefBridge({ importTextSource: post }));
    let result: unknown;
    await act(async () => {
      result = await demo!.importPastedSource("原文");
    });
    expect(result).toMatchObject({ kind: "REMOTE_UNKNOWN" });
    expect(post).not.toHaveBeenCalled();
    expect(demo!.sourceImportState.kind).toBe("unknown");
    expect(demo!.value("source")).not.toBe("原文");
    view.unmount();
  });

  it("Q1 refuses to dispatch when the source hash cannot be established", async () => {
    const post = vi.fn();
    const view = await mountDemo(productionBriefBridge({ importTextSource: post }));
    vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(new Error("crypto unavailable"));
    let result: unknown;
    await act(async () => {
      result = await demo!.importPastedSource("待核验原文");
    });
    expect(result).toMatchObject({ kind: "REMOTE_UNKNOWN" });
    expect(post).not.toHaveBeenCalled();
    expect(demo!.sourceImportState.kind).toBe("unknown");
    expect(localStorage.getItem(`aivora.source-import.v1:${projectA}`)).toBeNull();
    view.unmount();
  });

  it("Q1 keeps a verified import uncommitted when its local journal cannot be cleared", async () => {
    const text = "原文\n>\n> 对白";
    const hash = await sourceSha(text);
    const data = {
      id: `src_${"3".repeat(32)}`,
      project_id: projectA,
      filename: "pasted-source.txt",
      raw_sha256: hash,
      blocks: [{ id: "blk_1", ordinal: 1, text: "原文" }],
    };
    const post = vi.fn().mockResolvedValue({ data });
    const originalRemoveItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key) {
      if (key.startsWith("aivora.source-import.v1:")) throw new Error("clear unavailable");
      return originalRemoveItem.call(this, key);
    });
    const view = await mountDemo(
      productionBriefBridge({
        importTextSource: post,
        getSource: vi.fn().mockResolvedValue({ data }),
        getSourceText: vi.fn().mockResolvedValue({
          data: {
            id: data.id,
            project_id: projectA,
            raw_sha256: hash,
            normalized_text: text,
            normalized_sha256: hash,
          },
        }),
        getSourceManifest: vi.fn().mockResolvedValue(null),
      }),
    );
    let result: unknown;
    await act(async () => {
      result = await demo!.importPastedSource(text);
    });
    expect(result).toMatchObject({ kind: "REMOTE_UNKNOWN" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(demo!.sourceImportState.kind).toBe("unknown");
    expect(demo!.value("source")).not.toBe(text);
    expect(localStorage.getItem(`aivora.source-import.v1:${projectA}`)).toContain("PENDING");
    view.unmount();
  });
  it("Q1 rejects blank pasted text and non-TXT files before any import dispatch", async () => {
    const post = vi.fn();
    const view = await mountDemo(productionBriefBridge({ importTextSource: post }));
    let blank: unknown;
    let invalidFile: unknown;
    await act(async () => {
      blank = await demo!.importPastedSource(" \n ");
      invalidFile = await demo!.importRealSource(new File(["原文"], "story.md"));
    });
    expect(blank).toMatchObject({ kind: "INVALID_INPUT" });
    expect(invalidFile).toMatchObject({ kind: "INVALID_INPUT" });
    expect(post).not.toHaveBeenCalled();
    expect(demo!.sourceImportState.kind).toBe("invalid");
    view.unmount();
  });

  it("Q1 does not send a second POST while the first source import is pending", async () => {
    let rejectPost: (reason: Error) => void = () => {};
    const post = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectPost = reject;
        }),
    );
    const view = await mountDemo(productionBriefBridge({ importTextSource: post }));
    let first!: ReturnType<NonNullable<typeof demo>["importPastedSource"]>;
    await act(async () => {
      first = demo!.importPastedSource("第一份原文");
    });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    let second: unknown;
    await act(async () => {
      second = await demo!.importPastedSource("第二份原文");
    });
    expect(second).toMatchObject({ kind: "REMOTE_UNKNOWN" });
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectPost(new Error("response lost"));
      await first;
    });
    expect(demo!.sourceImportState.kind).toBe("unknown");
    view.unmount();
  });

  it("Q1 refuses import when the refreshed workspace has no real project identity", async () => {
    const post = vi.fn();
    const view = await mountDemo(
      productionBriefBridge({
        health: vi.fn().mockResolvedValue({ data: { status: "ok" } }),
        listProjects: vi.fn().mockResolvedValue({ data: [] }),
        importTextSource: post,
      }),
    );
    await act(async () => {
      await demo!.connectRealWorkspace();
    });
    expect(demo!.backendProjectId).toBeNull();
    let result: unknown;
    await act(async () => {
      result = await demo!.importPastedSource("未归属的原文");
    });
    expect(result).toMatchObject({ kind: "INVALID_INPUT" });
    expect(post).not.toHaveBeenCalled();
    expect(demo!.sourceImportState.kind).toBe("invalid");
    view.unmount();
  });
  it("advances at the exact shot boundary, and holds the final still at the end", () => {
    expect(shotAtTime(initialShots, 0)?.id).toBe(1);
    expect(shotAtTime(initialShots, 29.99)?.id).toBe(1);
    expect(shotAtTime(initialShots, 30)?.id).toBe(2);
    expect(shotAtTime(initialShots, 84.75)?.id).toBe(3);
    expect(shotAtTime(initialShots, 239.99)?.id).toBe(8);
    expect(shotAtTime(initialShots, 240)?.id).toBe(8);
    expect(shotAtTime(initialShots, 241)?.id).toBe(8);
  });
  it("uses edited durations to locate the reference frame", () => {
    const edited = initialShots.map((shot) => (shot.id === 1 ? { ...shot, duration: 1.5 } : shot));
    expect(shotAtTime(edited, 1.49)?.id).toBe(1);
    expect(shotAtTime(edited, 1.5)?.id).toBe(2);
  });
  it("reorders in both directions without losing objects or mutating the baseline", () => {
    const original = initialShots.map((shot) => shot.id);
    const moved = moveShot(initialShots, 1, 3);
    expect(moved.slice(0, 3).map((shot) => shot.id)).toEqual([2, 3, 1]);
    expect(moveShot(moved, 1, 2).map((shot) => shot.id)).toEqual(original);
    expect(initialShots.map((shot) => shot.id)).toEqual(original);
    expect(moved.reduce((sum, shot) => sum + shot.duration, 0)).toBe(240);
  });
  it("ignores stale drag references and identical targets", () => {
    expect(moveShot(initialShots, 999, 1)).toBe(initialShots);
    expect(moveShot(initialShots, 1, 999)).toBe(initialShots);
    expect(moveShot(initialShots, 1, 1)).toBe(initialShots);
    expect(shotAtTime([], 0)).toBeUndefined();
  });
});

describe("production brief recovery", () => {
  it("restores the exact source text on workspace connect without rebuilding block separators", async () => {
    const text = "镜头一\n>\n> 对白\n\n镜头二";
    const hash = await sourceSha(text);
    const source = {
      id: "src_connect",
      project_id: projectA,
      filename: "story.txt",
      raw_sha256: hash,
      blocks: [{ text: "镜头一" }, { text: ">" }, { text: "> 对白" }, { text: "镜头二" }],
    };
    const getSourceText = vi.fn().mockResolvedValue({
      data: {
        id: source.id,
        project_id: projectA,
        raw_sha256: hash,
        normalized_text: text,
        normalized_sha256: hash,
      },
    });
    const view = await mountDemo(
      productionBriefBridge({
        health: vi.fn().mockResolvedValue({ data: { status: "ok" } }),
        listProjects: vi.fn().mockResolvedValue({
          data: [
            {
              id: projectA,
              name: "Project A",
              status: "active",
              revision: 1,
              updated_at: "2026-09-23",
            },
          ],
        }),
        listSources: vi.fn().mockResolvedValue({ data: [{ id: source.id }] }),
        getSource: vi.fn().mockResolvedValue({ data: source }),
        getSourceText,
        getSourceManifest: vi.fn().mockResolvedValue(null),
      }),
    );
    await act(async () => {
      await demo!.connectRealWorkspace();
    });
    expect(demo!.backendProjectId).toBe(projectA);
    expect(demo!.value("source")).toBe(text);
    expect(getSourceText).toHaveBeenCalledWith(projectA, source.id);
    view.unmount();
  });

  it("keeps workspace reconnect untrusted when full source text fails its hash check", async () => {
    const text = "镜头一\n>\n> 对白";
    const hash = await sourceSha(text);
    const source = {
      id: "src_connect",
      project_id: projectA,
      filename: "story.txt",
      raw_sha256: hash,
      blocks: [{ text: "不完整的区块预览" }],
    };
    const view = await mountDemo(
      productionBriefBridge({
        health: vi.fn().mockResolvedValue({ data: { status: "ok" } }),
        listProjects: vi.fn().mockResolvedValue({
          data: [
            {
              id: projectA,
              name: "Project A",
              status: "active",
              revision: 1,
              updated_at: "2026-09-23",
            },
          ],
        }),
        listSources: vi.fn().mockResolvedValue({ data: [{ id: source.id }] }),
        getSource: vi.fn().mockResolvedValue({ data: source }),
        getSourceText: vi.fn().mockResolvedValue({
          data: {
            id: source.id,
            project_id: projectA,
            raw_sha256: hash,
            normalized_text: text,
            normalized_sha256: "0".repeat(64),
          },
        }),
        getSourceManifest: vi.fn().mockResolvedValue(null),
      }),
    );
    await act(async () => {
      await demo!.connectRealWorkspace();
    });
    expect(demo!.backendProjectId).toBe(projectA);
    expect(demo!.value("source")).toBe("");
    expect(demo!.sourceImportState.kind).toBe("unknown");
    view.unmount();
  });

  it("does not fall back to block previews after a selected project's full-text read fails", async () => {
    const text = "正确原文";
    const hash = await sourceSha(text);
    const source = {
      id: "src_selected",
      project_id: projectA,
      filename: "story.txt",
      raw_sha256: hash,
      blocks: [{ text: "错误区块预览" }],
    };
    const view = await mountDemo(
      productionBriefBridge({
        listSources: vi.fn().mockResolvedValue({ data: [{ id: source.id }] }),
        getSource: vi.fn().mockResolvedValue({ data: source }),
        getSourceText: vi.fn().mockRejectedValue(new Error("source text unavailable")),
        getSourceManifest: vi.fn().mockResolvedValue(null),
      }),
    );
    await act(async () => {
      demo!.put("source", "旧草稿");
      await demo!.selectRealProject(1);
    });
    expect(demo!.value("source")).toBe("");
    expect(demo!.sourceImportState.kind).toBe("unknown");
    view.unmount();
  });

  it("does not apply a late workspace reconnect full-text read after selecting another project", async () => {
    const text = "A 的完整原文\n>\n> 对白";
    const hash = await sourceSha(text);
    const source = {
      id: "src_reconnect",
      project_id: projectA,
      filename: "story.txt",
      raw_sha256: hash,
      blocks: [{ text: "区块预览" }],
    };
    let resolveText: (value: unknown) => void = () => {};
    const getSourceText = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveText = resolve;
        }),
    );
    const view = await mountDemo(
      productionBriefBridge({
        health: vi.fn().mockResolvedValue({ data: { status: "ok" } }),
        listProjects: vi.fn().mockResolvedValue({
          data: [
            {
              id: projectA,
              name: "Project A",
              status: "active",
              revision: 1,
              updated_at: "2026-09-23",
            },
            {
              id: projectB,
              name: "Project B",
              status: "active",
              revision: 1,
              updated_at: "2026-09-23",
            },
          ],
        }),
        listSources: vi.fn(async (projectId: string) => ({
          data: projectId === projectA ? [{ id: source.id }] : [],
        })),
        getSource: vi.fn().mockResolvedValue({ data: source }),
        getSourceText,
        getSourceManifest: vi.fn().mockResolvedValue(null),
      }),
    );
    let reconnect!: Promise<void>;
    await act(async () => {
      reconnect = demo!.connectRealWorkspace();
      await Promise.resolve();
    });
    await waitFor(() => expect(getSourceText).toHaveBeenCalledWith(projectA, source.id));
    await act(async () => {
      await demo!.selectRealProject(2);
      resolveText({
        data: {
          id: source.id,
          project_id: projectA,
          raw_sha256: hash,
          normalized_text: text,
          normalized_sha256: hash,
        },
      });
      await reconnect;
    });
    expect(demo!.backendProjectId).toBe(projectB);
    expect(demo!.value("source")).toBe("");
    view.unmount();
  });

  it("rebuilds one exact command, singleflights recovery, and retains it when the bridge is unavailable", async () => {
    const command = legalProductionBriefCommand();
    localStorage.setItem(pendingKey, JSON.stringify({ [projectA]: command }));
    const create = vi.fn<() => Promise<unknown>>();
    let resolveCreate: (value: unknown) => void = () => {};
    create.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const first = await mountDemo(productionBriefBridge({ createProductionBriefVersion: create }));

    await act(async () => {
      await demo!.selectRealProject(1);
    });
    const firstRecovery = demo!.recoverProductionBrief();
    const concurrentRecovery = demo!.recoverProductionBrief();
    expect(await concurrentRecovery).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]).toEqual([projectA, command]);
    await act(async () => {
      resolveCreate({ kind: "REMOTE_UNKNOWN" });
      await firstRecovery;
    });
    expect(readPendingProductionBriefCommand(projectA)).toMatchObject({ kind: "READY", command });
    first.unmount();

    const rebuilt = await mountDemo(
      productionBriefBridge({ createProductionBriefVersion: undefined }),
    );
    await act(async () => {
      await demo!.selectRealProject(1);
    });
    expect(await demo!.recoverProductionBrief()).toEqual({ kind: "UNAVAILABLE" });
    expect(readPendingProductionBriefCommand(projectA)).toMatchObject({ kind: "READY", command });
    rebuilt.unmount();
  });

  it("retains the exact command when a succeeded recovery cannot clear local storage", async () => {
    const command = legalProductionBriefCommand();
    localStorage.setItem(pendingKey, JSON.stringify({ [projectA]: command }));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === pendingKey && value === "{}") throw new Error("clear failure");
      return originalSetItem.call(this, key, value);
    });
    const create = vi
      .fn()
      .mockResolvedValue({ kind: "SUCCEEDED", receipt: { data: {}, request_id: "x" } });
    const view = await mountDemo(productionBriefBridge({ createProductionBriefVersion: create }));

    await act(async () => {
      await demo!.selectRealProject(1);
    });
    await act(async () => {
      await demo!.recoverProductionBrief();
    });
    expect(create.mock.calls[0]).toEqual([projectA, command]);
    expect(readPendingProductionBriefCommand(projectA)).toMatchObject({ kind: "READY", command });
    expect(demo!.pendingProductionBrief).toEqual(command);
    expect(demo!.productionBriefState).toBe("unknown");
    view.unmount();
  });

  it("keeps the C3 command and C2 selection on A after A to B to A", async () => {
    const command = legalProductionBriefCommand();
    localStorage.setItem(pendingKey, JSON.stringify({ [projectA]: command }));
    const view = await mountDemo(productionBriefBridge());

    await act(async () => {
      await demo!.selectRealProject(2);
      await demo!.selectRealProject(1);
    });
    expect(JSON.parse(localStorage.getItem("aivora.c2b.workspace-selection.v1")!)).toMatchObject({
      selection: { projectId: projectA, episodeId: null },
    });
    expect(readPendingProductionBriefCommand(projectA)).toMatchObject({ kind: "READY", command });
    view.unmount();
  });

  it("does not let a delayed B source read overwrite the later A selection", async () => {
    const hashes: Record<string, string> = {
      [projectA]: await sourceSha(projectA),
      [projectB]: await sourceSha(projectB),
    };
    let resolveA: (value: unknown) => void = () => {};
    let resolveB: (value: unknown) => void = () => {};
    const listSources = vi.fn(
      (projectId: string) =>
        new Promise((resolve) => {
          if (projectId === projectA) resolveA = resolve;
          else resolveB = resolve;
        }),
    );
    const getSource = vi.fn((projectId: string) =>
      Promise.resolve({
        data: {
          id: `src_${projectId}`,
          project_id: projectId,
          raw_sha256: hashes[projectId]!,
          filename: `${projectId}.txt`,
          blocks: [{ text: projectId }],
        },
      }),
    );
    const getSourceText = vi.fn(async (projectId: string, sourceId: string) => ({
      data: {
        id: sourceId,
        project_id: projectId,
        raw_sha256: hashes[projectId]!,
        normalized_text: projectId,
        normalized_sha256: hashes[projectId]!,
      },
    }));
    const view = await mountDemo(productionBriefBridge({ listSources, getSource, getSourceText }));
    let switchB!: Promise<void>;
    let switchA!: Promise<void>;

    await act(async () => {
      switchB = demo!.selectRealProject(2);
      switchA = demo!.selectRealProject(1);
      resolveB({ data: [{ id: "src_b" }] });
      resolveA({ data: [{ id: "src_a" }] });
      await Promise.all([switchB, switchA]);
    });
    expect(demo!.backendProjectId).toBe(projectA);
    expect(demo!.value("source")).toBe(projectA);
    expect(JSON.parse(localStorage.getItem("aivora.c2b.workspace-selection.v1")!)).toMatchObject({
      selection: { projectId: projectA, episodeId: null },
    });
    view.unmount();
  });

  it("does not let a delayed B full-text read overwrite the later A selection", async () => {
    const hashes: Record<string, string> = {
      [projectA]: await sourceSha(projectA),
      [projectB]: await sourceSha(projectB),
    };
    const listSources = vi.fn(async (projectId: string) => ({
      data: [{ id: `src_${projectId}` }],
    }));
    const getSource = vi.fn(async (projectId: string) => ({
      data: {
        id: `src_${projectId}`,
        project_id: projectId,
        raw_sha256: hashes[projectId]!,
        filename: `${projectId}.txt`,
        blocks: [{ text: projectId }],
      },
    }));
    let resolveB: (value: unknown) => void = () => {};
    const getSourceText = vi.fn((projectId: string, sourceId: string) =>
      projectId === projectB
        ? new Promise((resolve) => {
            resolveB = resolve;
          })
        : Promise.resolve({
            data: {
              id: sourceId,
              project_id: projectId,
              raw_sha256: hashes[projectId]!,
              normalized_text: projectId,
              normalized_sha256: hashes[projectId]!,
            },
          }),
    );
    const view = await mountDemo(productionBriefBridge({ listSources, getSource, getSourceText }));
    let switchB!: Promise<void>;
    await act(async () => {
      switchB = demo!.selectRealProject(2);
      await Promise.resolve();
    });
    await waitFor(() => expect(getSourceText).toHaveBeenCalledWith(projectB, `src_${projectB}`));
    await act(async () => {
      await demo!.selectRealProject(1);
      resolveB({
        data: {
          id: `src_${projectB}`,
          project_id: projectB,
          raw_sha256: hashes[projectB],
          normalized_text: projectB,
          normalized_sha256: hashes[projectB],
        },
      });
      await switchB;
    });
    expect(demo!.backendProjectId).toBe(projectA);
    expect(demo!.value("source")).toBe(projectA);
    view.unmount();
  });

  it("does not let a late B production-brief read overwrite A after A to B to A", async () => {
    let resolveA: (value: unknown) => void = () => {};
    let resolveB: (value: unknown) => void = () => {};
    const getProductionBrief = vi.fn(
      (projectId: string) =>
        new Promise((resolve) => {
          if (projectId === projectA) resolveA = resolve;
          else resolveB = resolve;
        }),
    );
    const view = await mountDemo(productionBriefBridge({ getProductionBrief }));
    let switchB!: Promise<void>;
    let switchA!: Promise<void>;
    await act(async () => {
      switchB = demo!.selectRealProject(2);
      switchA = demo!.selectRealProject(1);
      resolveA({ data: { marker: "A" } });
      await Promise.all([switchB, switchA]);
    });
    expect((demo!.productionBrief as unknown as { data: { marker: string } }).data.marker).toBe(
      "A",
    );
    await act(async () => {
      resolveB({ data: { marker: "B" } });
    });
    expect((demo!.productionBrief as unknown as { data: { marker: string } }).data.marker).toBe(
      "A",
    );
    view.unmount();
  });

  it("retains A's pending command when its delayed write returns after A to B to A", async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    const create = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const command = legalProductionBriefCommand();
    const view = await mountDemo(productionBriefBridge({ createProductionBriefVersion: create }));
    await act(async () => {
      await demo!.selectRealProject(1);
    });
    const write = demo!.saveProductionBrief(command as never);
    expect(create).toHaveBeenCalledWith(projectA, command);
    await act(async () => {
      await demo!.selectRealProject(2);
      await demo!.selectRealProject(1);
      resolveCreate({ kind: "SUCCEEDED", receipt: { data: { marker: "stale" } } });
      await write;
    });
    expect(readPendingProductionBriefCommand(projectA)).toMatchObject({ kind: "READY", command });
    expect(demo!.pendingProductionBrief).toEqual(command);
    view.unmount();
  });

  it("does not let B's late C3 success replace a stable A selection or receipt", async () => {
    let resolveB!: (value: unknown) => void;
    const create = vi.fn((projectId: string) =>
      projectId === projectB
        ? new Promise((resolve) => {
            resolveB = resolve;
          })
        : Promise.resolve({ kind: "REMOTE_UNKNOWN" }),
    );
    const getProductionBrief = vi.fn((projectId: string) =>
      Promise.resolve({ data: { marker: projectId === projectA ? "A" : "B" } }),
    );
    const commandB = legalProductionBriefCommand();
    commandB.operation_id = "123e4567-e89b-42d3-a456-426614174001";
    const view = await mountDemo(
      productionBriefBridge({ createProductionBriefVersion: create, getProductionBrief }),
    );
    await act(async () => {
      await demo!.selectRealProject(2);
    });
    const writeB = demo!.saveProductionBrief(commandB as never);
    expect(create).toHaveBeenCalledWith(projectB, commandB);
    await act(async () => {
      await demo!.selectRealProject(1);
      await Promise.resolve();
    });
    expect(demo!.backendProjectId).toBe(projectA);
    expect((demo!.productionBrief as unknown as { data: { marker: string } }).data.marker).toBe(
      "A",
    );
    await act(async () => {
      resolveB({ kind: "SUCCEEDED", receipt: { data: { marker: "late-B" } } });
      await writeB;
    });
    expect(demo!.backendProjectId).toBe(projectA);
    expect((demo!.productionBrief as unknown as { data: { marker: string } }).data.marker).toBe(
      "A",
    );
    expect(readPendingProductionBriefCommand(projectB)).toMatchObject({
      kind: "READY",
      command: commandB,
    });
    view.unmount();
  });

  it("retains each explicitly selected real episode across a C3 save and project reopen", async () => {
    const first = {
      id: `ep_${"1".repeat(32)}`,
      project_id: projectA,
      title: "First",
      position: "1",
      revision: "1",
      target_duration_seconds: null,
      is_default: true,
      created_at: "2026-09-15T00:00:00Z",
      updated_at: "2026-09-15T00:00:00Z",
    };
    const second = { ...first, id: `ep_${"2".repeat(32)}`, title: "Second", is_default: false };
    const bridge = productionBriefBridge({
      listEpisodes: vi.fn().mockResolvedValue({ request_id: "episodes", data: [first, second] }),
      getEpisode: vi.fn((_projectId: string, episodeId: string) =>
        Promise.resolve({
          request_id: `episode-${episodeId}`,
          data: episodeId === second.id ? second : first,
        }),
      ),
      createEpisode: vi.fn(),
      createProductionBriefVersion: vi.fn(async (_projectId: string, command: unknown) => ({
        kind: "SUCCEEDED",
        receipt: {
          request_id: "brief",
          data: {
            head: { revision: 1 },
            version: {
              id: `ver_${"c".repeat(32)}`,
              version_number: 1,
              content: (command as { input: { content: unknown } }).input.content,
            },
          },
        },
      })),
    });
    const view = await mountDemo(bridge);
    await act(async () => {
      await demo!.selectRealProject(1);
      await Promise.resolve();
      await demo!.selectRealEpisode(first.id);
    });
    expect(demo!.selectedEpisodeId).toBe(first.id);
    await act(async () => {
      await demo!.saveProductionBrief(legalProductionBriefCommand() as never);
    });
    await act(async () => {
      await demo!.selectRealProject(1);
      await Promise.resolve();
    });
    expect(demo!.selectedEpisodeId).toBe(first.id);
    await act(async () => {
      await demo!.selectRealEpisode(second.id);
    });
    expect(demo!.selectedEpisodeId).toBe(second.id);
    const secondCommand = legalProductionBriefCommand();
    secondCommand.operation_id = "123e4567-e89b-42d3-a456-426614174001";
    await act(async () => {
      await demo!.saveProductionBrief(secondCommand as never);
    });
    await act(async () => {
      await demo!.selectRealProject(1);
      await Promise.resolve();
    });
    expect(demo!.selectedEpisodeId).toBe(second.id);
    view.unmount();
  });
});
describe("source baseline confirmation", () => {
  const sourceContent = (blockSuffix = "a") => ({
    scope_type: "full_work",
    documents: [
      {
        source_document_id: "src_" + "d".repeat(32),
        blocks: [{ source_block_id: "srcb_" + blockSuffix.repeat(32), ordinal: 1 }],
      },
    ],
  });
  const reviewManifest = (content = sourceContent()) => {
    const version = "ver_" + "2".repeat(32);
    const hash = "sha256:" + "a".repeat(64);
    return {
      data: {
        project_id: projectA,
        head: {
          artifact_id: "art_" + "3".repeat(32),
          latest_version_id: version,
          review_version_id: version,
          review_submission_id: "sub_" + "4".repeat(32),
          accepted_version_id: null,
          revision: 2,
          review_evidence_revision: 0,
        },
        latest_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: version,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content,
        },
        review_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: version,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content,
        },
        accepted_version: null,
      },
    };
  };
  const acceptedManifest = (review: ReturnType<typeof reviewManifest>) => ({
    ...review,
    data: {
      ...review.data,
      head: { ...review.data.head, accepted_version_id: review.data.latest_version.id },
      accepted_version: review.data.latest_version,
    },
  });
  const confirmationSucceeded = (identity: {
    project_id: string;
    version_id: string;
    content_hash: string;
    expected_revision: number;
  }) => ({
    kind: "SUCCEEDED" as const,
    phase: "decision" as const,
    identity,
    completed_actions: ["decision"],
    receipts: [],
  });
  it("does not dispatch confirmation for a captured review target replaced before confirm", async () => {
    const oldVersion = "ver_" + "1".repeat(32);
    const newVersion = "ver_" + "2".repeat(32);
    const hash = "sha256:" + "a".repeat(64);
    const manifest = {
      data: {
        project_id: projectA,
        head: {
          artifact_id: "art_" + "3".repeat(32),
          latest_version_id: newVersion,
          review_version_id: newVersion,
          review_submission_id: "sub_" + "4".repeat(32),
          accepted_version_id: null,
          revision: 2,
          review_evidence_revision: 0,
        },
        latest_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: newVersion,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content: { scope_type: "full_work", documents: [] },
        },
        review_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: newVersion,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content: { scope_type: "full_work", documents: [] },
        },
        accepted_version: null,
      },
    };
    const confirmBaseline = vi.fn();
    await mountDemo(
      productionBriefBridge({
        getSourceManifest: vi.fn().mockResolvedValue(manifest),
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    await act(async () => {
      await demo!.selectRealProject(1);
    });
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: unknown, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    await expect(
      action(
        { project_id: projectA, version_id: oldVersion, content_hash: hash, expected_revision: 1 },
        "keep source",
      ),
    ).resolves.toBe(false);
    expect(confirmBaseline).not.toHaveBeenCalled();
  });

  it("passes the captured identity and trimmed rationale to the raw bridge, then accepts only its readback", async () => {
    const version = "ver_" + "2".repeat(32);
    const hash = "sha256:" + "a".repeat(64);
    const review = {
      data: {
        project_id: projectA,
        head: {
          artifact_id: "art_" + "3".repeat(32),
          latest_version_id: version,
          review_version_id: version,
          review_submission_id: "sub_" + "4".repeat(32),
          accepted_version_id: null,
          revision: 2,
          review_evidence_revision: 0,
        },
        latest_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: version,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content: { scope_type: "full_work", documents: [] },
        },
        review_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: version,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content: { scope_type: "full_work", documents: [] },
        },
        accepted_version: null,
      },
    };
    const accepted = {
      ...review,
      data: {
        ...review.data,
        head: { ...review.data.head, accepted_version_id: version },
        accepted_version: review.data.latest_version,
      },
    };
    const identity = {
      project_id: projectA,
      version_id: version,
      content_hash: hash,
      expected_revision: 2,
    };
    const getSourceManifest = vi.fn().mockResolvedValueOnce(review).mockResolvedValueOnce(accepted);
    const confirmBaseline = vi.fn().mockResolvedValue(confirmationSucceeded(identity));
    await mountDemo(
      productionBriefBridge({
        getSourceManifest,
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    await act(async () => {
      await demo!.selectRealProject(1);
    });
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    let confirmed = false;
    await act(async () => {
      confirmed = await action(identity, "  retain this reviewed source  ");
    });
    expect(confirmed).toBe(true);
    expect(confirmBaseline).toHaveBeenCalledWith({
      ...identity,
      rationale: "retain this reviewed source",
    });
    expect(getSourceManifest).toHaveBeenCalledTimes(2);
    expect(demo!.sourceStage).toMatchObject({ kind: "approved" });
  });

  it("rejects an accepted manifest whose legal source membership differs despite matching target ids and hash", async () => {
    const review = reviewManifest(sourceContent("a"));
    const version = review.data.latest_version.id;
    const hash = review.data.latest_version.content_hash;
    const identity = {
      project_id: projectA,
      version_id: version,
      content_hash: hash,
      expected_revision: 2,
    };
    const accepted = {
      ...review,
      data: {
        ...review.data,
        head: { ...review.data.head, accepted_version_id: version },
        accepted_version: { ...review.data.latest_version, content: sourceContent("b") },
      },
    };
    const confirmBaseline = vi.fn().mockResolvedValue(confirmationSucceeded(identity));
    await mountDemo(
      productionBriefBridge({
        getSourceManifest: vi.fn().mockResolvedValueOnce(review).mockResolvedValueOnce(accepted),
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    await act(async () => {
      await demo!.selectRealProject(1);
    });
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    let confirmed = true;
    await act(async () => {
      confirmed = await action(identity, "retain reviewed source");
    });
    expect(confirmed).toBe(false);
    expect(confirmBaseline).toHaveBeenCalledTimes(1);
    expect(demo!.sourceStage).toMatchObject({ kind: "error" });
  });

  it("singleflights a deferred preflight and prevents it from dispatching after source-away navigation", async () => {
    const review = reviewManifest();
    const identity = {
      project_id: projectA,
      version_id: review.data.latest_version.id,
      content_hash: review.data.latest_version.content_hash,
      expected_revision: 2,
    };
    let resolvePreflight: (value: typeof review) => void = () => {};
    const getSourceManifest = vi.fn(
      () => new Promise<typeof review>((resolve) => (resolvePreflight = resolve)),
    );
    const confirmBaseline = vi.fn();
    await mountDemo(
      productionBriefBridge({
        getSourceManifest,
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
        go: (page: "source" | "project") => void;
      }
    ).confirmRealSourceBaseline;
    await act(async () => {
      (demo as unknown as { go: (page: "source" | "project") => void }).go("source");
    });
    const first = action(identity, "retain reviewed source");
    await act(async () => {});
    await expect(action(identity, "retain reviewed source")).resolves.toBe(false);
    expect(getSourceManifest).toHaveBeenCalledTimes(1);
    await act(async () => {
      (demo as unknown as { go: (page: "source" | "project") => void }).go("project");
      (demo as unknown as { go: (page: "source" | "project") => void }).go("source");
      resolvePreflight(review);
      await first;
    });
    expect(confirmBaseline).not.toHaveBeenCalled();
  });

  it("quarantines remote-unknown confirmations without automatic replay, readback, or approval", async () => {
    const review = reviewManifest();
    const identity = {
      project_id: projectA,
      version_id: review.data.latest_version.id,
      content_hash: review.data.latest_version.content_hash,
      expected_revision: 2,
    };
    const getSourceManifest = vi.fn().mockResolvedValue(review);
    const confirmBaseline = vi.fn().mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
    await mountDemo(
      productionBriefBridge({
        getSourceManifest,
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    await expect(action(identity, "retain reviewed source")).resolves.toBe(false);
    await expect(action(identity, "retain reviewed source")).resolves.toBe(false);
    await act(async () => {
      await demo!.refreshRealSourceStage();
    });
    expect(confirmBaseline).toHaveBeenCalledTimes(1);
    expect(getSourceManifest).toHaveBeenCalledTimes(3);
    expect(demo!.sourceStage).not.toMatchObject({ kind: "approved" });
  });

  it("does not accept a cancelled confirmation", async () => {
    const review = reviewManifest();
    const identity = {
      project_id: projectA,
      version_id: review.data.latest_version.id,
      content_hash: review.data.latest_version.content_hash,
      expected_revision: 2,
    };
    const confirmBaseline = vi.fn().mockResolvedValue({
      kind: "CANCELLED",
      phase: "decision",
      identity,
      completed_actions: [],
      receipts: [],
    });
    await mountDemo(
      productionBriefBridge({
        getSourceManifest: vi.fn().mockResolvedValue(review),
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    await expect(action(identity, "retain reviewed source")).resolves.toBe(false);
    expect(confirmBaseline).toHaveBeenCalledTimes(1);
    expect(demo!.sourceStage).not.toMatchObject({ kind: "approved" });
  });

  it("keeps a deferred bridge confirmation singleflight until its successful readback", async () => {
    const review = reviewManifest();
    const accepted = acceptedManifest(review);
    const identity = {
      project_id: projectA,
      version_id: review.data.latest_version.id,
      content_hash: review.data.latest_version.content_hash,
      expected_revision: 2,
    };
    let resolveBridge: (value: ReturnType<typeof confirmationSucceeded>) => void = () => {};
    const confirmBaseline = vi.fn(
      () =>
        new Promise<ReturnType<typeof confirmationSucceeded>>(
          (resolve) => (resolveBridge = resolve),
        ),
    );
    await mountDemo(
      productionBriefBridge({
        getSourceManifest: vi.fn().mockResolvedValueOnce(review).mockResolvedValueOnce(accepted),
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    const first = action(identity, "retain reviewed source");
    await act(async () => {});
    await expect(action(identity, "retain reviewed source")).resolves.toBe(false);
    expect(confirmBaseline).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveBridge(confirmationSucceeded(identity));
    });
    await expect(first).resolves.toBe(true);
    expect(confirmBaseline).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful confirmation singleflight while its readback is deferred", async () => {
    const review = reviewManifest();
    const accepted = acceptedManifest(review);
    const identity = {
      project_id: projectA,
      version_id: review.data.latest_version.id,
      content_hash: review.data.latest_version.content_hash,
      expected_revision: 2,
    };
    let resolveReadback: (value: typeof accepted) => void = () => {};
    const getSourceManifest = vi
      .fn()
      .mockResolvedValueOnce(review)
      .mockImplementationOnce(
        () => new Promise<typeof accepted>((resolve) => (resolveReadback = resolve)),
      );
    const confirmBaseline = vi.fn().mockResolvedValue(confirmationSucceeded(identity));
    await mountDemo(
      productionBriefBridge({
        getSourceManifest,
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    const first = action(identity, "retain reviewed source");
    await act(async () => {});
    expect(confirmBaseline).toHaveBeenCalledTimes(1);
    await expect(action(identity, "retain reviewed source")).resolves.toBe(false);
    await act(async () => {
      resolveReadback(accepted);
    });
    await expect(first).resolves.toBe(true);
    expect(confirmBaseline).toHaveBeenCalledTimes(1);
  });

  it("does not let A to B to A replace the active source with a late A confirmation", async () => {
    const review = reviewManifest();
    const identity = {
      project_id: projectA,
      version_id: review.data.latest_version.id,
      content_hash: review.data.latest_version.content_hash,
      expected_revision: 2,
    };
    let resolvePreflight: (value: typeof review) => void = () => {};
    const getSourceManifest = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<typeof review>((resolve) => (resolvePreflight = resolve)),
      )
      .mockResolvedValue(review);
    const confirmBaseline = vi.fn();
    await mountDemo(
      productionBriefBridge({
        getSourceManifest,
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    const pending = action(identity, "retain reviewed source");
    await act(async () => {
      await demo!.selectRealProject(2);
      await demo!.selectRealProject(1);
      resolvePreflight(review);
      await pending;
    });
    expect(demo!.backendProjectId).toBe(projectA);
    expect(confirmBaseline).not.toHaveBeenCalled();
    expect(demo!.sourceStage).not.toMatchObject({ kind: "approved" });
  });

  it("does not dispatch a deferred preflight after back leaves the source page", async () => {
    const review = reviewManifest();
    const identity = {
      project_id: projectA,
      version_id: review.data.latest_version.id,
      content_hash: review.data.latest_version.content_hash,
      expected_revision: 2,
    };
    let resolvePreflight: (value: typeof review) => void = () => {};
    const getSourceManifest = vi.fn(
      () => new Promise<typeof review>((resolve) => (resolvePreflight = resolve)),
    );
    const confirmBaseline = vi.fn();
    await mountDemo(
      productionBriefBridge({
        getSourceManifest,
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    const controls = demo as unknown as {
      confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      go: (page: "source") => void;
      back: () => void;
    };
    await act(async () => {
      controls.go("source");
    });
    const pending = controls.confirmRealSourceBaseline(identity, "retain reviewed source");
    await act(async () => {
      controls.back();
      resolvePreflight(review);
      await pending;
    });
    expect(confirmBaseline).not.toHaveBeenCalled();
  });

  it("does not dispatch a deferred preflight after popstate leaves the source page", async () => {
    const review = reviewManifest();
    const identity = {
      project_id: projectA,
      version_id: review.data.latest_version.id,
      content_hash: review.data.latest_version.content_hash,
      expected_revision: 2,
    };
    let resolvePreflight: (value: typeof review) => void = () => {};
    const getSourceManifest = vi.fn(
      () => new Promise<typeof review>((resolve) => (resolvePreflight = resolve)),
    );
    const confirmBaseline = vi.fn();
    window.history.replaceState({}, "", "#source");
    await mountDemo(
      productionBriefBridge({
        getSourceManifest,
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    const pending = action(identity, "retain reviewed source");
    await act(async () => {
      window.history.replaceState({}, "", "#project");
      window.dispatchEvent(new PopStateEvent("popstate"));
      resolvePreflight(review);
      await pending;
    });
    expect(confirmBaseline).not.toHaveBeenCalled();
  });

  it("leaves confirmation unresolved when its post-commit manifest read fails", async () => {
    const version = "ver_" + "2".repeat(32);
    const hash = "sha256:" + "a".repeat(64);
    const review = {
      data: {
        project_id: projectA,
        head: {
          artifact_id: "art_" + "3".repeat(32),
          latest_version_id: version,
          review_version_id: version,
          review_submission_id: "sub_" + "4".repeat(32),
          accepted_version_id: null,
          revision: 2,
          review_evidence_revision: 0,
        },
        latest_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: version,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content: { scope_type: "full_work", documents: [] },
        },
        review_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: version,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content: { scope_type: "full_work", documents: [] },
        },
        accepted_version: null,
      },
    };
    const identity = {
      project_id: projectA,
      version_id: version,
      content_hash: hash,
      expected_revision: 2,
    };
    const confirmBaseline = vi.fn().mockResolvedValue(confirmationSucceeded(identity));
    await mountDemo(
      productionBriefBridge({
        getSourceManifest: vi
          .fn()
          .mockResolvedValueOnce(review)
          .mockRejectedValueOnce(new Error("readback")),
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    await act(async () => {
      await demo!.selectRealProject(1);
    });
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    let confirmed = true;
    await act(async () => {
      confirmed = await action(identity, "retain this reviewed source");
    });
    expect(confirmed).toBe(false);
    expect(confirmBaseline).toHaveBeenCalledTimes(1);
    expect(demo!.sourceStage).toMatchObject({ kind: "error" });
  });

  it("does not display approval when accepted readback has a mismatched content hash", async () => {
    const version = "ver_" + "2".repeat(32);
    const hash = "sha256:" + "a".repeat(64);
    const review = {
      data: {
        project_id: projectA,
        head: {
          artifact_id: "art_" + "3".repeat(32),
          latest_version_id: version,
          review_version_id: version,
          review_submission_id: "sub_" + "4".repeat(32),
          accepted_version_id: null,
          revision: 2,
          review_evidence_revision: 0,
        },
        latest_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: version,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content: { scope_type: "full_work", documents: [] },
        },
        review_version: {
          artifact_id: "art_" + "3".repeat(32),
          id: version,
          parent_version_id: null,
          version_number: 2,
          schema_version: "1.0.0",
          content_hash: hash,
          change_summary: "changed",
          created_at: "2026-09-15T00:00:00Z",
          content: { scope_type: "full_work", documents: [] },
        },
        accepted_version: null,
      },
    };
    const inconsistent = {
      ...review,
      data: {
        ...review.data,
        head: { ...review.data.head, accepted_version_id: version },
        accepted_version: {
          ...review.data.latest_version,
          content_hash: "sha256:" + "b".repeat(64),
        },
      },
    };
    const identity = {
      project_id: projectA,
      version_id: version,
      content_hash: hash,
      expected_revision: 2,
    };
    const confirmBaseline = vi.fn().mockResolvedValue(confirmationSucceeded(identity));
    await mountDemo(
      productionBriefBridge({
        getSourceManifest: vi
          .fn()
          .mockResolvedValueOnce(review)
          .mockResolvedValueOnce(inconsistent),
        submitSourceManifest: vi.fn(),
        confirmSourceManifestBaseline: confirmBaseline,
        copySourceManifestDraft: vi.fn(),
      }),
    );
    await act(async () => {
      await demo!.selectRealProject(1);
    });
    const action = (
      demo as unknown as {
        confirmRealSourceBaseline: (target: typeof identity, rationale: string) => Promise<boolean>;
      }
    ).confirmRealSourceBaseline;
    let confirmed = true;
    await act(async () => {
      confirmed = await action(identity, "retain this reviewed source");
    });
    expect(confirmed).toBe(false);
    expect(demo!.sourceStage).toMatchObject({ kind: "error" });
  });
});
