import { createHash, webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShotPlanGateway, ShotPlanProposal } from "@aijian/contracts/shot-plan";
import preparationFixture from "../../../../packages/contracts/fixtures/shot-plan/preparation.json";
import proposalFixture from "../../../../packages/contracts/fixtures/shot-plan/proposal.json";
import adoptedFixture from "../../../../packages/contracts/fixtures/shot-plan/adopted.json";
import { ShotPlanProposalReview } from "./ShotPlanProposalReview";
import {
  humanShotPlanContentHash,
  validHumanShotPlanPreparation,
  validHumanShotPlanProposal,
} from "./adapters/humanShotPlan";

const project = preparationFixture.data.project_id;
const episode = preparationFixture.data.episode_id;
const requestId = preparationFixture.request_id;
const receipt = <T,>(data: T) => ({ data, request_id: requestId });
function inputs() {
  const value: unknown = preparationFixture.data;
  if (!validHumanShotPlanPreparation(value, project, episode))
    throw new Error("Invalid backend fixture");
  return value;
}
function saved() {
  const value: unknown = proposalFixture.data;
  if (!validHumanShotPlanProposal(value, project, episode))
    throw new Error("Invalid backend fixture");
  return value;
}
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function gateway(existing: ShotPlanProposal | null = null) {
  let current = existing;
  const result: ShotPlanGateway = {
    prepareHumanShotPlan: vi.fn<ShotPlanGateway["prepareHumanShotPlan"]>(async () => ({
      kind: "PREPARED",
      receipt: receipt(inputs()),
    })),
    getShotPlanProposal: vi.fn<ShotPlanGateway["getShotPlanProposal"]>(async () =>
      current ? { kind: "FOUND", receipt: receipt(current) } : { kind: "EMPTY" },
    ),
    getShotPlanProposalVersion: vi.fn<ShotPlanGateway["getShotPlanProposalVersion"]>(async () =>
      current ? { kind: "FOUND", receipt: receipt(current) } : { kind: "REMOTE_UNKNOWN" },
    ),
    getHumanShotPlanWriteStatus: vi.fn<ShotPlanGateway["getHumanShotPlanWriteStatus"]>(
      async () => ({
        kind: "STATUS",
        receipt: receipt({ proposal: current }),
      }),
    ),
    getShotPlanAdoptionStatus: vi.fn<ShotPlanGateway["getShotPlanAdoptionStatus"]>(
      async (_p, _e, version) => ({
        kind: "STATUS",
        receipt: receipt({ proposal_version_id: version, adoption: current?.adoption ?? null }),
      }),
    ),
    createHumanShotPlanProposal: vi.fn<ShotPlanGateway["createHumanShotPlanProposal"]>(
      async (_p, _e, _operation, payload) => {
        current = {
          ...saved(),
          content: payload.content,
          content_hash: await humanShotPlanContentHash(payload.content),
          adoption: null,
        };
        return { kind: "CREATED", receipt: receipt({ proposal: current, replayed: false }) };
      },
    ),
    adoptHumanShotPlanProposal: vi.fn<ShotPlanGateway["adoptHumanShotPlanProposal"]>(async () => {
      if (!current) return { kind: "REMOTE_UNKNOWN" };
      const adoption = adoptedFixture.data.proposal.adoption;
      if (!adoption) throw new Error("Invalid adoption fixture");
      current = {
        ...current,
        adoption: {
          ...adoption,
          proposal_version_id: current.version_id,
          proposal_content_hash: current.content_hash,
        },
      };
      return { kind: "ADOPTED", receipt: receipt({ proposal: current, replayed: false }) };
    }),
  };
  return result;
}
const base = () => ({
  projectId: project,
  episodeId: episode,
  scriptDirty: false,
  storyboardDirty: false,
  pendingOperations: false,
  onAdopted: vi.fn(),
  storage: storage(),
  initiallyOpen: true,
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const count of [7, 11])
  describe(`${count}-shot manual review`, () => {
    it("builds an editable HUMAN template, saves once, and explicitly adopts a new storyboard", async () => {
      vi.stubGlobal("crypto", webcrypto);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const bridge = gateway();
      const props = base();
      render(<ShotPlanProposalReview {...props} gateway={bridge} />);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "建立人工待编排模板" })).toBeEnabled(),
      );
      fireEvent.change(screen.getByLabelText("模板镜头数"), { target: { value: String(count) } });
      fireEvent.click(screen.getByRole("button", { name: "建立人工待编排模板" }));
      expect(screen.getByText(`${count} 个 · 24/1 fps`)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("叙事目的"), { target: { value: "用回望表现离别" } });
      fireEvent.click(screen.getByRole("button", { name: "保存人工提案新版本" }));
      await waitFor(() =>
        expect(screen.getByText("人工提案已保存，请审阅后明确采纳。")).toBeInTheDocument(),
      );
      expect(bridge.createHumanShotPlanProposal).toHaveBeenCalledTimes(1);
      const calls = vi.mocked(bridge.createHumanShotPlanProposal).mock.calls;
      expect(calls[0]?.[3].content.provenance).toBe("HUMAN");
      expect(calls[0]?.[3].content.shots).toHaveLength(count);
      fireEvent.click(screen.getByRole("button", { name: "审阅并采纳到新分镜" }));
      await waitFor(() => expect(props.onAdopted).toHaveBeenCalledTimes(1));
      expect(bridge.adoptHumanShotPlanProposal).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/旧版本完整保留/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "审阅并采纳到新分镜" })).toBeDisabled();
    });
  });

