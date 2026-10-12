import { webcrypto, createHash } from "node:crypto";
import {
  act,
  renderHook,
  waitFor,
  render,
  screen,
  within,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fixture from "../../../desktop/src/visual-bible.testFixtures.json";
import {
  visualJson,
  visualWriteInput,
  type VisualIndex,
  type VisualRead,
  type VisualTicket,
  type VisualResult,
  type VisualOperation,
  type VisualAction,
} from "@aijian/contracts/visual-bible";
import type { AijianDesktopBridge } from "../api/studio";
import { useVisualWorkspace } from "./useVisualWorkspace";
import {
  readVisualJournal,
  writeVisualJournal,
  clearVisualJournal,
  visualTicketMatches,
} from "./visualWorkspace";
import { VisualBibleEditor } from "./VisualBibleEditor";
const p = fixture.project_id,
  v = fixture.saved.version.id;
const sha = (value: unknown) =>
  `sha256:${createHash("sha256").update(visualJson(value)).digest("hex")}`;
const found = <T,>(data: T): VisualResult<T> => ({
  kind: "FOUND",
  data,
  request_id: fixture.request_id,
});
function bridge() {
  const index = {
    ...fixture.index,
    head: fixture.saved.head,
    review_version: null,
    accepted_version: null,
  };
  const g = {
    getVisualBible: vi.fn().mockResolvedValue(found(index)),
    getVisualBibleVersion: vi.fn().mockResolvedValue(found(fixture.saved)),
    getVisualBibleReadiness: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getVisualBibleAuthority: vi.fn().mockResolvedValue(
      found({
        project_id: p,
        version_id: v,
        content_hash: fixture.saved.version.content_hash,
        status: "UNAPPROVED",
        gate_decision_id: null,
        blocking: ["approved_g5_decision_required"],
      }),
    ),
    getVisualReviewState: vi.fn().mockResolvedValue(
      found({
        project_id: p,
        version_id: v,
        content_hash: fixture.saved.version.content_hash,
        head: fixture.saved.head,
        signoffs: [],
        reports: [],
      }),
    ),
    saveVisualBible: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getVisualSaveOperation: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    readVisualReviewOperation: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getVisualInspectionOperation: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    prepareVisualReview: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    confirmVisualReview: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    inspectVisualReference: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getProjectCreativeLibrary: vi.fn().mockResolvedValue({
      kind: "FOUND",
      receipt: { data: fixture.library, request_id: fixture.request_id },
    }),
    getProjectCreativeLibraryVersion: vi.fn().mockResolvedValue({
      kind: "FOUND",
      receipt: { data: fixture.library, request_id: fixture.request_id },
    }),
    listProjectMediaAssets: vi.fn().mockResolvedValue({
      kind: "LISTED",
      receipt: { data: [fixture.asset], request_id: fixture.request_id },
    }),
  };
  window.aijian = g as unknown as AijianDesktopBridge;
  return g;
}
const setter = vi.fn();
beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  delete window.aijian;
  vi.restoreAllMocks();
});
async function ready(result: { current: ReturnType<typeof useVisualWorkspace> }) {
  await waitFor(() => expect(result.current.ready).toBe(true));
}
describe("native G5 workspace persistence and boundaries", () => {
  it("retains invalid unapplied safety-area input and blocks saving/leaving", async () => {
    const g = bridge();
    const { result } = renderHook(() => useVisualWorkspace(p, setter));
    await ready(result);
    act(() => result.current.setArea((a) => ({ ...a, width: "-" })));
    expect(result.current.area.width).toBe("-");
    expect(result.current.candidate).toBe(null);
    await act(() => result.current.save());
    expect(g.saveVisualBible).not.toHaveBeenCalled();
    const guard = [...setter.mock.calls]
      .reverse()
      .find((call) => typeof call[0] === "function")?.[0] as () => boolean;
    expect(guard()).toBe(false);
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });
  it("restores an unknown save with complete original input and only uses GET to recover", async () => {
    const g = bridge();
    const first = renderHook(() => useVisualWorkspace(p, setter));
    await ready(first.result);
    act(() =>
      first.result.current.setContent((c) => (c ? { ...c, change_reason: "新的共享原因" } : c)),
    );
    await act(() => first.result.current.save());
    expect(g.saveVisualBible).toHaveBeenCalledTimes(1);
    const pending = readVisualJournal(p);
    expect(pending.kind).toBe("PENDING");
    if (pending.kind !== "PENDING" || pending.value.kind !== "save")
      throw new Error("Missing original save");
    const original = pending.value;
    first.unmount();
    const second = renderHook(() => useVisualWorkspace(p, setter));
    await ready(second.result);
    expect(second.result.current.content?.change_reason).toBe("新的共享原因");
    expect(g.saveVisualBible).toHaveBeenCalledTimes(1);
    const data: VisualRead = {
      ...(fixture.saved as VisualRead),
      head: { ...fixture.saved.head, latest_version_id: "ver_" + "a".repeat(32), revision: 2 },
      version: {
        ...(fixture.saved.version as VisualRead["version"]),
        id: "ver_" + "a".repeat(32),
        parent_version_id: v,
        version_number: 2,
        content: original.payload.content,
        content_hash: sha(original.payload.content),
        change_summary: original.payload.change_summary,
      },
    };
    g.getVisualSaveOperation.mockResolvedValue(
      found({
        idempotency_key_hash: sha({ value: original.key }),
        request_hash: sha({ project_id: p, actor_id: "local-user", payload: original.payload }),
        result: data,
      }),
    );
    await act(() => second.result.current.recover());
    expect(readVisualJournal(p).kind).toBe("EMPTY");
    expect(g.getVisualSaveOperation).toHaveBeenCalledWith(p, original.key, original.payload);
    expect(g.saveVisualBible).toHaveBeenCalledTimes(1);
  });
  it("persists a safe review ticket before confirmation, then recovers UNKNOWN without resending", async () => {
    const g = bridge();
    const { result } = renderHook(() => useVisualWorkspace(p, setter));
    await ready(result);
    const input = {
      action: "submit" as const,
      roles: [],
      decision: null,
      rationale: null,
      readiness_report_id: null,
    };
    const ticket: VisualTicket = {
      project_id: p,
      version_id: v,
      content_hash: fixture.saved.version.content_hash,
      expected_revision: 1,
      challenge_id: fixture.prepared_submit.challenge.id,
      report_id: fixture.prepared_submit.report.id,
      report_hash: fixture.prepared_submit.report.report_hash,
      input,
    };
    g.prepareVisualReview.mockResolvedValue(found(ticket));
    g.confirmVisualReview.mockImplementation(async () => {
      expect(readVisualJournal(p)).toEqual({
        kind: "PENDING",
        value: { kind: "review", project_id: p, ticket },
      });
      expect(JSON.stringify(readVisualJournal(p))).not.toContain("confirmation_token");
      return { kind: "REMOTE_UNKNOWN" };
    });
    await act(() => result.current.act(input));
    expect(g.confirmVisualReview).toHaveBeenCalledTimes(1);
    expect(result.current.locked).toBe(true);
    g.readVisualReviewOperation.mockResolvedValue(found(fixture.submitted));
    await act(() => result.current.recover());
    expect(readVisualJournal(p).kind).toBe("EMPTY");
    expect(g.confirmVisualReview).toHaveBeenCalledTimes(1);
    expect(g.readVisualReviewOperation).toHaveBeenCalledTimes(1);
  });
  it.each(["project", "hash", "operation", "result-revision"])(
    "retains an unknown review on %s recovery mismatch",
    async (fault) => {
      const g = bridge();
      const { result } = renderHook(() => useVisualWorkspace(p, setter));
      await ready(result);
      const ticket: VisualTicket = {
        project_id: p,
        version_id: v,
        content_hash: fixture.saved.version.content_hash,
        expected_revision: 1,
        challenge_id: fixture.prepared_submit.challenge.id,
        report_id: fixture.prepared_submit.report.id,
        report_hash: fixture.prepared_submit.report.report_hash,
        input: {
          action: "submit",
          roles: [],
          decision: null,
          rationale: null,
          readiness_report_id: null,
        },
      };
      g.prepareVisualReview.mockResolvedValue(found(ticket));
      await act(() => result.current.act(ticket.input));
      const data = structuredClone(fixture.submitted);
      if (fault === "project") data.project_id = "prj_" + "0".repeat(32);
      if (fault === "hash") data.report.report_hash = "sha256:" + "0".repeat(64);
      if (fault === "operation") data.challenge.id = "chg_" + "0".repeat(32);
      if (fault === "result-revision") data.result_revision = 123;
      g.readVisualReviewOperation.mockResolvedValue(found(data));
      await act(() => result.current.recover());
      expect(readVisualJournal(p).kind).toBe("PENDING");
      expect(g.confirmVisualReview).toHaveBeenCalledTimes(1);
    },
  );
  it("does not let a late old A read overwrite the new A after A→B→A", async () => {
    const g = bridge(),
      other = "prj_" + "b".repeat(32);
    let finish!: (v: VisualResult<VisualIndex>) => void;
    const delayed = new Promise<VisualResult<VisualIndex>>((resolve) => {
      finish = resolve;
    });
    g.getVisualBible
      .mockImplementationOnce(() => delayed)
      .mockResolvedValueOnce({ kind: "EMPTY" })
      .mockResolvedValue(
        found({
          ...fixture.index,
          head: fixture.saved.head,
          review_version: null,
          accepted_version: null,
        }),
      );
    g.getProjectCreativeLibrary.mockImplementation(async (project: string) =>
      project === p
        ? { kind: "FOUND", receipt: { data: fixture.library, request_id: fixture.request_id } }
        : { kind: "EMPTY" },
    );
    g.listProjectMediaAssets.mockImplementation(async (project: string) => ({
      kind: "LISTED",
      receipt: { data: project === p ? [fixture.asset] : [], request_id: fixture.request_id },
    }));
    const view = render(<VisualBibleEditor key={p} projectId={p} setNavigationGuard={setter} />);
    view.rerender(<VisualBibleEditor key={other} projectId={other} setNavigationGuard={setter} />);
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "视觉当前操作状态" }).textContent).toContain(
        "已核对",
      ),
    );
    view.rerender(<VisualBibleEditor key={p} projectId={p} setNavigationGuard={setter} />);
    const reason = await screen.findByLabelText("共享改动原因");
    expect((reason as HTMLTextAreaElement).value).toBe(fixture.saved.version.content.change_reason);
    const old = structuredClone(fixture.index) as VisualIndex;
    old.latest_version.content.change_reason = "迟到旧A";
    await act(async () => {
      finish(found(old));
      await Promise.resolve();
    });
    expect((screen.getByLabelText("共享改动原因") as HTMLTextAreaElement).value).toBe(
      fixture.saved.version.content.change_reason,
    );
  });
});

