import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import f from "../../../../packages/contracts/fixtures/script-confirmation-impact.json";
import { ScriptConfirmationImpactHistory } from "./ScriptConfirmationImpactHistory";
import type {
  ScriptImpactGateway,
  ScriptImpactPage,
  ScriptImpactReport,
} from "@aijian/contracts/script-confirmation-impact";

const page = f.page as ScriptImpactPage,
  report = f.report as ScriptImpactReport;
function gateway() {
  return {
    listScriptConfirmationImpacts: vi
      .fn<ScriptImpactGateway["listScriptConfirmationImpacts"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: page, request_id: f.request_id } }),
    getScriptConfirmationImpact: vi
      .fn<ScriptImpactGateway["getScriptConfirmationImpact"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: report, request_id: f.request_id } }),
  };
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("saved source report exposes exact original audio/subtitle frames without changing an editor", async () => {
  const api = gateway();
  render(
    <>
      <input aria-label="Unsaved assembly input" defaultValue="Keep unsaved input" />
      <ScriptConfirmationImpactHistory
        projectId={f.project_id}
        episodeId={f.episode_id}
        gateway={api}
      />
    </>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /SOURCE_REPLACED/ }));
  expect(await screen.findByText(/DIALOGUE_AUDIO · seg_dialogue/)).toBeVisible();
  expect(screen.getByText(/TEXT_SUBTITLE · seg_script_subtitle/)).toBeVisible();
  expect(screen.getByLabelText("Unsaved assembly input")).toHaveValue("Keep unsaved input");
  expect(api.getScriptConfirmationImpact).toHaveBeenCalledExactlyOnceWith(
    f.project_id,
    report.report_id,
  );
  expect(screen.getByText(/保存帧率/)).toBeVisible();
});
test("other episode is filtered and exact project bytes reject a foreign list", async () => {
  const api = gateway();
  const view = render(
    <ScriptConfirmationImpactHistory
      projectId={f.project_id}
      episodeId={`ep_${"f".repeat(32)}`}
      gateway={api}
    />,
  );
  expect(await screen.findByText("当前范围暂无确认替代报告。")).toBeVisible();
  expect(screen.queryByRole("button", { name: /SOURCE_REPLACED/ })).toBeNull();
  view.rerender(
    <ScriptConfirmationImpactHistory projectId={`prj_${"f".repeat(32)}`} gateway={api} />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("无法核实");
  expect(api.getScriptConfirmationImpact).not.toHaveBeenCalled();
});
test.each(["exact", "hash", "other-episode"])(
  "saved assembly marker uses target facts rather than source-episode filtering: %s",
  async (kind) => {
    const api = gateway(),
      t = report.assessment.targets[0]!;
    const target = {
      episode_id: kind === "other-episode" ? `ep_${"f".repeat(32)}` : t.episode_id!,
      version_id: t.version_id,
      content_hash: kind === "hash" ? `sha256:${"f".repeat(64)}` : t.content_hash,
    };
    render(
      <ScriptConfirmationImpactHistory
        projectId={f.project_id}
        episodeId={target.episode_id}
        assemblyTarget={target}
        gateway={api}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /SOURCE_REPLACED/ }));
    await screen.findByText(/DIALOGUE_AUDIO · seg_dialogue/);
    expect(screen.getByText(/读取作品全部来源分集/)).toBeVisible();
    if (kind === "exact") expect(screen.getByText("精确匹配本集所选保存装配及 hash")).toBeVisible();
    else {
      expect(screen.queryByText("精确匹配本集所选保存装配及 hash")).toBeNull();
      expect(screen.getByText(/本报告没有与所选保存版本和 hash 完全一致/)).toBeVisible();
    }
    expect(api.getScriptConfirmationImpact).toHaveBeenCalledOnce();
  },
);
test("A → B → A ignores the old A detail even when identity and hashes match", async () => {
  const api = gateway();
  let finish!: (r: Awaited<ReturnType<ScriptImpactGateway["getScriptConfirmationImpact"]>>) => void;
  api.getScriptConfirmationImpact.mockReturnValueOnce(
    new Promise((yes) => {
      finish = yes;
    }),
  );
  const view = render(<ScriptConfirmationImpactHistory projectId={f.project_id} gateway={api} />);
  fireEvent.click(await screen.findByRole("button", { name: /SOURCE_REPLACED/ }));
  view.rerender(
    <ScriptConfirmationImpactHistory projectId={`prj_${"f".repeat(32)}`} gateway={api} />,
  );
  await screen.findByRole("alert");
  view.rerender(<ScriptConfirmationImpactHistory projectId={f.project_id} gateway={api} />);
  await screen.findByRole("button", { name: /SOURCE_REPLACED/ });
  await act(async () =>
    finish({ kind: "FOUND", receipt: { data: report, request_id: f.request_id } }),
  );
  expect(screen.queryByText(/原版本 ver_/)).toBeNull();
  expect(screen.getByRole("button", { name: /SOURCE_REPLACED/ })).toBeVisible();
});
test.each(["hash", "summary-count", "original-receipt"])(
  "bad detail preserves original selection and offers only read recovery: %s",
  async (field) => {
    const api = gateway();
    const bad = structuredClone(report);
    if (field === "hash") bad.assessment_hash = `sha256:${"0".repeat(64)}`;
    if (field === "summary-count") bad.assessment.targets = [];
    if (field === "original-receipt")
      bad.assessment.new_confirmation.confirmation_id = `esc_${"f".repeat(32)}`;
    api.getScriptConfirmationImpact.mockResolvedValue({
      kind: "FOUND",
      receipt: { data: bad, request_id: f.request_id },
    });
    render(<ScriptConfirmationImpactHistory projectId={f.project_id} gateway={api} />);
    fireEvent.click(await screen.findByRole("button", { name: /SOURCE_REPLACED/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("原报告选择保留"));
    expect(screen.queryByText(/原版本 ver_/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新只读核对" }));
    await waitFor(() => expect(api.getScriptConfirmationImpact).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "返回剧本确认影响列表" })).toBeVisible();
  },
);
