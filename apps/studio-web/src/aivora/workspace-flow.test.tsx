import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HomePages } from "./HomePages";
import { StoryPages } from "./StoryPages";
import { EditorDialog } from "./Common";
import { DemoProvider, useDemo } from "./model";

const projectId = `prj_${"a".repeat(32)}`;
const versionId = `ver_${"b".repeat(32)}`;
const hash = `sha256:${"c".repeat(64)}`;

function manifest(accepted = false) {
  return {
    data: {
      project_id: projectId,
      head: {
        latest_version_id: versionId,
        artifact_id: "artifact",
        review_version_id: null,
        accepted_version_id: accepted ? versionId : null,
        revision: 2,
      },
      latest_version: { id: versionId, artifact_id: "artifact", content_hash: hash },
      review_version: null,
      accepted_version: null,
    },
  };
}
function bridge(overrides: Record<string, unknown> = {}) {
  return {
    health: vi.fn().mockResolvedValue({
      request_id: "health",
      data: { status: "ok", service: "aijian-api", version: "1" },
    }),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: projectId,
          name: "远端项目",
          status: "active",
          revision: 2,
          updated_at: "2026-09-11T00:00:00Z",
        },
      ],
    }),
    createProject: vi.fn().mockResolvedValue({
      request_id: "create",
      data: {
        id: projectId,
        name: "新项目",
        status: "active",
        revision: 1,
        updated_at: "2026-09-11T00:00:00Z",
      },
    }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    getSource: vi.fn(),
    importTextSource: vi.fn().mockResolvedValue({
      request_id: "import",
      data: { filename: "story.txt", blocks: [{ text: "真实导入的来源" }] },
    }),
    getSourceManifest: vi.fn().mockResolvedValue(manifest()),
    getStoryBibleIndex: vi.fn().mockResolvedValue({
      request_id: "bible",
      data: { latest_version: null, review_version: null, accepted_version: null },
    }),
    getStoryBibleVersion: vi.fn(),
    submitSourceManifest: vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      phase: "submit",
      identity: {
        project_id: projectId,
        version_id: versionId,
        content_hash: hash,
        expected_revision: 2,
      },
      completed_actions: ["submit"],
      receipts: [],
    }),
    confirmSourceManifestBaseline: vi.fn(),
    copySourceManifestDraft: vi.fn(),
    ...overrides,
  } as unknown as Window["aijian"];
}
function Status() {
  const d = useDemo();
  return (
    <>
      <output aria-label="状态">
        {JSON.stringify({
          source: d.value("source"),
          approved: d.value("sourceApproved"),
          submitted: d.value("sourceReviewSubmitted"),
          project: d.value("backendProjectId"),
          characters: d.characters.length,
          outfits: d.outfits.length,
          locations: d.locations.length,
          shots: d.shots.length,
          annotations: d.annotations.length,
        })}
      </output>
      {d.toast && <p role="status">{d.toast}</p>}
    </>
  );
}
function renderHome() {
  window.history.replaceState({}, "", "#projects");
  return render(
    <DemoProvider>
      <HomePages />
      <EditorDialog />
      <Status />
    </DemoProvider>,
  );
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  delete window.aijian;
});