it("a directory metadata mismatch cannot replace already entered visual text", async () => {
  const g = bridge();
  vi.mocked(window.confirm).mockReturnValue(true);
  const { result } = renderHook(() => useVisualWorkspace(p, setter));
  await ready(result);
  act(() =>
    result.current.setContent((c) => (c ? { ...c, change_reason: "保留当前未保存输入" } : c)),
  );
  const source = fixture.saved.version;
  const expected = {
    id: source.id,
    artifact_id: source.artifact_id,
    version_number: source.version_number,
    content_hash: "sha256:" + "0".repeat(64),
    parent_version_id: source.parent_version_id,
    creative_library_version_id: source.content.creative_library_version_id,
    creative_library_content_hash: source.content.creative_library_content_hash,
    author_actor_id: source.author_actor_id,
    change_summary: source.change_summary,
    change_reason: source.content.change_reason,
    created_at: source.created_at,
  };
  await act(() => result.current.selectVersion(v, expected));
  expect(g.getVisualBibleVersion).toHaveBeenCalledTimes(2);
  expect(result.current.content?.change_reason).toBe("保留当前未保存输入");
  expect(result.current.selected?.version.content_hash).toBe(source.content_hash);
  expect(result.current.notice).toContain("输入保留");
  expect(g.saveVisualBible).not.toHaveBeenCalled();
  expect(g.prepareVisualReview).not.toHaveBeenCalled();
});

