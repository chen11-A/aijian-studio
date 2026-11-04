import { createHash, webcrypto } from "node:crypto";
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import capture from "../../../../packages/contracts/fixtures/local-media-review.json";
import {
  localReviewOperation,
  type LocalMediaReviewCommand,
  type LocalMediaReviewGateway,
  type LocalMediaReviewOperation,
  type LocalMediaReviewPage,
  type LocalMediaReviewStatus,
  type LocalMediaReviewTarget,
} from "@aijian/contracts/local-media-review";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import { LocalMediaReviewPanel } from "./LocalMediaReviewPanel";
import { useEpisodeAssembly, ASSEMBLY_SESSION_HEADS } from "./useEpisodeAssembly";
import { ASSEMBLY_SESSION_INTENTS } from "./adapters/assemblyExact";
import {
  LOCAL_REVIEW_SESSION_INTENTS,
  preserveLocalReviewJournal,
  readLocalReviewJournal,
  submitLocalReview,
} from "./adapters/localMediaReview";
import type { AssemblyVersion } from "./adapters/episodeMediaAssembly";

const p = capture.scope.project_id,
  e = capture.scope.episode_id;
const request_id = "11111111-1111-4111-8111-111111111111";
const hash = (v: unknown) =>
  `sha256:${createHash("sha256").update(impactCanonical(v)).digest("hex")}`;
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const saved = capture.scope.assembly as unknown as AssemblyVersion;
const audioTarget = capture.audio_target as unknown as LocalMediaReviewTarget;
const subtitleTarget = capture.literal_subtitle_target as unknown as LocalMediaReviewTarget;
const captured = capture.literal_subtitle_operation as unknown as LocalMediaReviewOperation;
const found = <T,>(data: T) => ({ kind: "FOUND" as const, receipt: { data, request_id } });
const pendingKey = `aivora.local-media-review.pending.v1.${p}.${e}`;
function command(): LocalMediaReviewCommand {
  return { operation_id: captured.operation_id, payload: copy(captured.payload) };
}
function setup() {
  let page: LocalMediaReviewPage = {
    project_id: p,
    episode_id: e,
    head_version_id: null,
    head_revision: null,
    items: [],
    next_cursor: null,
  };
  const operations = new Map<string, LocalMediaReviewOperation>();
  const api: LocalMediaReviewGateway = {
    getLocalMediaReviewTarget: vi.fn(async (_p, _e, q) =>
      found(copy(q.segment_kind === "AUDIO" ? audioTarget : subtitleTarget)),
    ),
    listLocalMediaReviews: vi.fn(async () => found(copy(page))),
    getLocalMediaReview: vi.fn(async (_p, _e, id) => {
      const item = page.items.find((v) => v.version_id === id);
      return item ? found(copy(item)) : { kind: "REMOTE_UNKNOWN" as const };
    }),
    getLocalMediaReviewStatus: vi.fn(async (_p, _e, q) =>
      found({
        review_version_id: q.version_id,
        review_content_hash: q.content_hash,
        applicability: "CURRENT" as const,
        current_assembly: {
          version_id: saved.version_id,
          content_hash: saved.content_hash,
          head_revision: saved.head_revision,
        },
        reasons: [],
        checked_at: "2026-10-11T00:00:00Z",
        formal_status: "BLOCKED" as const,
      }),
    ),
    saveLocalMediaReview: vi.fn(async (_p, _e, c) => {
      expect(readLocalReviewJournal(window.localStorage, p, e)).toEqual({
        kind: "PENDING",
        command: c,
      });
      const target = c.payload.input.segment_kind === "AUDIO" ? audioTarget : subtitleTarget;
      const content = {
        schema_version: "1.0.0" as const,
        input: copy(c.payload.input),
        target_snapshot: copy(target.snapshot),
        observation_method:
          c.payload.input.segment_kind === "AUDIO"
            ? ("ORIGINAL_AUDIO_LISTENING" as const)
            : ("LITERAL_SUBTITLE_TEXT_AND_RANGE" as const),
        manual_review_only: true as const,
        formal_status: "BLOCKED" as const,
      };
      const revision = (page.head_revision ?? 0) + 1;
      const version = {
        version_id: `ver_${String(revision).repeat(32)}`,
        version_number: revision,
        parent_version_id: page.head_version_id,
        author_actor_id: "local-user" as const,
        content,
        content_hash: hash(content),
        created_at: "2026-10-11T00:00:00Z",
      };
      const operation = {
        operation_id: c.operation_id,
        payload: copy(c.payload),
        version,
        result_revision: revision,
      };
      operations.set(c.operation_id, operation);
      page = {
        ...page,
        head_version_id: version.version_id,
        head_revision: revision,
        items: [version, ...page.items],
      };
      return found(operation);
    }),
    getLocalMediaReviewOperation: vi.fn(async (_p, _e, c) => {
      const operation = operations.get(c.operation_id);
      return operation ? found(copy(operation)) : { kind: "REMOTE_UNKNOWN" as const };
    }),
  };
  const props = {
    projectId: p,
    episodeId: e,
    savedVersion: saved,
    dirty: false,
    disabled: false,
    library: [],
    gateway: api,
    onState: vi.fn(),
    onPreservationGuard: vi.fn(),
  };
  return {
    api,
    props,
    operations,
    setPage: (v: LocalMediaReviewPage) => {
      page = v;
    },
  };
}
async function choose(kind = "LITERAL_SUBTITLE") {
  await waitFor(() => expect(screen.getByLabelText("选择已保存的自审片段")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("选择已保存的自审片段"), {
    target: { value: `${kind}:seg_${kind === "AUDIO" ? "audio" : "subtitle"}` },
  });
  await screen.findByLabelText("具体自审观察");
}
function fill() {
  fireEvent.change(screen.getByLabelText("具体自审观察"), {
    target: { value: "记录逐字核对的观察，第二行需要修改。" },
  });
  fireEvent.change(screen.getByLabelText("本次自审结果"), { target: { value: "NEEDS_CHANGES" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
async function readyWrite() {
  const button = screen.getByRole("button", { name: "显式保存本次自审记录" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
beforeEach(() => {
  window.localStorage.clear();
  LOCAL_REVIEW_SESSION_INTENTS.clear();
  ASSEMBLY_SESSION_INTENTS.clear();
  ASSEMBLY_SESSION_HEADS.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("explicit local human review in production renderer", () => {
  it.each(["history", "status"])(
    "ignores a late %s response after the saved assembly changes",
    async (kind) => {
      const { api, props } = setup();
      const view = render(<LocalMediaReviewPanel {...props} />);
      await choose();
      fill();
      await readyWrite();
      const read = await screen.findByRole("button", {
        name: `读取自审记录 ver_${"1".repeat(32)}`,
      });
      let finish!: () => void;
      const waiting = new Promise<void>((resolve) => {
        finish = resolve;
      });
      if (kind === "history") {
        const actual = vi.mocked(api.getLocalMediaReview).getMockImplementation()!;
        vi.mocked(api.getLocalMediaReview).mockImplementation(async (...args) => {
          await waiting;
          return actual(...args);
        });
        fireEvent.click(read);
      } else {
        const actual = vi.mocked(api.getLocalMediaReviewStatus).getMockImplementation()!;
        vi.mocked(api.getLocalMediaReviewStatus).mockImplementation(async (...args) => {
          await waiting;
          return actual(...args);
        });
        fireEvent.click(screen.getByRole("button", { name: "只读核对当前适用状态" }));
      }
      view.rerender(
        <LocalMediaReviewPanel
          {...props}
          savedVersion={{ ...saved, version_id: `ver_${"e".repeat(32)}`, head_revision: 2 }}
        />,
      );
      await act(async () => finish());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "读取本集自审历史" })).toBeEnabled(),
      );
      expect(screen.queryByText("当前绑定仍适用 · 仅此自审记录")).not.toBeInTheDocument();
      expect(screen.getByLabelText("精确历史自审记录")).toBeInTheDocument();
      expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps the observation after definite conflict and requires a fresh history before saving", async () => {
    const { api, props } = setup();
    vi.mocked(api.saveLocalMediaReview).mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "LOCAL_MEDIA_REVIEW_CONFLICT",
      request_id,
    });
    render(<LocalMediaReviewPanel {...props} />);
    await choose();
    fill();
    await readyWrite();
    await screen.findByText(/自审保存明确被拒绝：LOCAL_MEDIA_REVIEW_CONFLICT/);
    expect(screen.getByLabelText("具体自审观察")).toHaveValue(
      "记录逐字核对的观察，第二行需要修改。",
    );
    expect(screen.getByRole("button", { name: "显式保存本次自审记录" })).toBeDisabled();
    expect(readLocalReviewJournal(window.localStorage, p, e).kind).toBe("EMPTY");
    expect(api.getLocalMediaReviewOperation).not.toHaveBeenCalled();
    expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(1);
  });
  it("recovers a durable operation after process memory is gone using only its exact GET", async () => {
    const { api, props, operations } = setup();
    const original = command();
    expect(preserveLocalReviewJournal(window.localStorage, original)).toBe(true);
    operations.set(original.operation_id, captured);
    render(<LocalMediaReviewPanel {...props} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "只读核对原自审保存" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "只读核对原自审保存" }));
    await screen.findByLabelText("精确历史自审记录");
    expect(api.getLocalMediaReviewOperation).toHaveBeenCalledExactlyOnceWith(p, e, original);
    expect(api.saveLocalMediaReview).not.toHaveBeenCalled();
    expect(readLocalReviewJournal(window.localStorage, p, e).kind).toBe("EMPTY");
  });
  it("keeps observations and locks writes when refreshing history throws", async () => {
    const { api, props } = setup();
    render(<LocalMediaReviewPanel {...props} />);
    await choose();
    fill();
    vi.mocked(api.listLocalMediaReviews).mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "读取本集自审历史" }));
    await screen.findByText(/本集自审历史未可靠读回/);
    expect(screen.getByLabelText("具体自审观察")).toHaveValue(
      "记录逐字核对的观察，第二行需要修改。",
    );
    expect(screen.getByRole("button", { name: "显式保存本次自审记录" })).toBeDisabled();
    expect(api.saveLocalMediaReview).not.toHaveBeenCalled();
  });
  it("refuses an older history head after a verified saved review", async () => {
    const { api, props } = setup();
    render(<LocalMediaReviewPanel {...props} />);
    await choose();
    fill();
    await readyWrite();
    await screen.findByRole("button", { name: `读取自审记录 ver_${"1".repeat(32)}` });
    vi.mocked(api.listLocalMediaReviews).mockResolvedValue(
      found({
        project_id: p,
        episode_id: e,
        head_version_id: null,
        head_revision: null,
        items: [],
        next_cursor: null,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "读取本集自审历史" }));
    await screen.findByText(/自审历史头回执过旧/);
    expect(screen.getByLabelText("精确历史自审记录")).toBeInTheDocument();
    expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(1);
  });
  it("asks before changing a dirty review target and clears only after consent", async () => {
    const { api, props } = setup();
    render(<LocalMediaReviewPanel {...props} />);
    await choose();
    fill();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.change(screen.getByLabelText("选择已保存的自审片段"), {
      target: { value: "AUDIO:seg_audio" },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("具体自审观察")).toHaveValue(
      "记录逐字核对的观察，第二行需要修改。",
    );
    expect(api.getLocalMediaReviewTarget).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    fireEvent.change(screen.getByLabelText("选择已保存的自审片段"), { target: { value: "" } });
    expect(screen.queryByLabelText("具体自审观察")).not.toBeInTheDocument();
    expect(api.saveLocalMediaReview).not.toHaveBeenCalled();
  });
  it.each(["unknown", "throws"])(
    "does not create a review when the target read %s",
    async (mode) => {
      const { api, props } = setup();
      if (mode === "throws")
        vi.mocked(api.getLocalMediaReviewTarget).mockRejectedValue(new Error("offline"));
      else vi.mocked(api.getLocalMediaReviewTarget).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
      render(<LocalMediaReviewPanel {...props} />);
      await waitFor(() => expect(screen.getByLabelText("选择已保存的自审片段")).toBeEnabled());
      fireEvent.change(screen.getByLabelText("选择已保存的自审片段"), {
        target: { value: "LITERAL_SUBTITLE:seg_subtitle" },
      });
      await screen.findByText(/原件、来源、保存版本或对象哈希无法核实/);
      expect(screen.queryByLabelText("具体自审观察")).not.toBeInTheDocument();
      expect(api.saveLocalMediaReview).not.toHaveBeenCalled();
    },
  );
  it("keeps immutable history after status and detail reads fail", async () => {
    const { api, props } = setup();
    render(<LocalMediaReviewPanel {...props} />);
    await choose();
    fill();
    await readyWrite();
    const read = await screen.findByRole("button", { name: `读取自审记录 ver_${"1".repeat(32)}` });
    vi.mocked(api.getLocalMediaReviewStatus).mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "只读核对当前适用状态" }));
    await screen.findByText(/当前适用性回执无法核实/);
    vi.mocked(api.getLocalMediaReview).mockRejectedValue(new Error("offline"));
    fireEvent.click(read);
    await screen.findByText(/所选历史自审记录未可靠读回/);
    expect(screen.getByLabelText("精确历史自审记录")).toHaveTextContent(
      "记录逐字核对的观察，第二行需要修改。",
    );
    expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(1);
  });
  it("never recreates an operation from a corrupt pending journal", async () => {
    const { api, props } = setup();
    window.localStorage.setItem(pendingKey, "not-json");
    render(<LocalMediaReviewPanel {...props} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "只读核对原自审保存" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "只读核对原自审保存" }));
    await screen.findByText(/原保存日志缺少完整命令/);
    expect(api.saveLocalMediaReview).not.toHaveBeenCalled();
    expect(api.getLocalMediaReviewOperation).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(pendingKey)).toBe("not-json");
  });
  it("recovers initial read ownership after StrictMode effect remount and ignores the first delayed response", async () => {
    const { api, props } = setup();
    let resolve!: (value: ReturnType<typeof found<LocalMediaReviewPage>>) => void;
    vi.mocked(api.listLocalMediaReviews).mockImplementationOnce(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    render(
      <StrictMode>
        <LocalMediaReviewPanel {...props} />
      </StrictMode>,
    );
    await screen.findByText("尚无人工自审记录。");
    expect(api.listLocalMediaReviews).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolve(
        found({
          project_id: `prj_${"b".repeat(32)}`,
          episode_id: e,
          head_version_id: null,
          head_revision: null,
          items: [],
          next_cursor: null,
        }),
      );
    });
    expect(screen.queryByText(/历史未可靠读回/)).not.toBeInTheDocument();
    await choose();
    expect(screen.getByLabelText("具体自审观察")).toHaveValue("");
    expect(api.saveLocalMediaReview).not.toHaveBeenCalled();
    expect(api.getLocalMediaReviewOperation).not.toHaveBeenCalled();
  });
  it("starts blank, requires result and self declaration, then saves exact literal snapshot with prior journal", async () => {
    const { api, props } = setup();
    render(<LocalMediaReviewPanel {...props} />);
    await choose();
    expect(screen.getByLabelText("具体自审观察")).toHaveValue("");
    expect(screen.getByLabelText("本次自审结果")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "显式保存本次自审记录" })).toBeDisabled();
    fill();
    await readyWrite();
    await screen.findByLabelText("精确历史自审记录");
    expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(1);
    const c = vi.mocked(api.saveLocalMediaReview).mock.calls[0]![2];
    expect(c.payload.input).toMatchObject({
      assembly_version_id: saved.version_id,
      assembly_content_hash: saved.content_hash,
      segment_content_hash: subtitleTarget.snapshot.segment_content_hash,
      target_snapshot_hash: subtitleTarget.snapshot_hash,
      self_review: true,
      outcome: "NEEDS_CHANGES",
    });
    expect(c.payload.parent_version_id).toBeNull();
    expect(c.payload.expected_revision).toBeNull();
    expect(readLocalReviewJournal(window.localStorage, p, e).kind).toBe("EMPTY");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByLabelText("具体自审观察")).toHaveValue("");
    await waitFor(() => expect(api.listLocalMediaReviews).toHaveBeenCalledTimes(2));
    fill();
    await readyWrite();
    await waitFor(() => expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(2));
    const c2 = vi.mocked(api.saveLocalMediaReview).mock.calls[1]![2];
    expect(c2.payload.parent_version_id).toBe(`ver_${"1".repeat(32)}`);
    expect(c2.payload.expected_revision).toBe(1);
    await waitFor(() =>
      expect(readLocalReviewJournal(window.localStorage, p, e).kind).toBe("EMPTY"),
    );
    await screen.findByRole("button", { name: `读取自审记录 ver_${"2".repeat(32)}` });
  });
  it("audio review names whole original and never treats saved sequence range as played mix", async () => {
    const { api, props } = setup();
    render(<LocalMediaReviewPanel {...props} audioOnly />);
    await choose("AUDIO");
    expect(screen.getByText(/下方播放器播放完整原件，未应用此序列裁剪或混音/)).toBeVisible();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fill();
    await readyWrite();
    await screen.findByLabelText("精确历史自审记录");
    expect(vi.mocked(api.saveLocalMediaReview).mock.calls[0]![2].payload.input.segment_kind).toBe(
      "AUDIO",
    );
    expect(
      screen.getByText(new RegExp(audioTarget.snapshot.media_original!.filename)),
    ).toBeVisible();
  });
  it("lost successful POST stays UNKNOWN, reopen reads only original even when assembly is newer", async () => {
    const { api, props } = setup();
    const real = vi.mocked(api.saveLocalMediaReview).getMockImplementation()!;
    vi.mocked(api.saveLocalMediaReview).mockImplementation(async (...args) => {
      await real(...args);
      return { kind: "REMOTE_UNKNOWN" as const };
    });
    const mounted = render(<LocalMediaReviewPanel {...props} />);
    await choose();
    fill();
    await readyWrite();
    await screen.findByText(/自审保存结果未知/);
    const original = vi.mocked(api.saveLocalMediaReview).mock.calls[0]![2];
    mounted.unmount();
    const next = { ...saved, version_id: `ver_${"a".repeat(32)}`, head_revision: 2 };
    render(<LocalMediaReviewPanel {...props} savedVersion={next} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "只读核对原自审保存" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "只读核对原自审保存" }));
    await screen.findByLabelText("精确历史自审记录");
    expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(1);
    expect(api.getLocalMediaReviewOperation).toHaveBeenCalledWith(p, e, original);
    expect(readLocalReviewJournal(window.localStorage, p, e).kind).toBe("EMPTY");
  });
  it("bad receipt stays UNKNOWN and rejected original GET never authorizes a second POST", async () => {
    const { api, props } = setup();
    vi.mocked(api.saveLocalMediaReview).mockResolvedValue(
      found({ ...captured, operation_id: "22222222-2222-4222-8222-222222222222" }),
    );
    render(<LocalMediaReviewPanel {...props} />);
    await choose();
    fill();
    await readyWrite();
    await screen.findByText(/自审保存结果未知/);
    fireEvent.click(screen.getByRole("button", { name: "只读核对原自审保存" }));
    await waitFor(() => expect(api.getLocalMediaReviewOperation).toHaveBeenCalledTimes(1));
    expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(1);
    expect(readLocalReviewJournal(window.localStorage, p, e).kind).toBe("PENDING");
    expect(screen.getByRole("button", { name: "显式保存本次自审记录" })).toBeDisabled();
  });
  it("retains unsaved observations on newer saved assembly and requires explicit discard", async () => {
    const { api, props } = setup();
    const view = render(<LocalMediaReviewPanel {...props} />);
    await choose();
    fill();
    view.rerender(
      <LocalMediaReviewPanel
        {...props}
        savedVersion={{ ...saved, version_id: `ver_${"a".repeat(32)}`, head_revision: 2 }}
      />,
    );
    expect(screen.getByLabelText("具体自审观察")).toHaveValue(
      "记录逐字核对的观察，第二行需要修改。",
    );
    expect(screen.getByRole("button", { name: "显式保存本次自审记录" })).toBeDisabled();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "明确放弃本次自审输入" }));
    expect(screen.getByLabelText("具体自审观察")).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "明确放弃本次自审输入" }));
    expect(screen.queryByLabelText("具体自审观察")).not.toBeInTheDocument();
    expect(api.saveLocalMediaReview).not.toHaveBeenCalled();
  });
  it("ignores target response from the old A after A to B to A", async () => {
    const { api, props } = setup();
    let resolve!: (v: ReturnType<typeof found<LocalMediaReviewTarget>>) => void;
    vi.mocked(api.getLocalMediaReviewTarget).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = render(<LocalMediaReviewPanel {...props} />);
    await waitFor(() => expect(screen.getByLabelText("选择已保存的自审片段")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("选择已保存的自审片段"), {
      target: { value: "LITERAL_SUBTITLE:seg_subtitle" },
    });
    const bp = `prj_${"b".repeat(32)}`,
      be = `ep_${"c".repeat(32)}`;
    const other = setup();
    vi.mocked(other.api.listLocalMediaReviews).mockResolvedValue(
      found({
        project_id: bp,
        episode_id: be,
        head_version_id: null,
        head_revision: null,
        items: [],
        next_cursor: null,
      }),
    );
    view.rerender(
      <LocalMediaReviewPanel {...props} projectId={bp} episodeId={be} gateway={other.api} />,
    );
    view.rerender(<LocalMediaReviewPanel {...props} />);
    await act(async () => {
      resolve(found(subtitleTarget));
    });
    expect(screen.queryByLabelText("具体自审观察")).not.toBeInTheDocument();
    await choose();
    expect(api.getLocalMediaReviewTarget).toHaveBeenLastCalledWith(p, e, {
      assembly_version_id: saved.version_id,
      assembly_content_hash: saved.content_hash,
      segment_kind: "LITERAL_SUBTITLE",
      segment_id: "seg_subtitle",
    });
    expect(other.api.saveLocalMediaReview).not.toHaveBeenCalled();
  });
  it("reads immutable old history while fresh status is STALE or dishonest CURRENT is refused", async () => {
    const { api, props, setPage } = setup();
    const record = captured.version;
    setPage({
      project_id: p,
      episode_id: e,
      head_version_id: record.version_id,
      head_revision: record.version_number,
      items: [record],
      next_cursor: null,
    });
    render(<LocalMediaReviewPanel {...props} />);
    const button = await screen.findByRole("button", { name: `读取自审记录 ${record.version_id}` });
    fireEvent.click(button);
    await screen.findByLabelText("精确历史自审记录");
    const stale: LocalMediaReviewStatus = {
      ...capture.literal_subtitle_status,
      applicability: "STALE",
      reasons: [{ code: "ORIGINAL_CHANGED", message: "原绑定已变化" }],
    } as LocalMediaReviewStatus;
    vi.mocked(api.getLocalMediaReviewStatus).mockResolvedValue(found(stale));
    fireEvent.click(screen.getByRole("button", { name: "只读核对当前适用状态" }));
    await screen.findByText("原自审绑定已失效 · 历史保留");
    expect(screen.getByText(record.content.input.observation)).toBeVisible();
    const bad = {
      ...stale,
      applicability: "CURRENT" as const,
      reasons: [],
      current_assembly: {
        version_id: `ver_${"a".repeat(32)}`,
        content_hash: saved.content_hash,
        head_revision: 2,
      },
    };
    vi.mocked(api.getLocalMediaReviewStatus).mockResolvedValue(found(bad));
    fireEvent.click(screen.getByRole("button", { name: "只读核对当前适用状态" }));
    await screen.findByText(/当前适用性回执无法核实/);
    expect(screen.getByText(record.content.input.observation)).toBeVisible();
    expect(api.saveLocalMediaReview).not.toHaveBeenCalled();
  });
  it("late save result after unmount keeps its original journal and memory for GET recovery", async () => {
    const { api, props } = setup();
    const actual = vi.mocked(api.saveLocalMediaReview).getMockImplementation()!;
    let release!: () => void;
    vi.mocked(api.saveLocalMediaReview).mockImplementation(async (...args) => {
      const result = await actual(...args);
      await new Promise<void>((r) => {
        release = r;
      });
      return result;
    });
    const view = render(<LocalMediaReviewPanel {...props} />);
    await choose();
    fill();
    await readyWrite();
    await waitFor(() => expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      release();
    });
    expect(readLocalReviewJournal(window.localStorage, p, e).kind).toBe("PENDING");
    expect(LOCAL_REVIEW_SESSION_INTENTS.has(`${p}/${e}`)).toBe(true);
    expect(api.getLocalMediaReviewOperation).not.toHaveBeenCalled();
  });
});

