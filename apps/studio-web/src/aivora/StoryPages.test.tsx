import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StoryPages } from "./StoryPages";
import { EditorDialog } from "./Common";
import { DemoProvider, useDemo, createAivoraSampleFixture } from "./model";

afterEach(() => {
  cleanup();
  delete window.aijian;
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
function Harness() {
  const d = useDemo();
  return (
    <>
      <StoryPages />
      <EditorDialog />
      <button onClick={() => d.go("story")}>故事页</button>
      <button onClick={() => void d.readRealStoryWorkspace()}>读取真实故事工作区</button>
      <button onClick={() => void d.selectRealProject(2)}>打开第二项目</button>
      <button
        onClick={() =>
          void d.importRealSource(new File(["新的来源"], "new-source.txt", { type: "text/plain" }))
        }
      >
        导入真实来源
      </button>
      <button onClick={() => void d.reviewRealSource()}>提交真实来源审核</button>
      <output aria-label="状态">
        {JSON.stringify({
          source: d.value("source"),
          approved: d.value("sourceApproved"),
          submitted: d.value("sourceReviewSubmitted"),
          stage: d.sourceStage.kind,
          story: d.storyWorkspaceState,
        })}
      </output>
      {d.toast && <p role="status">{d.toast}</p>}
    </>
  );
}
function openSource() {
  window.history.replaceState({}, "", "#source");
  render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <Harness />
    </DemoProvider>,
  );
}

const projectId = `prj_${"1".repeat(32)}`;
const latestId = `ver_${"2".repeat(32)}`;
function manifest({
  accepted = latestId,
  review = null,
}: { accepted?: string | null; review?: string | null } = {}) {
  const version = (id: string, versionNumber: number) => ({
    artifact_id: `art_${"3".repeat(32)}`,
    id,
    parent_version_id: null,
    version_number: versionNumber,
    schema_version: "1.0.0",
    content_hash: `sha256:${"4".repeat(64)}`,
    change_summary: "来源版本",
    created_at: "2026-09-14T00:00:00Z",
    content: { scope_type: "full_work", documents: [] },
  });
  return {
    request_id: "manifest",
    data: {
      project_id: projectId,
      head: {
        artifact_id: `art_${"3".repeat(32)}`,
        latest_version_id: latestId,
        review_version_id: review,
        review_submission_id: review ? `sub_${"5".repeat(32)}` : null,
        accepted_version_id: accepted,
        revision: 1,
        review_evidence_revision: 0,
        updated_at: "2026-09-14T00:00:00Z",
      },
      latest_version: version(latestId, 4),
      review_version: review ? version(review, 4) : null,
      accepted_version: accepted ? version(accepted, accepted === latestId ? 4 : 3) : null,
    },
  };
}
function openRemoteSource(stage: ReturnType<typeof manifest> | null) {
  window.history.replaceState({}, "", "#source");
  window.aijian = {
    health: vi.fn().mockResolvedValue({
      request_id: "health",
      data: { status: "ok", service: "aijian-api", version: "test" },
    }),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: projectId,
          name: "来源项目",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    getSourceManifest: vi.fn().mockResolvedValue(stage),
  } as unknown as Window["aijian"];
  render(
    <DemoProvider>
      <Harness />
    </DemoProvider>,
  );
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function sourceResponse() {
  return {
    request_id: "source",
    data: {
      id: `src_${"7".repeat(32)}`,
      project_id: projectId,
      filename: "new-source.txt",
      media_type: "text/plain",
      sha256: `sha256:${"8".repeat(64)}`,
      bytes: 12,
      blocks: [{ id: `blk_${"9".repeat(32)}`, ordinal: 1, text: "新的来源" }],
      created_at: "2026-09-14T00:00:00Z",
      updated_at: "2026-09-14T00:00:00Z",
    },
  };
}
function remoteBridge(
  getSourceManifest: () => Promise<ReturnType<typeof manifest> | null>,
  projects = [
    {
      id: projectId,
      name: "来源项目",
      status: "active",
      revision: 1,
      updated_at: "2026-09-14T00:00:00Z",
    },
  ],
) {
  return {
    health: vi.fn().mockResolvedValue({
      request_id: "health",
      data: { status: "ok", service: "aijian-api", version: "test" },
    }),
    listProjects: vi.fn().mockResolvedValue({ request_id: "projects", data: projects }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    getSourceManifest: vi.fn(getSourceManifest),
  } as unknown as Window["aijian"];
}
function openWithBridge(bridge: Window["aijian"]) {
  window.history.replaceState({}, "", "#source");
  window.aijian = bridge;
  render(
    <DemoProvider>
      <Harness />
    </DemoProvider>,
  );
}
describe("selected story source workflow", () => {
  it("keeps source editing local until a real worktree import succeeds", () => {
    openSource();
    fireEvent.click(screen.getByRole("button", { name: "粘贴故事" }));
    fireEvent.change(screen.getByRole("textbox", { name: "原文正文" }), {
      target: { value: "新的来源正文" },
    });
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      source: "新的来源正文",
      approved: "false",
    });
  });
  it("does not pretend an import succeeded without a connected project", async () => {
    openSource();
    fireEvent.change(screen.getByLabelText("替换原文文件"), {
      target: { files: [new File(["x"], "story.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText(/当前项目尚未连接本地工作区，无法导入来源/)).toBeInTheDocument();
  });
  it("does not offer source review when no real project source is selected", () => {
    openSource();
    expect(screen.getByRole("button", { name: "开始理解故事" })).toBeDisabled();
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      source: "",
      approved: "",
    });
  });
  it("does not permit story confirmation before an accepted source version exists", () => {
    openSource();
    fireEvent.click(screen.getByRole("button", { name: "故事页" }));
    for (const checkbox of screen.getAllByRole("checkbox"))
      if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "确认故事理解" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "确认并进入角色" }),
    ).toBeDisabled();
  });
  it("shows the current accepted manifest state without submitting a review", async () => {
    openRemoteSource(manifest());
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    expect(screen.getByText(/最新来源 V4 已批准/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审阅故事证据" })).toBeInTheDocument();
  });
  it("keeps an old accepted baseline visibly distinct from the newer draft", async () => {
    const oldAccepted = `ver_${"6".repeat(32)}`;
    openRemoteSource(manifest({ accepted: oldAccepted }));
    expect(await screen.findByText(/来源状态：新版待审核/)).toBeInTheDocument();
    expect(screen.getByText(/旧批准基线 V3 仍可用于故事阅读/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "审阅故事证据" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "审核来源版本" })).toBeInTheDocument();
  });

  it.each([
    ["empty manifest", async () => null, "未导入"],
    ["review manifest", async () => manifest({ accepted: null, review: latestId }), "审核中"],
    [
      "inconsistent manifest",
      async () => {
        const broken = manifest();
        broken.data.project_id = `prj_${"9".repeat(32)}`;
        return broken;
      },
      "身份不一致",
    ],
  ])("clears approval for a real %s", async (_name, getManifest, status) => {
    openWithBridge(remoteBridge(getManifest));
    expect(await screen.findByText(new RegExp(`来源状态：${status}`))).toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
    });
  });

  it("keeps approval false while a real manifest is loading", async () => {
    const request = pending<ReturnType<typeof manifest>>();
    openWithBridge(remoteBridge(() => request.promise));
    expect(await screen.findByText(/来源状态：读取中/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "loading",
    });
    request.resolve(manifest({ accepted: null, review: latestId }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
  });

  it("does not let an earlier same-project refresh overwrite a later refresh", async () => {
    const stale = pending<ReturnType<typeof manifest>>();
    let call = 0;
    openWithBridge(
      remoteBridge(async () => {
        call += 1;
        if (call === 1) return manifest();
        if (call === 2) return stale.promise;
        return manifest({ accepted: null, review: latestId });
      }),
    );
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    stale.resolve(manifest());
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "review",
    });
  });

  it("does not let a stale story read override a later refresh for the same project", async () => {
    const storyManifest = pending<ReturnType<typeof manifest>>();
    let call = 0;
    openWithBridge(
      remoteBridge(async () => {
        call += 1;
        if (call === 1) return manifest();
        if (call === 2) return storyManifest.promise;
        return manifest({ accepted: null, review: latestId });
      }),
    );
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "读取真实故事工作区" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    storyManifest.resolve(manifest());
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "review",
    });
  });
  it("keeps a failed real manifest unapproved", async () => {
    openWithBridge(
      remoteBridge(async () => {
        throw new Error("bridge");
      }),
    );
    expect(await screen.findByText(/来源状态：读取失败/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "error",
    });
  });

  it("uses the approved-stage action for navigation only", async () => {
    const submit = vi.fn();
    const bridge = remoteBridge(async () => manifest()) as Window["aijian"] & {
      sourceManifestReview?: { submit: typeof submit };
    };
    bridge.sourceManifestReview = { submit };
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审阅故事证据" }));
    expect(screen.getByRole("heading", { name: "故事理解" })).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
  it("keeps project B source state when project A's earlier manifest returns late", async () => {
    const projectB = `prj_${"8".repeat(32)}`;
    const oldProject = pending<ReturnType<typeof manifest>>();
    const bManifest = manifest({ accepted: null, review: latestId });
    bManifest.data.project_id = projectB;
    const bridge = remoteBridge(
      vi
        .fn()
        .mockImplementationOnce(() => oldProject.promise)
        .mockImplementationOnce(async () => bManifest),
      [
        {
          id: projectId,
          name: "项目 A",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
        {
          id: projectB,
          name: "项目 B",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    );
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：读取中/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开第二项目" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    oldProject.resolve(manifest());
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "review",
    });
  });

  it("does not let an old manifest begun before a successful import overwrite its newer state", async () => {
    const stale = pending<ReturnType<typeof manifest>>();
    let calls = 0;
    const bridge = remoteBridge(async () => {
      calls += 1;
      if (calls === 1) return manifest();
      if (calls === 2) return stale.promise;
      return manifest({ accepted: null, review: latestId });
    }) as Window["aijian"] & { importTextSource: ReturnType<typeof vi.fn> };
    bridge.importTextSource = vi.fn().mockResolvedValue(sourceResponse());
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    fireEvent.click(screen.getByRole("button", { name: "导入真实来源" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    stale.resolve(manifest());
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "review",
      source: "新的来源",
    });
  });

  it("does not let an old manifest begun before a successful review overwrite its newer state", async () => {
    const stale = pending<ReturnType<typeof manifest>>();
    let calls = 0;
    const bridge = remoteBridge(async () => {
      calls += 1;
      if (calls === 1) return manifest({ accepted: null });
      if (calls === 2) return stale.promise;
      if (calls === 3) return manifest({ accepted: null });
      return manifest({ accepted: null, review: latestId });
    })!;
    bridge.submitSourceManifest = vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      phase: "submit",
      identity: {},
      completed_actions: [],
      receipts: [],
    });
    bridge.confirmSourceManifestBaseline = vi.fn();
    bridge.copySourceManifestDraft = vi.fn();
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：待审核/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    fireEvent.click(screen.getByRole("button", { name: "提交真实来源审核" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    stale.resolve(manifest({ accepted: null }));
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      submitted: "true",
      stage: "review",
    });
  });
});