it("two immediate history opens share the pending read rather than racing the editor", async () => {
  const g = bridge();
  const { result } = renderHook(() => useVisualWorkspace(p, setter));
  await ready(result);
  let resolve!: (r: ReturnType<typeof found<VisualRead>>) => void;
  g.getVisualBibleVersion.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    const first = result.current.selectVersion(v);
    const second = result.current.selectVersion(v);
    expect(g.getVisualBibleVersion).toHaveBeenCalledTimes(2);
    resolve(found(fixture.saved as VisualRead));
    await Promise.all([first, second]);
  });
  expect(result.current.busy).toBe(false);
  expect(result.current.selected?.version.id).toBe(v);
  expect(g.getVisualBibleVersion).toHaveBeenCalledTimes(2);
  expect(g.prepareVisualReview).not.toHaveBeenCalled();
});

function completedReview(action: "decision" | "signoff") {
  const data = structuredClone(fixture.submitted) as VisualOperation;
  const input: VisualAction = {
    action,
    roles: action === "signoff" ? ["continuity_reviewer", "producer"] : [],
    decision: action === "decision" ? "approved" : null,
    rationale: action === "decision" ? "明确批准原始理由" : null,
    readiness_report_id: data.report.id,
  };
  data.challenge.action = action;
  data.submission = null;
  data.report.submission_id = "sub_" + "a".repeat(32);
  if (action === "decision")
    data.decision = {
      id: "dec_" + "a".repeat(32),
      artifact_id: data.head.artifact_id,
      version_id: v,
      submission_id: data.report.submission_id,
      gate: "G5",
      decision: "approved",
      readiness_report_id: data.report.id,
      actor_id: data.actor_id,
      actor_role: "producer",
      self_review: true,
      rationale: input.rationale!,
      decided_at: data.challenge.consumed_at!,
    };
  else
    data.signoffs = input.roles.map((role, i) => ({
      id: "sig_" + String(i).repeat(32),
      artifact_id: data.head.artifact_id,
      version_id: v,
      submission_id: data.report.submission_id!,
      gate: "G5",
      role,
      actor_id: data.actor_id,
      review_evidence_revision: data.report.review_evidence_revision,
      readiness_report_id: data.report.id,
      self_review: true,
      supersedes_signoff_id: null,
      signed_at: data.challenge.consumed_at!,
    }));
  data.action_payload_hash = sha({
    ...(action === "decision"
      ? { decision: input.decision, rationale: input.rationale, actor_role: "producer" }
      : { roles: input.roles }),
    _actor_id: data.actor_id,
    _actor_roles: data.actor_roles,
    _policy_snapshot_hash: data.policy_snapshot_hash,
  });
  const ticket: VisualTicket = {
    project_id: p,
    version_id: v,
    content_hash: data.content_hash,
    expected_revision: data.challenge.head_revision,
    challenge_id: data.challenge.id,
    report_id: data.report.id,
    report_hash: data.report.report_hash,
    input,
  };
  return { data, ticket };
}

