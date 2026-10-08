import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MediaGenerationInputResponse } from "../api/studio";
import { MediaPages } from "./MediaPages";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "./model";
import { rawMediaPackageJson, readInputSaveMarker, verifyInputSaveReceipt } from "./adapters/mediaGeneration";

const ports = vi.hoisted(() => ({ current: vi.fn(), save: vi.fn(), get: vi.fn() }));
vi.mock("../api/studio", async (original) => {
  const actual = await original<typeof import("../api/studio")>();
  return { ...actual, createStudioTransport: () => ({ ...actual.createStudioTransport(),
    getHealth: async () => { throw new Error("isolated fixture: no backend"); },
    getCurrentMediaGenerationInput: ports.current,
    prepareAndSaveMediaGenerationInput: ports.save,
    getMediaGenerationInput: ports.get,
    listSources: async () => ({ request_id: "qa", data: [] }),
    getSourceManifest: async () => null,
  }) };
});
const pid = `prj_${"a".repeat(32)}`;
const otherPid = `prj_${"f".repeat(32)}`;
const op = "12345678-1234-4234-8234-123456789abc";
function receipt(): MediaGenerationInputResponse {
  return { request_id: "qa", data: {
    project_id: pid, input_id: "main", operation_id: op,
    version_id: `ver_${"b".repeat(32)}`, artifact_id: `art_${"c".repeat(32)}`,
    content_hash: `sha256:${"d".repeat(64)}`, head_revision: 1,
    confirmation_id: "confirmation", confirmation_actor_id: "actor", confirmed_at: "2026-09-21T00:00:00Z",
    package: { schema_version: "media_generation_input.v1",
      screenplay: { component_id: "screenplay:original", text: "保存的剧本全文" },
      characters: [{ component_id: "character:original", name: "人物甲",
        content: { description: "蓝色外套", content_hash: "author-owned", nested: { text_hash: "keep" } },
        source_hashes: [`sha256:${"e".repeat(64)}`] }],
      shots: [{ component_id: "shot:original", ordinal: 1, start_frame: 0, duration_frames: 26,
        script_excerpt: "摘录", dialogue: "再见", action: "回头", character_component_ids: ["character:original"] }],
      delivery: { frame_rate_num: 25, frame_rate_den: 1, total_frames: 26, duration_seconds: 1.04 },
    },
  } };
}
function ScopeControls() {
  const d = useDemo();
  return <><button onClick={() => void d.selectRealProject(2)}>QA switch B</button>
    <output data-testid="qa-values">{JSON.stringify(d.values)}</output></>;
}
function mount(draft = "", extra: Record<string, string> = {}) {
  window.history.replaceState({}, "", "#generation");
  const fixture = createAivoraSampleFixture();
  fixture.projects = fixture.projects.map((p, index) => ({ ...p, backendId: index === 0 ? pid : otherPid }));
  fixture.values = { ...fixture.values, projectId: String(fixture.projects[0]!.id),
    ...(draft ? { [`generation-input:${pid}:project:screenplay`]: draft } : {}), ...extra };
  return render(<DemoProvider fixture={fixture}><MediaPages /><ScopeControls /></DemoProvider>);
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); ports.current.mockResolvedValue(receipt()); });
afterEach(cleanup);

it("loads empty draft and preserves character metadata, associations and fractional seconds on cancellation", async () => {
  ports.save.mockImplementation(async (_pid, input) => ({ kind: "CANCELLED", operation_id: input.operation_id }));
  mount();
  await waitFor(() => expect(screen.getByLabelText("真实生成剧本全文")).toHaveValue("保存的剧本全文"));
  fireEvent.click(screen.getByRole("button", { name: "确认并保存生成输入" }));
  await screen.findByText("已取消确认，未保存本次修改；草稿保留。");
  expect(ports.save).toHaveBeenCalledTimes(1);
  expect(ports.save.mock.calls[0]![1].package).toEqual(receipt().data.package);
  expect(screen.getByLabelText("真实生成剧本全文")).toHaveValue("保存的剧本全文");
  expect(readInputSaveMarker(localStorage, pid)?.state).toBe("cancelled");
});