it("guards local edits and refuses adoption after a dirty proposal edit", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const bridge = gateway(saved());
  const props = base();
  const view = render(<ShotPlanProposalReview {...props} gateway={bridge} scriptDirty />);
  await waitFor(() => expect(screen.getByLabelText("叙事目的")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "审阅并采纳到新分镜" })).toBeDisabled();
  view.rerender(<ShotPlanProposalReview {...props} gateway={bridge} />);
  fireEvent.change(screen.getByLabelText("叙事目的"), { target: { value: "新的人工意图" } });
  expect(screen.getByRole("button", { name: "审阅并采纳到新分镜" })).toBeDisabled();
  expect(bridge.adoptHumanShotPlanProposal).not.toHaveBeenCalled();
});

it("canceling explicit adoption makes no request", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const bridge = gateway(saved());
  render(<ShotPlanProposalReview {...base()} gateway={bridge} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "审阅并采纳到新分镜" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "审阅并采纳到新分镜" }));
  expect(bridge.adoptHumanShotPlanProposal).not.toHaveBeenCalled();
});

it("unknown save survives remount and checks only original read-only status", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const bridge = gateway();
  const props = base();
  vi.mocked(bridge.createHumanShotPlanProposal).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
  const view = render(<ShotPlanProposalReview {...props} gateway={bridge} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "建立人工待编排模板" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "建立人工待编排模板" }));
  fireEvent.click(screen.getByRole("button", { name: "保存人工提案新版本" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "核对原提交（只读）" })).toBeEnabled(),
  );
  view.unmount();
  render(<ShotPlanProposalReview {...props} gateway={bridge} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "核对原提交（只读）" })).toBeEnabled(),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "核对原提交（只读）" }));
  });
  expect(bridge.createHumanShotPlanProposal).toHaveBeenCalledTimes(1);
  expect(bridge.adoptHumanShotPlanProposal).not.toHaveBeenCalled();
  await waitFor(() => expect(bridge.getHumanShotPlanWriteStatus).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "建立人工待编排模板" })).toBeDisabled();
});

it("shows a definite unavailable state when the native gateway is absent", async () => {
  render(<ShotPlanProposalReview {...base()} gateway={null} />);
  await waitFor(() =>
    expect(screen.getByText("当前桌面版本未连接导演提案接口。")).toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "建立人工待编排模板" })).toBeDisabled();
  expect(screen.queryByText("正在读取已确认的输入…")).not.toBeInTheDocument();
});

it("shows literal read-only production intent, original/adapted entry, and bounded visual constraints", async () => {
  const { ShotPlanInputContext } = await import("./ShotPlanInputContext");
  const preparation = inputs();
  const literal = '<img src="https://untrusted.invalid/x" onerror="alert(1)">';
  const changed = {
    ...preparation,
    production_brief_content: {
      ...preparation.production_brief_content,
      creative: { ...preparation.production_brief_content.creative, intent: literal },
    },
  };
  const draft = { ...saved().content, visual_constraints: [literal, "人物保留在安全区"] };
  const view = render(<ShotPlanInputContext preparation={changed} draft={draft} />);
  expect(screen.getByText(`当前制作意图：${literal}`)).toBeInTheDocument();
  expect(
    screen.getByText(
      `原创入口：${
        preparation.production_brief_content.creative_entry.kind === "original_idea"
          ? preparation.production_brief_content.creative_entry.origin_statement
          : ""
      }`,
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "视觉约束" })).toHaveTextContent("人物保留在安全区");
  expect(view.container.querySelector("img")).toBeNull();
  expect(screen.getByRole("region", { name: "导演提案制作输入" })).toHaveClass(
    "shot-plan-block-choices",
  );
  const adapted = {
    ...changed,
    production_brief_content: {
      ...changed.production_brief_content,
      creative_entry: {
        kind: "source_adaptation" as const,
        adaptation_statement: "已审阅章节的改编",
        source_document_id: `src_${"1".repeat(32)}`,
        source_manifest_version_id: `ver_${"2".repeat(32)}`,
        source_block_ids: [`srcb_${"3".repeat(32)}`],
      },
    },
  };
  view.rerender(<ShotPlanInputContext preparation={adapted} draft={null} />);
  expect(screen.getByText("改编入口：已审阅章节的改编")).toBeInTheDocument();
  expect(screen.getByText(/1 个声明来源块/)).toBeInTheDocument();
  expect(screen.getByText("未声明视觉约束。")).toBeInTheDocument();
});