it.each([
  "opposite-decision",
  "different-rationale",
  "missing-signoff",
  "wrong-actor",
  "wrong-actor-roles",
])(
  "retains UNKNOWN for a completed receipt with %s, then only clears the exact outcome",
  async (fault) => {
    const g = bridge();
    const { data, ticket } = completedReview(fault === "missing-signoff" ? "signoff" : "decision");
    expect(await visualTicketMatches(ticket, data)).toBe(true);
    expect(writeVisualJournal(p, { kind: "review", project_id: p, ticket })).toBe(true);
    const wrong = structuredClone(data);
    if (fault === "opposite-decision") wrong.decision!.decision = "rejected";
    if (fault === "different-rationale") wrong.decision!.rationale = "不是原始理由";
    if (fault === "missing-signoff") wrong.signoffs.pop();
    if (fault === "wrong-actor") {
      wrong.actor_id = "different-user";
      wrong.decision!.actor_id = wrong.actor_id;
    }
    if (fault === "wrong-actor-roles") wrong.actor_roles = ["writer"];
    if (fault === "wrong-actor" || fault === "wrong-actor-roles")
      wrong.action_payload_hash = sha({
        decision: ticket.input.decision,
        rationale: ticket.input.rationale,
        actor_role: "producer",
        _actor_id: wrong.actor_id,
        _actor_roles: wrong.actor_roles,
        _policy_snapshot_hash: wrong.policy_snapshot_hash,
      });
    g.readVisualReviewOperation.mockResolvedValue(found(wrong));
    const { result } = renderHook(() => useVisualWorkspace(p, setter));
    await ready(result);
    await act(() => result.current.recover());
    expect(readVisualJournal(p).kind).toBe("PENDING");
    expect(result.current.terminal).toBe(false);
    g.readVisualReviewOperation.mockResolvedValue(found(data));
    await act(() => result.current.recover());
    expect(readVisualJournal(p).kind).toBe("EMPTY");
    expect(g.prepareVisualReview).not.toHaveBeenCalled();
    expect(g.confirmVisualReview).not.toHaveBeenCalled();
    expect(g.saveVisualBible).not.toHaveBeenCalled();
    expect(g.readVisualReviewOperation).toHaveBeenCalledTimes(2);
  },
);