describe("selected renderer workspace callers", () => {
  it("does not initialize production pages with sample story, visual, or review facts", async () => {
    const fake = bridge({
      listProjects: vi.fn().mockResolvedValue({ request_id: "projects", data: [] }),
    })!;
    window.aijian = fake;
    renderHome();
    await screen.findByText("还没有项目");
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      source: "",
      project: "",
      characters: 0,
      outfits: 0,
      locations: 0,
      shots: 0,
      annotations: 0,
    });
  });
  it("starts with an authoritative empty project list and reports a failed desktop read", async () => {
    const empty = bridge({
      listProjects: vi.fn().mockResolvedValue({ request_id: "projects", data: [] }),
    })!;
    window.aijian = empty;
    renderHome();
    expect(await screen.findByText("还没有项目")).toBeInTheDocument();
    expect(empty.listProjects).toHaveBeenCalledTimes(1);

    const failed = bridge({
      listProjects: vi.fn().mockRejectedValue(new Error("desktop unavailable")),
    })!;
    window.aijian = failed;
    renderHome();
    expect(await screen.findByText("本地工作区暂时无法读取")).toBeInTheDocument();
  });

  it("connects the selected project page and creates a project through the typed desktop transport", async () => {
    const fake = bridge()!;
    window.aijian = fake;
    renderHome();
    expect(await screen.findByText("远端项目")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("作品名称"), {
      target: { value: "真实新项目" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存演示修改" }));
    await waitFor(() =>
      expect(fake.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: "真实新项目" }),
      ),
    );
  });

  it("imports a source, submits review without claiming acceptance, and does not retry an unknown import", async () => {
    const fake = bridge()!;
    window.aijian = fake;
    // Connect through the model so the selected source page has a real project identity.
    render(
      <DemoProvider>
        <ConnectThenSource />
      </DemoProvider>,
    );
    await waitFor(() => expect(fake.listProjects).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("替换原文文件"), {
      target: { files: [new File(["story"], "story.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(fake.importTextSource).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("状态").textContent).toContain("真实导入的来源");
    vi.mocked(fake.importTextSource).mockRejectedValueOnce(new Error("bridge lost"));
    fireEvent.change(screen.getByLabelText("替换原文文件"), {
      target: { files: [new File(["again"], "again.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText(/导入状态未知/)).toBeInTheDocument();
    expect(fake.importTextSource).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "开始理解故事" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "提交真实来源审核" }));
    await waitFor(() => expect(fake.submitSourceManifest).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("状态").textContent).toContain('"submitted":"true"');
    expect(screen.getByLabelText("状态").textContent).toContain('"approved":"false"');
  });

  it("keeps the selected source page unapproved when the review bridge reports an expired request", async () => {
    const fake = bridge({
      submitSourceManifest: vi.fn().mockResolvedValue({
        kind: "EXPIRED",
        phase: "submit",
        identity: {
          project_id: projectId,
          version_id: versionId,
          content_hash: hash,
          expected_revision: 2,
        },
        completed_actions: [],
        receipts: [],
      }),
    })!;
    window.aijian = fake;
    window.history.replaceState({}, "", "#source");
    render(
      <DemoProvider>
        <ConnectThenSource />
      </DemoProvider>,
    );
    await waitFor(() => expect(fake.listProjects).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("替换原文文件"), {
      target: { files: [new File(["story"], "story.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(fake.importTextSource).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "开始理解故事" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "提交真实来源审核" }),
    );
    expect(await screen.findByText("来源审核未完成。")).toBeInTheDocument();
    expect(screen.getByLabelText("状态").textContent).toContain('"submitted":"false"');
    expect(screen.getByLabelText("状态").textContent).toContain('"approved":"false"');
  });

  it("locks an unknown create result until a fresh list read reconciles it", async () => {
    const fake = bridge({ createProject: vi.fn().mockRejectedValue(new Error("bridge lost")) })!;
    window.aijian = fake;
    renderHome();
    await screen.findByText("远端项目");
    const submit = async () => {
      fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("作品名称"), {
        target: { value: "不会重复创建" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "保存演示修改" }));
      await waitFor(() => expect(fake.createProject).toHaveBeenCalled());
    };
    await submit();
    await submit();
    expect(fake.createProject).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "本地工作区已连接" }));
    await waitFor(() => expect(fake.listProjects).toHaveBeenCalledTimes(2));
    await submit();
    await waitFor(() => expect(fake.createProject).toHaveBeenCalledTimes(2));
  });

  it("clears project-scoped source and review state when switching to a project with no source", async () => {
    const otherProjectId = `prj_${"d".repeat(32)}`;
    const fake = bridge({
      listProjects: vi.fn().mockResolvedValue({
        request_id: "projects",
        data: [
          {
            id: projectId,
            name: "有来源",
            status: "active",
            revision: 2,
            updated_at: "2026-09-11T00:00:00Z",
          },
          {
            id: otherProjectId,
            name: "无来源",
            status: "active",
            revision: 2,
            updated_at: "2026-09-11T00:00:00Z",
          },
        ],
      }),
      listSources: vi.fn().mockImplementation((id: string) =>
        Promise.resolve({
          request_id: "sources",
          data: id === projectId ? [{ id: "src", filename: "a.txt" }] : [],
        }),
      ),
      getSource: vi.fn().mockResolvedValue({
        request_id: "source",
        data: { filename: "a.txt", blocks: [{ text: "A 的真实原文" }] },
      }),
    })!;
    window.aijian = fake;
    render(
      <DemoProvider>
        <ProjectSwitchControls />
      </DemoProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("状态").textContent).toContain("A 的真实原文"),
    );
    fireEvent.click(screen.getByRole("button", { name: "选A" }));
    await waitFor(() =>
      expect(screen.getByLabelText("状态").textContent).toContain("A 的真实原文"),
    );
    fireEvent.click(screen.getByRole("button", { name: "选B" }));
    await waitFor(() => expect(screen.getByLabelText("状态").textContent).toContain('"source":""'));
    expect(screen.getByLabelText("状态").textContent).toContain('"approved":"false"');
    expect(screen.getByLabelText("状态").textContent).toContain('"characters":0');
    expect(screen.getByLabelText("状态").textContent).toContain('"shots":0');
    expect(screen.getByLabelText("状态").textContent).toContain('"annotations":0');
  });
});

function ConnectThenSource() {
  const d = useDemo();
  return (
    <>
      <StoryPages />
      <EditorDialog />
      <Status />
      <button aria-label="连接来源" onClick={() => void d.connectRealWorkspace()}>
        连接
      </button>
    </>
  );
}
function ProjectSwitchControls() {
  const d = useDemo();
  return (
    <>
      <Status />
      <p>{d.projects.map((project) => project.name).join("|")}</p>
      <button onClick={() => void d.selectRealProject(1)}>选A</button>
      <button onClick={() => void d.selectRealProject(2)}>选B</button>
    </>
  );
}