it("keeps an adopted plan read-only against a newer base until explicitly starting a template", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const historical: unknown = structuredClone(adoptedFixture.data.proposal);
  if (!validHumanShotPlanProposal(historical, project, episode) || !historical.adoption)
    throw new Error("Invalid adopted backend fixture");
  const prior = JSON.stringify(historical);
  const currentBase = {
    version_id: historical.adoption.storyboard_version_id,
    content_hash: historical.adoption.storyboard_content_hash,
    head_revision: 1,
  };
  const bridge = gateway(historical);
  vi.mocked(bridge.prepareHumanShotPlan).mockResolvedValue({
    kind: "PREPARED",
    receipt: receipt({ ...inputs(), storyboard_base: currentBase }),
  });
  render(<ShotPlanProposalReview {...base()} gateway={bridge} workspace />);
  await waitFor(() => expect(screen.getByLabelText("叙事目的")).toBeDisabled());
  expect(screen.getByRole("region", { name: "人工导演工作区" })).toBeVisible();
  expect(screen.queryByText(/请核对镜头字段/)).toBeNull();
  expect(screen.getByText(/此已采用版本只读保留/)).toBeInTheDocument();
  expect(bridge.createHumanShotPlanProposal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "建立人工待编排模板" }));
  expect(screen.getByLabelText("叙事目的")).toBeEnabled();
  expect(screen.queryByText(/此已采用版本只读保留/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存人工提案新版本" }));
  await waitFor(() => expect(bridge.createHumanShotPlanProposal).toHaveBeenCalledTimes(1));
  expect(
    vi.mocked(bridge.createHumanShotPlanProposal).mock.calls[0]![3].content.storyboard_base,
  ).toEqual(currentBase);
  expect(JSON.stringify(historical)).toBe(prior);
});

it("never labels changed current script text as an adopted plan's historical source", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const historical: unknown = structuredClone(adoptedFixture.data.proposal);
  if (!validHumanShotPlanProposal(historical, project, episode)) throw new Error("fixture");
  const changed = structuredClone(inputs());
  const changedText = "NEW SCRIPT TEXT MUST NOT BECOME HISTORICAL EVIDENCE";
  changed.script_content.scenes[0]!.blocks[0]!.text = changedText;
  changed.script_stored_content = { ...structuredClone(changed.script_content) };
  changed.authority.script = {
    ...changed.authority.script,
    version_id: `ver_${"8".repeat(32)}`,
    confirmation_id: `esc_${"9".repeat(32)}`,
    head_revision: 2,
    content_hash: proofHash(changed.script_stored_content),
  };
  expect(validHumanShotPlanPreparation(changed, project, episode)).toBe(true);
  const bridge = gateway(historical);
  vi.mocked(bridge.prepareHumanShotPlan).mockResolvedValue({
    kind: "PREPARED",
    receipt: receipt(changed),
  });
  const props = base();
  const view = render(<ShotPlanProposalReview {...props} gateway={bridge} workspace />);
  await screen.findByRole("group", { name: "历史镜头稳定引用" });
  expect(screen.queryByText(changedText)).toBeNull();
  expect(screen.getByText(/未将新版原文冒充历史引用/)).toBeInTheDocument();
  expect(
    screen.getByText(`原剧本确认 ${historical.content.authority.script.confirmation_id}`),
  ).toBeInTheDocument();
  expect(screen.getByText("新模板当前输入与确认凭据")).toBeInTheDocument();
  expect(screen.getByLabelText("叙事目的")).toBeDisabled();
  view.unmount();
  vi.mocked(bridge.prepareHumanShotPlan).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
  render(<ShotPlanProposalReview {...props} gateway={bridge} workspace />);
  await screen.findByRole("group", { name: "历史镜头稳定引用" });
  expect(screen.getByLabelText("叙事目的")).toBeDisabled();
  expect(screen.getByRole("button", { name: "建立人工待编排模板" })).toBeDisabled();
});

function proofHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (item !== null && typeof item === "object") {
      const source = item as Record<string, unknown>;
      return `{${Object.keys(source)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(source[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(item);
  };
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}