it("never labels an unapproved newly saved candidate with the old version's approval", async () => {
  const g = bridge();
  g.getVisualBibleAuthority.mockResolvedValue(
    found({
      project_id: p,
      version_id: v,
      content_hash: fixture.saved.version.content_hash,
      status: "CURRENT",
      gate_decision_id: "dec_" + "a".repeat(32),
      blocking: [],
    }),
  );
  g.saveVisualBible.mockImplementation(async (_project, _key, payload) =>
    found({
      ...fixture.saved,
      head: { ...fixture.saved.head, revision: 2, latest_version_id: "ver_" + "b".repeat(32) },
      version: {
        ...fixture.saved.version,
        id: "ver_" + "b".repeat(32),
        version_number: 2,
        parent_version_id: v,
        content: payload.content,
        content_hash: sha(payload.content),
      },
    }),
  );
  render(<VisualBibleEditor projectId={p} setNavigationGuard={setter} />);
  await screen.findByText("G5当前批准");
  fireEvent.change(screen.getByLabelText("共享改动原因"), { target: { value: "另存新候选" } });
  fireEvent.click(screen.getByRole("button", { name: "另存视觉候选版本" }));
  await screen.findByText("已保存不可变视觉候选；尚未获得G5批准。");
  expect(screen.queryByText("G5当前批准")).toBeNull();
  expect(screen.getByText(/批准依据状态/).textContent).toContain("未核对");
  expect(screen.getByText(/批准依据状态/).textContent).not.toContain("dec_" + "a".repeat(32));
  expect(g.prepareVisualReview).not.toHaveBeenCalled();
  expect(g.confirmVisualReview).not.toHaveBeenCalled();
});

it.each(["removed", "replacement", "delete-noop"])(
  "keeps the original UNKNOWN locked after %s journal while a late refusal arrives",
  async (fault) => {
    const g = bridge();
    let finish!: (v: VisualResult<VisualRead>) => void;
    g.saveVisualBible.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useVisualWorkspace(p, setter));
    await ready(result);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.save();
    });
    await waitFor(() => expect(g.saveVisualBible).toHaveBeenCalledTimes(1));
    const original = readVisualJournal(p);
    if (original.kind !== "PENDING" || original.value.kind !== "save") throw Error("original");
    const replacement = { ...original.value, key: "vbsave_" + "f".repeat(32) };
    const storageKey = `aivora.visual-bible.pending.v1.${p}`;
    if (fault === "removed") localStorage.removeItem(storageKey);
    if (fault === "replacement") expect(writeVisualJournal(p, replacement)).toBe(true);
    if (fault === "delete-noop")
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
    await act(async () => {
      finish({
        kind: "DEFINITE_SERVER_ERROR",
        status: 409,
        code: "VISUAL_CONFLICT",
        request_id: fixture.request_id,
      });
      await pending;
    });
    expect(result.current.locked).toBe(true);
    expect(result.current.journal).toEqual(original);
    expect(readVisualJournal(p)).toEqual(
      fault === "replacement" ? { kind: "PENDING", value: replacement } : original,
    );
    await act(() => result.current.save());
    expect(g.saveVisualBible).toHaveBeenCalledTimes(1);
    vi.mocked(window.confirm).mockReturnValue(true);
    if (fault === "replacement") {
      const guard = setter.mock.calls
        .filter((c) => typeof c[0] === "function")
        .at(-1)?.[0] as () => boolean;
      expect(guard()).toBe(false);
    }
    await act(() => result.current.reload(true));
    expect(result.current.locked).toBe(true);
    await act(() => result.current.recover());
    expect(g.getVisualSaveOperation).toHaveBeenCalledWith(
      p,
      original.value.key,
      original.value.payload,
    );
    expect(g.saveVisualBible).toHaveBeenCalledTimes(1);
  },
);

