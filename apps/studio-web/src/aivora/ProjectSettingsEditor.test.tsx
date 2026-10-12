import "@testing-library/jest-dom/vitest";
import { createHash, webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { settingsIdentity } from "@aijian/contracts/project-settings";
import type {
  ProjectSettings,
  ProjectSettingsGateway,
  SettingsResponse,
  SettingsReceipt,
} from "@aijian/contracts/project-settings";
import { ProjectSettingsEditor } from "./ProjectSettingsEditor";
import { AssemblyProjectTimebase } from "./AssemblyProjectTimebase";
import { emptyAssembly } from "./adapters/assemblyEditing";

const p = `prj_${"1".repeat(32)}`,
  b = `prj_${"2".repeat(32)}`,
  date = "2026-10-11T10:00:00Z";
const boundary: SettingsResponse["boundary"] = {
  settings_scope: "PROJECT_METADATA_ONLY",
  existing_artifact_versions_modified: false,
  sequence_timebase_effect: "DECLARED_DEFAULT_REQUIRES_EXPLICIT_ADOPTION",
  aspect_duration_language: "READ_ONLY_PENDING_CONSUMER_CAPABILITIES",
  episode_settings: "SEPARATE_EPISODE_CAS",
  production_intent: "SEPARATE_PRODUCTION_BRIEF_VERSION",
  generation_remote_version_policies: "NO_EDITABLE_PROJECT_POLICY_CONTRACT",
};
function data(projectId = p): ProjectSettings {
  return {
    schema_version: 1,
    project_id: projectId,
    name: projectId === p ? "A" : "B",
    description: "原说明",
    status: "active",
    sequence_timebase: null,
    aspect_ratio: "9:16",
    target_duration_seconds: 90,
    source_language: "zh-CN",
    revision: 1,
    created_at: date,
    updated_at: date,
  };
}
const response = (value: ProjectSettings): SettingsResponse => ({
  data: value,
  boundary,
  request_id: "00000000-0000-4000-8000-000000000000",
});
function env() {
  const states = new Map([
      [p, data(p)],
      [b, data(b)],
    ]),
    receipts = new Map<string, SettingsReceipt>();
  const api: ProjectSettingsGateway = {
    getProjectSettings: vi.fn(async (id) => ({
      kind: "FOUND" as const,
      receipt: response(states.get(id)!),
    })),
    updateProjectSettings: vi.fn(async (id, command) => {
      const current = states.get(id)!;
      const result: ProjectSettings = {
        ...current,
        name: command.changes.name ?? current.name,
        description: command.changes.description ?? current.description,
        sequence_timebase: command.changes.sequence_timebase ?? null,
        revision: current.revision + 1,
      };
      states.set(id, result);
      const receipt: SettingsReceipt = {
        data: {
          project_id: id,
          operation_id: command.operation_id,
          request_hash: `sha256:${createHash("sha256").update(settingsIdentity(id, command)).digest("hex")}`,
          base_revision: command.expected_project_revision,
          result_revision: result.revision,
          result,
          created_at: date,
        },
        boundary,
        request_id: response(result).request_id,
      };
      receipts.set(command.operation_id, receipt);
      return { kind: "FOUND" as const, receipt };
    }),
    getProjectSettingsReceipt: vi.fn(async (id, operationId) => {
      const receipt = receipts.get(operationId);
      return receipt && receipt.data.project_id === id
        ? { kind: "FOUND" as const, receipt }
        : { kind: "REJECTED" as const, status: 404, code: "PROJECT_SETTINGS_RECEIPT_NOT_FOUND" };
    }),
  };
  return { api, states, receipts };
}
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function ready() {
  await waitFor(() => expect(screen.getByLabelText("项目名称")).toHaveValue("A"));
}
it.each(["9:16", "16:9"] as const)(
  "saves metadata preserving readonly %s aspect and exact receipt",
  async (aspect) => {
    const e = env(),
      guard = vi.fn();
    e.states.set(p, { ...e.states.get(p)!, aspect_ratio: aspect });
    render(<ProjectSettingsEditor projectId={p} gateway={e.api} setNavigationGuard={guard} />);
    await ready();
    expect(screen.getByLabelText("画幅（创建时确定）")).toHaveValue(aspect);
    expect(screen.getByLabelText("画幅（创建时确定）")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "新作品" } });
    fireEvent.change(screen.getByLabelText("项目说明"), { target: { value: "新说明\n第二行" } });
    fireEvent.change(screen.getByLabelText("项目默认时基"), {
      target: {
        value: JSON.stringify({ frame_rate: { den: 1, num: 24 }, timecode_mode: "NON_DROP_FRAME" }),
      },
    });
    expect(guard.mock.calls.at(-1)?.[0]()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "保存项目设置" }));
    await screen.findByText("项目设置已保存，精确操作回执与当前修订均已读回。");
    expect(e.states.get(p)?.sequence_timebase?.frame_rate.num).toBe(24);
    expect(e.states.get(p)?.aspect_ratio).toBe(aspect);
    expect(e.api.updateProjectSettings).toHaveBeenCalledWith(
      p,
      expect.objectContaining({
        changes: expect.not.objectContaining({ aspect_ratio: expect.anything() }),
      }),
    );
    expect(e.api.updateProjectSettings).toHaveBeenCalledTimes(1);
    expect(e.api.getProjectSettingsReceipt).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(`aivora:project-settings:operation:v1:${p}`)).toBeNull();
    expect(guard.mock.calls.at(-1)?.[0]()).toBe(true);
  },
);
it("keeps UNKNOWN locked across remount, restores target input and uses GET without resend", async () => {
  const e = env(),
    real = e.api.updateProjectSettings;
  e.api.updateProjectSettings = vi.fn(async (id, c) => {
    await real(id, c);
    return { kind: "UNKNOWN" as const };
  });
  const view = render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await ready();
  fireEvent.change(screen.getByLabelText("项目说明"), { target: { value: "待核对原输入" } });
  fireEvent.click(screen.getByRole("button", { name: "保存项目设置" }));
  await screen.findByText("保存结果未知；原操作已锁定，请只读核对回执，不会自动重发。");
  view.unmount();
  render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await ready();
  expect(screen.getByLabelText("项目说明")).toHaveValue("待核对原输入");
  expect(screen.getByRole("button", { name: "保存项目设置" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "只读核对原操作回执" }));
  await screen.findByText("项目设置已保存，精确操作回执与当前修订均已读回。");
  expect(e.api.updateProjectSettings).toHaveBeenCalledTimes(1);
});
it("a missing or wrong-hash receipt does not unlock UNKNOWN", async () => {
  const e = env();
  e.api.updateProjectSettings = vi.fn(async () => ({ kind: "UNKNOWN" as const }));
  render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await ready();
  fireEvent.change(screen.getByLabelText("项目说明"), { target: { value: "pending" } });
  fireEvent.click(screen.getByRole("button", { name: "保存项目设置" }));
  await screen.findByText(/保存结果未知；原操作已锁定，请/);
  fireEvent.click(screen.getByRole("button", { name: "只读核对原操作回执" }));
  await screen.findByText(/尚未找到匹配的已提交回执/);
  const command = vi.mocked(e.api.updateProjectSettings).mock.calls[0]![1];
  const wrong: SettingsReceipt = {
    data: {
      project_id: p,
      operation_id: command.operation_id,
      base_revision: 1,
      result_revision: 2,
      request_hash: `sha256:${"0".repeat(64)}`,
      result: { ...data(), description: "pending", revision: 2 },
      created_at: date,
    },
    boundary,
    request_id: response(data()).request_id,
  };
  e.api.getProjectSettingsReceipt = vi.fn(async () => ({ kind: "FOUND" as const, receipt: wrong }));
  fireEvent.click(screen.getByRole("button", { name: "只读核对原操作回执" }));
  await waitFor(() => expect(e.api.getProjectSettingsReceipt).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "保存项目设置" })).toBeDisabled();
  expect(e.api.updateProjectSettings).toHaveBeenCalledTimes(1);
});
it("preserves unsaved text on explicit refresh and revision rejection", async () => {
  const e = env();
  render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await ready();
  fireEvent.change(screen.getByLabelText("项目说明"), { target: { value: "未保存说明" } });
  e.states.set(p, { ...data(), revision: 2, name: "别处改名" });
  fireEvent.click(screen.getByRole("button", { name: "重新读取项目" }));
  await screen.findByText("已读回当前修订，保留未保存草稿；请核对后保存。");
  expect(screen.getByLabelText("项目说明")).toHaveValue("未保存说明");
  e.api.updateProjectSettings = vi.fn(async () => ({
    kind: "REJECTED" as const,
    status: 409,
    code: "PROJECT_SETTINGS_CONFLICT",
  }));
  fireEvent.click(screen.getByRole("button", { name: "保存项目设置" }));
  await screen.findByText(/保存被拒绝/);
  expect(screen.getByLabelText("项目说明")).toHaveValue("未保存说明");
  expect(screen.getByRole("button", { name: "保存项目设置" })).toBeDisabled();
});
it("does not unlock a corrupt operation journal by reading current settings", async () => {
  window.localStorage.setItem(`aivora:project-settings:operation:v1:${p}`, "{broken");
  const e = env();
  render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await screen.findByText("本地操作记录无法核实，已阻止保存。");
  fireEvent.click(screen.getByRole("button", { name: "重新读取项目" }));
  await ready();
  fireEvent.change(screen.getByLabelText("项目说明"), { target: { value: "new" } });
  expect(screen.getByRole("button", { name: "保存项目设置" })).toBeDisabled();
  expect(e.api.updateProjectSettings).not.toHaveBeenCalled();
});
it("retains a replaced or undeletable journal when recovering an exact historical receipt", async () => {
  const e = env(),
    real = e.api.updateProjectSettings;
  e.api.updateProjectSettings = vi.fn(async (id, c) => {
    await real(id, c);
    return { kind: "UNKNOWN" as const };
  });
  render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await ready();
  fireEvent.change(screen.getByLabelText("项目说明"), { target: { value: "pending" } });
  fireEvent.click(screen.getByRole("button", { name: "保存项目设置" }));
  await screen.findByText(/保存结果未知；原操作已锁定，请/);
  const key = `aivora:project-settings:operation:v1:${p}`,
    original = window.localStorage.getItem(key)!;
  window.localStorage.setItem(key, "{replaced");
  fireEvent.click(screen.getByRole("button", { name: "只读核对原操作回执" }));
  await screen.findByText("回执核对失败；原操作继续锁定，不会重新发送。");
  expect(window.localStorage.getItem(key)).toBe("{replaced");
  expect(screen.getByRole("button", { name: "保存项目设置" })).toBeDisabled();
  window.localStorage.setItem(key, original);
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "只读核对原操作回执" }));
  await waitFor(() => expect(remove).toHaveBeenCalled());
  expect(window.localStorage.getItem(key)).toBe(original);
  expect(screen.getByRole("button", { name: "保存项目设置" })).toBeDisabled();
  expect(e.api.updateProjectSettings).toHaveBeenCalledTimes(1);
});
it("rejects obsolete read results after A→B→A without filling the wrong settings", async () => {
  const e = env();
  let finish: (
    value: Awaited<ReturnType<ProjectSettingsGateway["getProjectSettings"]>>,
  ) => void = () => {};
  vi.mocked(e.api.getProjectSettings).mockImplementationOnce(
    () =>
      new Promise<Awaited<ReturnType<ProjectSettingsGateway["getProjectSettings"]>>>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await waitFor(() => expect(e.api.getProjectSettings).toHaveBeenCalledTimes(1));
  view.rerender(<ProjectSettingsEditor projectId={b} gateway={e.api} />);
  await waitFor(() => expect(screen.getByLabelText("项目名称")).toHaveValue("B"));
  view.rerender(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await ready();
  await act(async () =>
    finish({ kind: "FOUND" as const, receipt: response({ ...data(), name: "obsolete A" }) }),
  );
  expect(screen.getByLabelText("项目名称")).toHaveValue("A");
});
it("protects unsaved input at renderer unload and removes the close listener on unmount", async () => {
  const e = env(),
    view = render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await ready();
  fireEvent.change(screen.getByLabelText("项目说明"), { target: { value: "x".repeat(4000) } });
  const before = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(true);
  expect(e.api.updateProjectSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消未保存草稿" }));
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  view.unmount();
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
it("explicitly adopts only a verified project default into an empty episode assembly", async () => {
  const e = env();
  e.states.set(p, {
    ...data(),
    revision: 3,
    sequence_timebase: { frame_rate: { num: 24, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
  });
  const edit = vi.fn(),
    content = emptyAssembly(p, "ep_first");
  render(
    <AssemblyProjectTimebase
      projectId={p}
      episodeId="ep_first"
      content={content}
      locked={false}
      gateway={e.api}
      edit={edit}
    />,
  );
  expect(e.api.getProjectSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "读取并选用项目默认时基" }));
  await screen.findByText(/已选用项目修订 3/);
  expect(edit).toHaveBeenCalledExactlyOnceWith({
    ...content,
    sequence_timebase: e.states.get(p)?.sequence_timebase,
  });
  expect(e.api.updateProjectSettings).not.toHaveBeenCalled();
});
it.each(["audio", "subtitles", "visual"])(
  "refuses project default for existing %s entries",
  (kind) => {
    const content = emptyAssembly(p, "ep_first"),
      e = env();
    if (kind === "audio") content.audio_segments.push({} as never);
    if (kind === "subtitles") content.subtitle_segments.push({} as never);
    if (kind === "visual") content.visual_segments.push({} as never);
    render(
      <AssemblyProjectTimebase
        projectId={p}
        episodeId="ep_first"
        content={content}
        locked={false}
        gateway={e.api}
        edit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "读取并选用项目默认时基" })).toBeDisabled();
  },
);
it("late default replies cannot replace changed input or another episode", async () => {
  const e = env();
  let finish: (
    value: Awaited<ReturnType<ProjectSettingsGateway["getProjectSettings"]>>,
  ) => void = () => {};
  e.api.getProjectSettings = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<ProjectSettingsGateway["getProjectSettings"]>>>((resolve) => {
        finish = resolve;
      }),
  );
  const edit = vi.fn(),
    content = emptyAssembly(p, "ep_first");
  const view = render(
    <AssemblyProjectTimebase
      projectId={p}
      episodeId="ep_first"
      content={content}
      locked={false}
      gateway={e.api}
      edit={edit}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "读取并选用项目默认时基" }));
  view.rerender(
    <AssemblyProjectTimebase
      projectId={p}
      episodeId="ep_second"
      content={emptyAssembly(p, "ep_second")}
      locked={false}
      gateway={e.api}
      edit={edit}
    />,
  );
  await act(async () =>
    finish({
      kind: "FOUND" as const,
      receipt: response({
        ...data(),
        sequence_timebase: { frame_rate: { num: 24, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
      }),
    }),
  );
  expect(edit).not.toHaveBeenCalled();
});
it("does not adopt a late project default after the same episode content has changed", async () => {
  const e = env();
  let finish: (
    value: Awaited<ReturnType<ProjectSettingsGateway["getProjectSettings"]>>,
  ) => void = () => {};
  e.api.getProjectSettings = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<ProjectSettingsGateway["getProjectSettings"]>>>((resolve) => {
        finish = resolve;
      }),
  );
  const edit = vi.fn(),
    content = emptyAssembly(p, "ep_first");
  const view = render(
    <AssemblyProjectTimebase
      projectId={p}
      episodeId="ep_first"
      content={content}
      locked={false}
      gateway={e.api}
      edit={edit}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "读取并选用项目默认时基" }));
  view.rerender(
    <AssemblyProjectTimebase
      projectId={p}
      episodeId="ep_first"
      content={{ ...content, canvas_width: 1080 }}
      locked={false}
      gateway={e.api}
      edit={edit}
    />,
  );
  await act(async () =>
    finish({
      kind: "FOUND",
      receipt: response({
        ...data(),
        sequence_timebase: { frame_rate: { num: 24, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
      }),
    }),
  );
  expect(edit).not.toHaveBeenCalled();
  expect(screen.getByText(/装配已变化/)).toBeInTheDocument();
});
it.each([401, 403, 404])(
  "does not trap a definite %s write rejection in UNKNOWN",
  async (status) => {
    const e = env(),
      code =
        status === 401
          ? "SIDECAR_AUTH_REQUIRED"
          : status === 403
            ? "SIDECAR_REQUEST_REJECTED"
            : "PROJECT_NOT_FOUND";
    e.api.updateProjectSettings = vi.fn(async () => ({ kind: "REJECTED" as const, status, code }));
    render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
    await ready();
    fireEvent.change(screen.getByLabelText("项目说明"), { target: { value: "待保存" } });
    fireEvent.click(screen.getByRole("button", { name: "保存项目设置" }));
    await screen.findByText(/保存被拒绝/);
    expect(window.localStorage.getItem(`aivora:project-settings:operation:v1:${p}`)).toBeNull();
    expect(screen.queryByRole("button", { name: "只读核对原操作回执" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("项目说明")).toHaveValue("待保存");
  },
);
it("rejects same-revision contradictory current readback after a verified operation and on refresh", async () => {
  const e = env(),
    original = e.api.updateProjectSettings;
  e.api.updateProjectSettings = vi.fn(async (id, c) => {
    const receipt = await original(id, c);
    e.states.set(id, { ...e.states.get(id)!, name: "矛盾当前值" });
    return receipt;
  });
  render(<ProjectSettingsEditor projectId={p} gateway={e.api} />);
  await ready();
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "原操作批准的名称" } });
  fireEvent.click(screen.getByRole("button", { name: "保存项目设置" }));
  await screen.findByText("原操作已由精确回执确认；当前设置读取失败，草稿保留，请重新读取。");
  expect(screen.getByLabelText("项目名称")).toHaveValue("原操作批准的名称");
  expect(screen.getByRole("button", { name: "保存项目设置" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新读取项目" }));
  await screen.findByText("项目设置无法核实；草稿保留，保存已暂停。");
  expect(screen.getByRole("button", { name: "保存项目设置" })).toBeDisabled();
});