it("preserves an unsaved draft until explicit two-step replacement", async () => {
  mount("我的未保存草稿");
  await screen.findByText(/已读取项目当前保存版本/);
  expect(screen.getByLabelText("真实生成剧本全文")).toHaveValue("我的未保存草稿");
  fireEvent.click(screen.getByText(/查看服务端保存版本/));
  fireEvent.click(screen.getByRole("button", { name: "载入已保存版本" }));
  expect(screen.getByLabelText("真实生成剧本全文")).toHaveValue("我的未保存草稿");
  fireEvent.click(screen.getByRole("button", { name: "确认载入并替换草稿" }));
  expect(screen.getByLabelText("真实生成剧本全文")).toHaveValue("保存的剧本全文");
  expect(ports.save).not.toHaveBeenCalled();
});

it("keeps UNKNOWN pending and queries without automatically posting again", async () => {
  ports.save.mockImplementation(async (_pid, input) => ({ kind: "REMOTE_UNKNOWN", operation_id: input.operation_id }));
  ports.get.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
  mount();
  await waitFor(() => expect(screen.getByRole("button", { name: "确认并保存生成输入" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "确认并保存生成输入" }));
  await screen.findByText(/未取得保存成功回执/);
  fireEvent.click(screen.getByRole("button", { name: "查询上次保存结果" }));
  await screen.findByText(/尚未取得权威保存结果/);
  expect(ports.save).toHaveBeenCalledTimes(1);
  expect(ports.get).toHaveBeenCalledTimes(1);
  expect(readInputSaveMarker(localStorage, pid)?.state).toBe("pending");
});

it("does not ignore nested author hash names when validating a receipt", () => {
  const saved = receipt().data;
  const marker = { schemaVersion: 1 as const, projectId: pid, operationId: op,
    expectedRevision: 0, packageJson: rawMediaPackageJson(saved.package), state: "pending" as const };
  expect(() => verifyInputSaveReceipt(saved, marker)).not.toThrow();
  saved.package.characters[0]!.content.content_hash = "changed-author-content";
  expect(() => verifyInputSaveReceipt(saved, marker)).toThrow();
});

it("ignores a late A current response after switching to B", async () => {
  let resolveA!: (value: MediaGenerationInputResponse) => void;
  ports.current.mockImplementation((id: string) => id === pid
    ? new Promise<MediaGenerationInputResponse>((resolve) => { resolveA = resolve; })
    : Promise.resolve({ ...receipt(), data: { ...receipt().data, project_id: otherPid,
        package: { ...receipt().data.package, screenplay: { component_id: "screenplay:B", text: "项目B全文" } } } }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "QA switch B" }));
  await waitFor(() => expect(screen.getByLabelText("真实生成剧本全文")).toHaveValue("项目B全文"));
  await act(async () => resolveA(receipt()));
  expect(screen.getByLabelText("真实生成剧本全文")).toHaveValue("项目B全文");
  expect(screen.queryByDisplayValue("保存的剧本全文")).not.toBeInTheDocument();
});

it("replaces only the active draft scope and clears leftover fields there", async () => {
  const a = `generation-input:${pid}:project:`;
  const b = `generation-input:${otherPid}:project:`;
  mount("我的草稿", { [a + "shotText-9"]: "obsolete", [b + "screenplay"]: "B草稿" });
  await screen.findByText(/已读取项目当前保存版本/);
  fireEvent.click(screen.getByText(/查看服务端保存版本/));
  fireEvent.click(screen.getByRole("button", { name: "载入已保存版本" }));
  fireEvent.click(screen.getByRole("button", { name: "确认载入并替换草稿" }));
  const values = JSON.parse(screen.getByTestId("qa-values").textContent!);
  expect(values[a + "shotText-9"]).toBe("");
  expect(values[b + "screenplay"]).toBe("B草稿");
});