it("unconditional journal deletion is refused; exact identity and deletion readback are required", () => {
  const payload: unknown = fixture.save_request;
  if (!visualWriteInput(payload, p)) throw Error("fixture");
  const original = {
    kind: "save" as const,
    project_id: p,
    key: "vbsave_" + "a".repeat(32),
    payload,
  };
  expect(writeVisualJournal(p, original)).toBe(true);
  expect(writeVisualJournal(p, null)).toBe(false);
  expect(clearVisualJournal(p, { ...original, key: "vbsave_" + "b".repeat(32) })).toBe(false);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
  expect(clearVisualJournal(p, original)).toBe(false);
  expect(readVisualJournal(p)).toEqual({ kind: "PENDING", value: original });
});

it("edits candidate reference and prop choices without changing source assets or signing G5", async () => {
  const g = bridge();
  render(<VisualBibleEditor projectId={p} setNavigationGuard={setter} />);
  await screen.findByLabelText("共享改动原因");
  const references = screen.getByRole("group", { name: "身份与服装参考范围" });
  const reference = within(references).getAllByRole("checkbox")[0]!;
  const initiallySelected = (reference as HTMLInputElement).checked;
  fireEvent.click(reference);
  expect(reference).toHaveProperty("checked", !initiallySelected);
  fireEvent.click(reference);
  expect(reference).toHaveProperty("checked", initiallySelected);

  const scene = screen.getByRole("group", { name: "场景参考" });
  fireEvent.click(within(scene).getByRole("button", { name: "移除此候选引用" }));
  const choice = within(scene).getByRole("combobox");
  const assetKey = `${fixture.asset.id}/${fixture.asset.versions[0]!.id}`;
  fireEvent.change(choice, { target: { value: assetKey } });
  fireEvent.change(choice, { target: { value: assetKey } });
  expect(within(scene).getAllByRole("button", { name: "移除此候选引用" })).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "添加道具版本" }));
  fireEvent.change(screen.getByLabelText("道具1名称"), { target: { value: "本地测试灯" } });
  fireEvent.change(screen.getByLabelText("道具说明"), { target: { value: "仅用于当前候选" } });
  const props = screen.getByRole("group", { name: "道具版本" });
  fireEvent.change(within(props).getByRole("combobox"), { target: { value: assetKey } });
  fireEvent.click(within(props).getByRole("button", { name: "移除此候选引用" }));
  fireEvent.click(screen.getByRole("button", { name: "移除此候选道具" }));
  expect(screen.getByLabelText("道具1名称")).toHaveValue("本地测试灯");
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "移除此候选道具" }));
  expect(screen.queryByLabelText("道具1名称")).toBeNull();
  fireEvent.change(screen.getByLabelText("width"), { target: { value: "-" } });
  expect(screen.getByRole("button", { name: "另存视觉候选版本" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("width"), { target: { value: "972" } });
  fireEvent.change(screen.getByLabelText("共享改动原因"), {
    target: { value: "候选参考已人工编辑" },
  });
  fireEvent.change(screen.getByLabelText("本次版本说明"), { target: { value: "测试候选编辑" } });
  fireEvent.click(screen.getByRole("button", { name: "另存视觉候选版本" }));
  await waitFor(() => expect(g.saveVisualBible).toHaveBeenCalledOnce());
  expect(g.saveVisualBible.mock.calls[0]![2]).toMatchObject({
    change_summary: "测试候选编辑",
    content: {
      props: [],
      change_reason: "候选参考已人工编辑",
      scenes: fixture.saved.version.content.scenes,
    },
  });
  expect(g.inspectVisualReference).not.toHaveBeenCalled();
  expect(g.prepareVisualReview).not.toHaveBeenCalled();
  expect(g.confirmVisualReview).not.toHaveBeenCalled();
});