describe("local human review journal and parent navigation", () => {
  it("real captured operation is verified, wrong hash is not", async () => {
    expect(await localReviewOperation(captured, p, e, command())).toBe(true);
    expect(
      await localReviewOperation(
        { ...captured, version: { ...captured.version, content_hash: `sha256:${"0".repeat(64)}` } },
        p,
        e,
        command(),
      ),
    ).toBe(false);
  });
  it.each(["write throws", "readback missing", "existing corrupt"])(
    "blocks all POST when original journal %s",
    async (mode) => {
      const { api } = setup();
      const c = command();
      const port = {
        getItem: vi.fn(() => (mode === "existing corrupt" ? "{}" : null)),
        setItem: vi.fn(() => {
          if (mode === "write throws") throw new Error("storage");
        }),
        removeItem: vi.fn(),
      };
      expect((await submitLocalReview(api, port, c, () => true)).kind).toBe("UNKNOWN");
      expect(api.saveLocalMediaReview).not.toHaveBeenCalled();
      expect(api.getLocalMediaReviewOperation).not.toHaveBeenCalled();
    },
  );
  it("valid result whose journal cannot close stays held and is only recovered with original GET", async () => {
    const { api } = setup();
    const c = command();
    vi.mocked(api.saveLocalMediaReview).mockResolvedValue(found(captured));
    vi.mocked(api.getLocalMediaReviewOperation).mockResolvedValue(found(captured));
    const port = {
      getItem: window.localStorage.getItem.bind(window.localStorage),
      setItem: window.localStorage.setItem.bind(window.localStorage),
      removeItem: vi.fn(),
    };
    expect((await submitLocalReview(api, port, c, () => true)).kind).toBe("UNKNOWN");
    expect((await submitLocalReview(api, port, c, () => true)).kind).toBe("UNKNOWN");
    expect(api.saveLocalMediaReview).toHaveBeenCalledTimes(1);
    expect((await submitLocalReview(api, window.localStorage, c, () => true, true)).kind).toBe(
      "SAVED",
    );
    expect(api.getLocalMediaReviewOperation).toHaveBeenCalledWith(p, e, c);
  });
  it("two project and two episode journals do not inherit one another", () => {
    const c = command();
    expect(preserveLocalReviewJournal(window.localStorage, c)).toBe(true);
    const bp = `prj_${"b".repeat(32)}`,
      be = `ep_${"c".repeat(32)}`;
    expect(readLocalReviewJournal(window.localStorage, bp, e).kind).toBe("EMPTY");
    expect(readLocalReviewJournal(window.localStorage, p, be).kind).toBe("EMPTY");
    expect(readLocalReviewJournal(window.localStorage, bp, be).kind).toBe("EMPTY");
    expect(window.localStorage.getItem(pendingKey)).not.toBeNull();
  });
  it("parent distinguishes review input from assembly content, blocks busy/unsafe leave, preserves UNKNOWN", async () => {
    const setNavigationGuard = vi.fn();
    const preserve = vi.fn(() => true);
    const props = {
      projectId: p,
      episodeId: e,
      setNavigationGuard,
      assets: undefined,
      assembly: undefined,
      hasPendingInput: true,
      externalWritePending: false,
      externalWriteBusy: false,
      externalWritePreserved: preserve,
    };
    const view = renderHook((v) => useEpisodeAssembly(v), { initialProps: props });
    await waitFor(() => expect(view.result.current.busy).toBe(false));
    expect(view.result.current.contentDirty).toBe(false);
    expect(view.result.current.dirty).toBe(true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    let guard = setNavigationGuard.mock.calls.at(-1)![0] as () => boolean;
    act(() => expect(guard()).toBe(false));
    view.rerender({ ...props, hasPendingInput: false, externalWriteBusy: true });
    guard = setNavigationGuard.mock.calls.at(-1)![0] as () => boolean;
    act(() => expect(guard()).toBe(false));
    const unload = new Event("beforeunload", { cancelable: true });
    act(() => window.dispatchEvent(unload));
    expect(unload.defaultPrevented).toBe(true);
    view.rerender({ ...props, hasPendingInput: false, externalWritePending: true });
    preserve.mockReturnValue(false);
    guard = setNavigationGuard.mock.calls.at(-1)![0] as () => boolean;
    act(() => expect(guard()).toBe(false));
    preserve.mockReturnValue(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => expect(guard()).toBe(true));
    expect(preserve).toHaveBeenCalled();
  });
});