it("requires discard consent for a new candidate and keeps the latest library pinned", async () => {
  const g = bridge();
  const { result } = renderHook(() => useVisualWorkspace(p, setter));
  await ready(result);
  act(() => result.current.setContent((c) => (c ? { ...c, change_reason: "未保存" } : c)));
  act(() => result.current.newCandidate());
  expect(result.current.content?.change_reason).toBe("未保存");
  vi.mocked(window.confirm).mockReturnValue(true);
  act(() => result.current.newCandidate());
  expect(result.current.selected).toBeNull();
  expect(result.current.content).toMatchObject({
    creative_library_version_id: fixture.library.version_id,
    creative_library_content_hash: fixture.library.content_hash,
    props: [],
    change_reason: "建立作品共享视觉候选",
  });
  expect(result.current.authority).toBeNull();
  expect(result.current.dirty).toBe(true);
  expect(g.saveVisualBible).not.toHaveBeenCalled();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

it.each(["success", "cancelled", "rejected", "throw", "unknown"])(
  "attributes an explicit image inspection %s without implying approval or retrying",
  async (outcome) => {
    const g = bridge();
    g.inspectVisualReference.mockImplementation(async (_p, _a, _v, _hash, operationId) => {
      if (outcome === "throw") throw new Error("transport unavailable");
      if (outcome === "cancelled") return { kind: "CANCELLED" };
      if (outcome === "rejected")
        return {
          kind: "DEFINITE_SERVER_ERROR",
          status: 409,
          code: "VISUAL_CONFLICT",
          request_id: fixture.request_id,
        };
      if (outcome === "unknown") return { kind: "REMOTE_UNKNOWN" };
      const data = structuredClone(fixture.inspection);
      data.evidence.operation_id = operationId;
      data.evidence_hash = sha(
        Object.fromEntries(Object.entries(data).filter(([key]) => key !== "evidence_hash")),
      );
      return found(data);
    });
    const { result } = renderHook(() => useVisualWorkspace(p, setter));
    await ready(result);
    await act(() =>
      result.current.inspect(
        fixture.asset.id,
        fixture.asset.versions[0]!.id,
        fixture.inspection.evidence.asset_sha256,
      ),
    );
    expect(g.inspectVisualReference).toHaveBeenCalledOnce();
    const unknown = outcome === "throw" || outcome === "unknown";
    expect(readVisualJournal(p).kind).toBe(unknown ? "PENDING" : "EMPTY");
    expect(result.current.locked).toBe(unknown);
    if (outcome === "success") expect(result.current.notice).toContain("不表示身份或权利批准");
    if (unknown) {
      g.getVisualInspectionOperation.mockRejectedValueOnce(new Error("read unavailable"));
      await act(() => result.current.recover());
      expect(readVisualJournal(p).kind).toBe("PENDING");
      expect(result.current.notice).toContain("不重发");
      expect(g.inspectVisualReference).toHaveBeenCalledOnce();
    }
    expect(g.prepareVisualReview).not.toHaveBeenCalled();
  },
);

it.each(["cancelled", "rejected", "throw"])(
  "retains exact review state after confirmation %s without a second write",
  async (outcome) => {
    const g = bridge();
    const { ticket } = completedReview("decision");
    g.prepareVisualReview.mockResolvedValue(found(ticket));
    if (outcome === "throw")
      g.confirmVisualReview.mockRejectedValue(new Error("transport unavailable"));
    else
      g.confirmVisualReview.mockResolvedValue(
        outcome === "cancelled"
          ? { kind: "CANCELLED" }
          : {
              kind: "DEFINITE_SERVER_ERROR",
              status: 409,
              code: "VISUAL_CONFLICT",
              request_id: fixture.request_id,
            },
      );
    const { result } = renderHook(() => useVisualWorkspace(p, setter));
    await ready(result);
    // The challenge must identify the exact currently selected head.
    ticket.expected_revision = result.current.selected!.head.revision;
    await act(() => result.current.act(ticket.input));
    expect(g.confirmVisualReview).toHaveBeenCalledOnce();
    expect(readVisualJournal(p).kind).toBe(outcome === "throw" ? "PENDING" : "EMPTY");
    expect(result.current.selected?.version.id).toBe(v);
    expect(g.saveVisualBible).not.toHaveBeenCalled();
  },
);
