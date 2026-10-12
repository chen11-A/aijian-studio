import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StudioTransport } from "../api/studio";
import type { AssetLibraryGateway, AssetVersion, MediaAsset } from "./adapters/assetLibrary";
import type { Editor } from "./model";
import { AssetsPage } from "./SceneAndAssets";

const projectId = `prj_${"1".repeat(32)}`;
const assetId = `asset_${"2".repeat(32)}`;
const versionId = `asv_${"3".repeat(32)}`;
const unknownKey = `aivora:project-media-assets:unknown:${projectId}`;
let transport: Partial<StudioTransport>;
let values: Record<string, string>;
function modelView() {
  return {
    page: "assets",
    isFixture: false,
    backendProjectId: projectId as string | null,
    selectedEpisodeId: "ep_local" as string | null,
    value: (key: string, fallback = "") => values[key] ?? fallback,
    put: vi.fn((key: string, value: string) => {
      values[key] = value;
    }),
    go: vi.fn(),
    setEditor: vi.fn<(editor: Editor) => void>(),
  };
}
let view = modelView();
vi.mock("./model", () => ({ useDemo: () => view }));
vi.mock("../api/studio", () => ({ createStudioTransport: () => transport }));

function asset(overrides: Partial<AssetVersion> = {}, referenced = false): MediaAsset {
  const version: AssetVersion = {
    id: versionId,
    ordinal: 1,
    filename: "synthetic.png",
    kind: "image",
    mime_type: "image/png",
    byte_size: 4,
    sha256: "4".repeat(64),
    rights_status: "PENDING_REVIEW",
    source_kind: "LOCAL_IMPORT",
    technical_metadata: {},
    created_at: "2026-10-10T00:00:00Z",
    availability: "VERIFIED",
    ...overrides,
  };
  return {
    id: assetId,
    project_id: projectId,
    created_at: version.created_at,
    latest_version: version,
    versions: [version],
    episode_references: referenced
      ? [
          {
            episode_id: "ep_local",
            version_id: versionId,
            role: "project-reference",
            created_at: version.created_at,
          },
        ]
      : [],
  };
}
function setup(current = asset()) {
  const receipt = { data: current, request_id: "local-test" };
  const api = {
    listProjectMediaAssets: vi
      .fn<AssetLibraryGateway["listProjectMediaAssets"]>()
      .mockResolvedValue({ kind: "LISTED", receipt: { data: [current], request_id: "list" } }),
    getProjectMediaAsset: vi
      .fn<AssetLibraryGateway["getProjectMediaAsset"]>()
      .mockResolvedValue({ kind: "FOUND", receipt }),
    importProjectMediaAssetFromPicker: vi
      .fn<AssetLibraryGateway["importProjectMediaAssetFromPicker"]>()
      .mockResolvedValue({ kind: "IMPORTED", receipt }),
    importProjectMediaAssetVersionFromPicker: vi
      .fn<AssetLibraryGateway["importProjectMediaAssetVersionFromPicker"]>()
      .mockResolvedValue({ kind: "IMPORTED", receipt }),
    readProjectMediaAssetPreview: vi
      .fn<AssetLibraryGateway["readProjectMediaAssetPreview"]>()
      .mockResolvedValue({
        kind: "READY",
        mime_type: current.latest_version.mime_type,
        sha256: current.latest_version.sha256,
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    addProjectMediaAssetEpisodeReference: vi
      .fn<AssetLibraryGateway["addProjectMediaAssetEpisodeReference"]>()
      .mockResolvedValue({
        kind: "REFERENCED",
        receipt: {
          ...receipt,
          data: {
            ...current,
            episode_references: [
              {
                episode_id: "ep_local",
                version_id: current.latest_version.id,
                role: "project-reference",
                created_at: current.created_at,
              },
            ],
          },
        },
      }),
    removeProjectMediaAssetEpisodeReference: vi
      .fn<AssetLibraryGateway["removeProjectMediaAssetEpisodeReference"]>()
      .mockResolvedValue({
        kind: "UNREFERENCED",
        receipt: { ...receipt, data: { ...current, episode_references: [] } },
      }),
    deleteProjectMediaAsset: vi
      .fn<AssetLibraryGateway["deleteProjectMediaAsset"]>()
      .mockResolvedValue({ kind: "DELETED" }),
  };
  transport = { assetLibrary: api };
  return api;
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
async function ready(filename = "synthetic.png") {
  await screen.findByRole("button", { name: `选择 ${filename}` });
}
async function submitEditor() {
  const editor = view.setEditor.mock.calls.at(-1)?.[0];
  if (!editor?.save) throw new Error("missing editor action");
  await act(async () => {
    await editor.save?.({});
  });
}
const dialogDescriptors = {
  showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"),
  close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close"),
};
beforeEach(() => {
  values = {};
  view = modelView();
  localStorage.clear();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:synthetic-preview");
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const name of ["showModal", "close"] as const) {
    const descriptor = dialogDescriptors[name];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

describe("real media library read and import", () => {
  test.each(["new", "version"] as const)(
    "%s import refreshes the authoritative list",
    async (mode) => {
      const api = setup();
      render(<AssetsPage />);
      await ready();
      click(mode === "new" ? "导入素材" : "导入新版本");
      expect(await screen.findByText("已取得导入回执；正在重新读取项目素材。")).toBeVisible();
      await waitFor(() => expect(api.listProjectMediaAssets).toHaveBeenCalledTimes(2));
      if (mode === "new")
        expect(api.importProjectMediaAssetFromPicker).toHaveBeenCalledWith(projectId);
      else
        expect(api.importProjectMediaAssetVersionFromPicker).toHaveBeenCalledWith(
          projectId,
          assetId,
        );
    },
  );

  test.each(["CANCELLED", "INVALID_FILE", "FILE_TOO_LARGE", "REJECTED", "UNKNOWN"] as const)(
    "import %s preserves truthful state",
    async (mode) => {
      const api = setup();
      api.importProjectMediaAssetFromPicker.mockResolvedValue(
        mode === "CANCELLED"
          ? { kind: "CANCELLED" }
          : mode === "INVALID_FILE" || mode === "FILE_TOO_LARGE"
            ? { kind: "LOCAL_FILE_REJECTED", code: mode }
            : mode === "REJECTED"
              ? {
                  kind: "DEFINITE_SERVER_ERROR",
                  status: 415,
                  code: "UNSUPPORTED",
                  request_id: "post",
                }
              : { kind: "REMOTE_UNKNOWN" },
      );
      render(<AssetsPage />);
      await ready();
      click("导入素材");
      await waitFor(() => expect(api.importProjectMediaAssetFromPicker).toHaveBeenCalledTimes(1));
      if (mode === "CANCELLED")
        await waitFor(() => expect(screen.getByRole("button", { name: "导入素材" })).toBeEnabled());
      else
        expect(
          await screen.findByText(
            mode === "INVALID_FILE"
              ? "所选文件不可导入。"
              : mode === "FILE_TOO_LARGE"
                ? "文件超过导入上限。"
                : mode === "REJECTED"
                  ? /导入被服务端拒绝：415/
                  : /导入结果未知/,
          ),
        ).toBeVisible();
      expect(api.listProjectMediaAssets).toHaveBeenCalledTimes(1);
      if (mode === "UNKNOWN") {
        expect(localStorage.getItem(unknownKey)).toBe("1");
        click("刷新素材");
        await waitFor(() => expect(api.listProjectMediaAssets).toHaveBeenCalledTimes(2));
        expect(screen.getByRole("button", { name: "导入素材" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "导入新版本" })).toBeDisabled();
      } else expect(localStorage.getItem(unknownKey)).toBeNull();
    },
  );

  test("wrong-asset version import locks further writes", async () => {
    const api = setup();
    api.importProjectMediaAssetVersionFromPicker.mockResolvedValue({
      kind: "IMPORTED",
      receipt: { request_id: "post", data: { ...asset(), id: `asset_${"9".repeat(32)}` } },
    });
    render(<AssetsPage />);
    await ready();
    click("导入新版本");
    expect(await screen.findByText(/导入回执身份不符/)).toBeVisible();
    expect(localStorage.getItem(unknownKey)).toBe("1");
  });

  test.each(["DEFINITE_SERVER_ERROR", "REMOTE_UNKNOWN", "INVALID_RESPONSE"] as const)(
    "list failure %s is not represented as empty",
    async (kind) => {
      const api = setup();
      api.listProjectMediaAssets.mockResolvedValue(
        kind === "DEFINITE_SERVER_ERROR"
          ? { kind, status: 403, code: "DENIED", request_id: "get" }
          : kind === "REMOTE_UNKNOWN"
            ? { kind }
            : {
                kind: "LISTED",
                receipt: { request_id: "get", data: [{ ...asset(), project_id: "wrong" }] },
              },
      );
      render(<AssetsPage />);
      expect(await screen.findByText("素材库尚未读回")).toBeVisible();
      expect(screen.queryByText("项目尚无素材")).toBeNull();
      expect(screen.queryByRole("button", { name: "预览synthetic.png" })).toBeNull();
    },
  );

  test("type and search filters never introduce fixture assets", async () => {
    setup();
    const mounted = render(<AssetsPage />);
    await ready();
    click("音频");
    mounted.rerender(<AssetsPage />);
    expect(screen.getByText("没有匹配的素材")).toBeVisible();
    click("全部");
    mounted.rerender(<AssetsPage />);
    await ready();
    values.assetQuery = "missing";
    mounted.rerender(<AssetsPage />);
    expect(screen.getByText("没有匹配的素材")).toBeVisible();
    expect(screen.queryByText("故事参考")).toBeNull();
  });
});

describe("asset preview identity and lifetime", () => {
  test.each(["MISSING", "CORRUPT"] as const)(
    "%s original is not read for preview",
    async (availability) => {
      const api = setup(asset({ availability }));
      render(<AssetsPage />);
      await ready();
      click("预览synthetic.png");
      expect(screen.getByText(/素材文件缺失或损坏/)).toBeVisible();
      expect(api.readProjectMediaAssetPreview).not.toHaveBeenCalled();
    },
  );

  test("oversized original is not loaded into the renderer", async () => {
    const api = setup(asset({ byte_size: 32 * 1024 * 1024 + 1 }));
    render(<AssetsPage />);
    await ready();
    click("预览synthetic.png");
    expect(screen.getByText(/超过 32 MiB 内嵌预览上限/)).toBeVisible();
    expect(api.readProjectMediaAssetPreview).not.toHaveBeenCalled();
  });

  test.each(["size", "hash", "mime"] as const)("preview %s drift is not shown", async (field) => {
    const api = setup();
    api.readProjectMediaAssetPreview.mockResolvedValue({
      kind: "READY",
      bytes: new Uint8Array(field === "size" ? [1] : [1, 2, 3, 4]),
      sha256: field === "hash" ? "a".repeat(64) : "4".repeat(64),
      mime_type: field === "mime" ? "image/jpeg" : "image/png",
    });
    render(<AssetsPage />);
    await ready();
    click("预览synthetic.png");
    expect(await screen.findByText(/预览身份、大小或哈希与版本不符/)).toBeVisible();
    expect(view.setEditor).not.toHaveBeenCalled();
  });

  test("valid image bytes produce a local preview with identity and rights caveats", async () => {
    const api = setup(asset({}, true));
    render(<AssetsPage />);
    await ready();
    click("预览synthetic.png");
    await waitFor(() => expect(view.setEditor).toHaveBeenCalledTimes(1));
    expect(api.readProjectMediaAssetPreview).toHaveBeenCalledWith(projectId, assetId, versionId);
    const editor = view.setEditor.mock.calls[0]?.[0];
    expect(editor?.image).toMatch(/^data:image\/png;base64,/);
    expect(editor?.description).toContain("权利状态：待审核");
    expect(editor?.description).toContain("不代表正式制作验收");
    expect(editor?.description).toContain(`ep_local / ${versionId}`);
  });

  test.each(["video", "audio"] as const)(
    "%s player events are display-only and close revokes URL",
    async (kind) => {
      setup(asset({ kind, mime_type: kind === "video" ? "video/mp4" : "audio/wav" }));
      const mounted = render(<AssetsPage />);
      await ready();
      click("预览synthetic.png");
      const dialog = await screen.findByRole("dialog", { name: "synthetic.png 原件预览" });
      const player = dialog.querySelector(kind);
      if (!player) throw new Error("player missing");
      fireEvent.playing(player);
      expect(screen.getByText(/本地播放器正在播放已校验的原始/)).toBeVisible();
      fireEvent.error(player);
      expect(screen.getByText(/本地播放器无法解码或播放该原件/)).toBeVisible();
      click("关闭预览");
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-preview");
      expect(screen.queryByRole("dialog")).toBeNull();
      mounted.unmount();
    },
  );

  test.each(["video", "audio"] as const)(
    "unsupported %s codec is never assigned a URL",
    async (kind) => {
      setup(asset({ kind, mime_type: "application/octet-stream" }));
      render(<AssetsPage />);
      await ready();
      click("预览synthetic.png");
      expect(await screen.findByText(/原件媒体类型不在当前播放器支持范围/)).toBeVisible();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    },
  );

  test("late preview after unmount is ignored", async () => {
    const api = setup();
    let finish:
      | ((value: Awaited<ReturnType<AssetLibraryGateway["readProjectMediaAssetPreview"]>>) => void)
      | undefined;
    api.readProjectMediaAssetPreview.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const mounted = render(<AssetsPage />);
    await ready();
    click("预览synthetic.png");
    mounted.unmount();
    await act(async () => {
      finish?.({
        kind: "READY",
        mime_type: "image/png",
        sha256: "4".repeat(64),
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
    });
    expect(view.setEditor).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe("explicit reference and soft-delete actions", () => {
  test.each([false, true])(
    "reference toggle binds exact project, episode and version (%s)",
    async (referenced) => {
      const api = setup(asset({}, referenced));
      render(<AssetsPage />);
      await ready();
      click("synthetic.png详情与引用");
      expect(view.setEditor.mock.calls.at(-1)?.[0].confirm).toBe(
        referenced ? "解除本集引用" : "引用最新版本到本集",
      );
      await submitEditor();
      if (referenced)
        expect(api.removeProjectMediaAssetEpisodeReference).toHaveBeenCalledWith(
          projectId,
          assetId,
          { episode_id: "ep_local", role: "project-reference" },
        );
      else
        expect(api.addProjectMediaAssetEpisodeReference).toHaveBeenCalledWith(projectId, assetId, {
          episode_id: "ep_local",
          version_id: versionId,
          role: "project-reference",
        });
      expect(api.listProjectMediaAssets).toHaveBeenCalledTimes(2);
    },
  );

  test.each(["UNKNOWN", "REJECTED", "MISMATCH"] as const)(
    "reference %s does not announce success",
    async (mode) => {
      const api = setup();
      api.addProjectMediaAssetEpisodeReference.mockResolvedValue(
        mode === "UNKNOWN"
          ? { kind: "REMOTE_UNKNOWN" }
          : mode === "REJECTED"
            ? { kind: "DEFINITE_SERVER_ERROR", status: 409, code: "CONFLICT", request_id: "post" }
            : {
                kind: "REFERENCED",
                receipt: {
                  request_id: "post",
                  data: { ...asset(), id: `asset_${"9".repeat(32)}` },
                },
              },
      );
      render(<AssetsPage />);
      await ready();
      click("synthetic.png详情与引用");
      await submitEditor();
      expect(
        screen.getByText(
          mode === "UNKNOWN"
            ? /引用操作结果未知/
            : mode === "REJECTED"
              ? /引用操作被拒绝/
              : /引用回执身份.*不符/,
        ),
      ).toBeVisible();
      expect(api.listProjectMediaAssets).toHaveBeenCalledTimes(1);
      if (mode !== "REJECTED") expect(localStorage.getItem(unknownKey)).toBe("1");
    },
  );

  test.each(["DELETED", "REMOTE_UNKNOWN", "DEFINITE_SERVER_ERROR"] as const)(
    "soft delete handles %s and refreshes only confirmed success",
    async (kind) => {
      const api = setup();
      api.deleteProjectMediaAsset.mockResolvedValue(
        kind === "DEFINITE_SERVER_ERROR"
          ? { kind, status: 409, code: "REFERENCED", request_id: "delete" }
          : { kind },
      );
      render(<AssetsPage />);
      await ready();
      click("删除素材");
      expect(api.deleteProjectMediaAsset).not.toHaveBeenCalled();
      await submitEditor();
      expect(api.deleteProjectMediaAsset).toHaveBeenCalledWith(projectId, assetId);
      expect(
        screen.getByText(
          kind === "DELETED"
            ? /素材已软删除/
            : kind === "REMOTE_UNKNOWN"
              ? /删除结果未知/
              : /删除被拒绝/,
        ),
      ).toBeVisible();
      expect(api.listProjectMediaAssets).toHaveBeenCalledTimes(kind === "DELETED" ? 2 : 1);
      if (kind === "REMOTE_UNKNOWN") expect(localStorage.getItem(unknownKey)).toBe("1");
    },
  );

  test("referenced asset cannot initiate deletion", async () => {
    const api = setup(asset({}, true));
    render(<AssetsPage />);
    await ready();
    expect(screen.getByRole("button", { name: "删除素材" })).toBeDisabled();
    expect(api.deleteProjectMediaAsset).not.toHaveBeenCalled();
  });

  test("without selected episode details expose no write action", async () => {
    setup();
    view.selectedEpisodeId = null;
    render(<AssetsPage />);
    await ready();
    click("synthetic.png详情与引用");
    expect(view.setEditor.mock.calls.at(-1)?.[0].save).toBeUndefined();
  });
});

function historicalAsset(kind: AssetVersion["kind"] = "image") {
  const old = asset({
    kind,
    mime_type: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/wav",
    technical_metadata: { source_note: "original-source" },
  });
  const newer: AssetVersion = {
    ...old.latest_version,
    id: `asv_${"8".repeat(32)}`,
    ordinal: 2,
    filename: `newer-${kind}.local`,
    sha256: "8".repeat(64),
    technical_metadata: { source_note: "new-source" },
  };
  return { ...old, latest_version: newer, versions: [old.latest_version, newer] };
}
function chooseVersion(id: string) {
  fireEvent.change(screen.getByLabelText("查看素材版本"), { target: { value: id } });
}

describe("production asset history selection", () => {
  test("retains an explicit historical choice made before initial selection effects settle", async () => {
    const current = historicalAsset();
    Object.assign(current.versions[0]!, { availability: "CORRUPT" });
    const api = setup(current);
    let selectedDuringCommit = false;
    render(
      <Profiler
        id="early-historical-selection"
        onRender={() => {
          const choice = screen.queryByLabelText("查看素材版本");
          if (selectedDuringCommit || !(choice instanceof HTMLSelectElement)) return;
          // Commit has exposed the real control, before deferred selection
          // initialization. Keep React state real and reuse the gateway fixture.
          selectedDuringCommit = true;
          choice.value = versionId;
          choice.dispatchEvent(new Event("change", { bubbles: true }));
        }}
      >
        <AssetsPage />
      </Profiler>,
    );
    await waitFor(() => expect(selectedDuringCommit).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByLabelText("查看素材版本")).toHaveValue(versionId);
    expect(screen.getByText("original-source")).toBeInTheDocument();
    click("预览所选版本原件");
    expect(screen.getByText(/素材文件缺失或损坏/)).toBeInTheDocument();
    expect(api.readProjectMediaAssetPreview).not.toHaveBeenCalled();
  });
  test("previews exact historical image metadata and original bytes with no writes or automatic latest substitution", async () => {
    const current = historicalAsset();
    const api = setup(current);
    api.readProjectMediaAssetPreview.mockResolvedValue({
      kind: "READY",
      mime_type: "image/png",
      sha256: "4".repeat(64),
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    expect(screen.getByLabelText("查看素材版本")).toHaveValue(versionId);
    expect(screen.getByText("original-source")).toBeInTheDocument();
    expect(screen.queryByText("new-source")).not.toBeInTheDocument();
    expect(api.readProjectMediaAssetPreview).not.toHaveBeenCalled();
    click("预览所选版本原件");
    await waitFor(() => expect(view.setEditor).toHaveBeenCalledOnce());
    expect(api.readProjectMediaAssetPreview).toHaveBeenCalledExactlyOnceWith(
      projectId,
      assetId,
      versionId,
    );
    const editor = view.setEditor.mock.calls[0]![0];
    expect(editor.title).toBe("synthetic.png");
    expect(editor.description).toContain(`所选版本：${versionId}`);
    expect(editor.description).toContain(`当前最新版：${current.latest_version.id}`);
    expect(api.importProjectMediaAssetVersionFromPicker).not.toHaveBeenCalled();
    expect(api.addProjectMediaAssetEpisodeReference).not.toHaveBeenCalled();
  });

  test.each(["video", "audio"] as const)(
    "historical %s player releases its URL when selection changes",
    async (kind) => {
      const current = historicalAsset(kind);
      const api = setup(current);
      api.readProjectMediaAssetPreview.mockResolvedValue({
        kind: "READY",
        mime_type: current.versions[0]!.mime_type,
        sha256: "4".repeat(64),
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
      render(<AssetsPage />);
      await ready(current.latest_version.filename);
      chooseVersion(versionId);
      click("预览所选版本原件");
      await screen.findByRole("dialog", { name: "synthetic.png 原件预览" });
      expect(api.readProjectMediaAssetPreview).toHaveBeenCalledWith(projectId, assetId, versionId);
      chooseVersion(current.latest_version.id);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-preview");
    },
  );

  test("refreshing a new head retains the chosen immutable older version", async () => {
    const current = historicalAsset();
    const api = setup(current);
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    const newer = {
      ...current.latest_version,
      id: `asv_${"9".repeat(32)}`,
      ordinal: 3,
      filename: "third.png",
      sha256: "9".repeat(64),
    };
    api.listProjectMediaAssets.mockResolvedValue({
      kind: "LISTED",
      receipt: {
        data: [{ ...current, latest_version: newer, versions: [...current.versions, newer] }],
        request_id: "new-head",
      },
    });
    click("刷新素材");
    await ready("third.png");
    expect(screen.getByLabelText("查看素材版本")).toHaveValue(versionId);
    expect(screen.getByText("original-source")).toBeInTheDocument();
    expect(api.readProjectMediaAssetPreview).not.toHaveBeenCalled();
  });

  test("a missing chosen version never falls back to the new head", async () => {
    const current = historicalAsset();
    const api = setup(current);
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    api.listProjectMediaAssets.mockResolvedValue({
      kind: "LISTED",
      receipt: {
        data: [{ ...current, versions: [current.latest_version] }],
        request_id: "missing-old",
      },
    });
    click("刷新素材");
    await screen.findByText(/原选择未可靠读回，未改用最新版/);
    expect(screen.getByLabelText("查看素材版本")).toHaveValue(versionId);
    expect(screen.queryByRole("button", { name: "预览所选版本原件" })).toBeNull();
    expect(api.readProjectMediaAssetPreview).not.toHaveBeenCalled();
  });

  test.each(["MISSING", "CORRUPT"] as const)(
    "%s historical source stays selected and cannot be previewed",
    async (availability) => {
      const current = historicalAsset();
      Object.assign(current.versions[0]!, { availability });
      const api = setup(current);
      render(<AssetsPage />);
      await ready(current.latest_version.filename);
      chooseVersion(versionId);
      click("预览所选版本原件");
      expect(screen.getByText(/素材文件缺失或损坏/)).toBeInTheDocument();
      expect(api.readProjectMediaAssetPreview).not.toHaveBeenCalled();
      expect(screen.getByLabelText("查看素材版本")).toHaveValue(versionId);
    },
  );

  test("a newer-version preview receipt cannot display the selected older original", async () => {
    const current = historicalAsset();
    const api = setup(current);
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    click("预览所选版本原件");
    await screen.findByText(/预览身份、大小或哈希与版本不符/);
    expect(view.setEditor).not.toHaveBeenCalled();
    expect(api.readProjectMediaAssetPreview).toHaveBeenCalledWith(projectId, assetId, versionId);
  });

  test("A→B→A selection discards an old A read even when its ids and hash again match", async () => {
    const current = historicalAsset();
    const api = setup(current);
    let finish!: (
      value: Awaited<ReturnType<AssetLibraryGateway["readProjectMediaAssetPreview"]>>,
    ) => void;
    api.readProjectMediaAssetPreview.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    click("预览所选版本原件");
    await waitFor(() => expect(api.readProjectMediaAssetPreview).toHaveBeenCalledOnce());
    chooseVersion(current.latest_version.id);
    chooseVersion(versionId);
    await act(async () => {
      finish({
        kind: "READY",
        mime_type: "image/png",
        sha256: "4".repeat(64),
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
    });
    expect(view.setEditor).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByLabelText("查看素材版本")).toHaveValue(versionId);
  });

  test("explicit historical reference confirmation submits the exact chosen version", async () => {
    const current = historicalAsset();
    const api = setup(current);
    const referenced = {
      ...current,
      episode_references: [
        {
          episode_id: "ep_local",
          version_id: versionId,
          role: "project-reference",
          created_at: current.created_at,
        },
      ],
    };
    api.addProjectMediaAssetEpisodeReference.mockResolvedValue({
      kind: "REFERENCED",
      receipt: { data: referenced, request_id: "historical-reference" },
    });
    api.listProjectMediaAssets
      .mockResolvedValueOnce({
        kind: "LISTED",
        receipt: { data: [current], request_id: "initial" },
      })
      .mockResolvedValue({
        kind: "LISTED",
        receipt: { data: [referenced], request_id: "persisted" },
      });
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    click("查看此版本详情与引用");
    expect(view.setEditor.mock.calls.at(-1)![0].confirm).toBe("引用所选版本到本集");
    expect(api.addProjectMediaAssetEpisodeReference).not.toHaveBeenCalled();
    await submitEditor();
    expect(api.addProjectMediaAssetEpisodeReference).toHaveBeenCalledExactlyOnceWith(
      projectId,
      assetId,
      { episode_id: "ep_local", version_id: versionId, role: "project-reference" },
    );
    expect(screen.getByLabelText("查看素材版本")).toHaveValue(versionId);
    expect(await screen.findByText(/已引用该资产版本到本集/)).toBeInTheDocument();
  });

  test.each(["version", "episode"] as const)(
    "a stale %s detail confirmation cannot write after selection changes",
    async (change) => {
      const current = historicalAsset();
      const api = setup(current);
      const mounted = render(<AssetsPage />);
      await ready(current.latest_version.filename);
      chooseVersion(versionId);
      click("查看此版本详情与引用");
      const editor = view.setEditor.mock.calls.at(-1)![0];
      if (change === "version") chooseVersion(current.latest_version.id);
      else {
        view.selectedEpisodeId = "ep_changed";
        mounted.rerender(<AssetsPage />);
      }
      await act(async () => {
        await editor.save?.({});
      });
      expect(api.addProjectMediaAssetEpisodeReference).not.toHaveBeenCalled();
      expect(await screen.findByText(/选择已变化，请重新打开详情/)).toBeInTheDocument();
    },
  );

  test.each(["absent", "newer"] as const)(
    "a contradictory %s reference receipt stays locked without auto replay",
    async (mode) => {
      const current = historicalAsset();
      const api = setup(current);
      const wrong = {
        ...current,
        episode_references:
          mode === "absent"
            ? []
            : [
                {
                  episode_id: "ep_local",
                  version_id: current.latest_version.id,
                  role: "project-reference",
                  created_at: current.created_at,
                },
              ],
      };
      api.addProjectMediaAssetEpisodeReference.mockResolvedValue({
        kind: "REFERENCED",
        receipt: { data: wrong, request_id: "bad-confirmation" },
      });
      render(<AssetsPage />);
      await ready(current.latest_version.filename);
      chooseVersion(versionId);
      click("查看此版本详情与引用");
      await submitEditor();
      await submitEditor();
      expect(await screen.findByText(/引用回执身份.*不符/)).toBeInTheDocument();
      expect(localStorage.getItem(unknownKey)).toBe("1");
      expect(api.addProjectMediaAssetEpisodeReference).toHaveBeenCalledOnce();
      expect(api.listProjectMediaAssets).toHaveBeenCalledOnce();
    },
  );

  test("restores each asset's chosen immutable version after A→B→A", async () => {
    const current = historicalAsset();
    const other = {
      ...asset({ id: `asv_${"a".repeat(32)}`, filename: "other.png" }),
      id: `asset_${"a".repeat(32)}`,
    };
    const api = setup(current);
    api.listProjectMediaAssets.mockResolvedValue({
      kind: "LISTED",
      receipt: { data: [current, other], request_id: "two-assets" },
    });
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    click("选择 other.png");
    expect(screen.getByLabelText("查看素材版本")).toHaveValue(other.latest_version.id);
    click(`选择 ${current.latest_version.filename}`);
    expect(screen.getByLabelText("查看素材版本")).toHaveValue(versionId);
    expect(api.readProjectMediaAssetPreview).not.toHaveBeenCalled();
  });

  test("a previous project's pending preview cannot display after switching to another project", async () => {
    const current = historicalAsset();
    const api = setup(current);
    let finish!: (
      value: Awaited<ReturnType<AssetLibraryGateway["readProjectMediaAssetPreview"]>>,
    ) => void;
    api.readProjectMediaAssetPreview.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const other = { ...current, project_id: `prj_${"9".repeat(32)}` };
    api.listProjectMediaAssets.mockImplementation(async (p) => ({
      kind: "LISTED",
      receipt: { data: [p === projectId ? current : other], request_id: "scoped-assets" },
    }));
    const mounted = render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    click("预览所选版本原件");
    view.backendProjectId = other.project_id;
    mounted.rerender(<AssetsPage />);
    await ready(other.latest_version.filename);
    await act(async () => {
      finish({
        kind: "READY",
        mime_type: "image/png",
        sha256: "4".repeat(64),
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
    });
    expect(view.setEditor).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(api.listProjectMediaAssets).toHaveBeenCalledWith(other.project_id);
  });

  test("persists the existing recovery marker before reference dispatch and prevents a second stale callback or close", async () => {
    const current = historicalAsset();
    const api = setup(current);
    let finish!: (
      value: Awaited<ReturnType<AssetLibraryGateway["addProjectMediaAssetEpisodeReference"]>>,
    ) => void;
    api.addProjectMediaAssetEpisodeReference.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const mounted = render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    click("查看此版本详情与引用");
    const editor = view.setEditor.mock.calls.at(-1)![0];
    let active!: Promise<boolean | void>;
    await act(async () => {
      active = Promise.resolve(editor.save?.({}));
    });
    expect(localStorage.getItem(unknownKey)).toBe("1");
    await act(async () => {
      await editor.save?.({});
    });
    expect(api.addProjectMediaAssetEpisodeReference).toHaveBeenCalledOnce();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    mounted.unmount();
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    expect(screen.getByText(/先前素材写入结果未知或本地记录不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入素材" })).toBeDisabled();
    await act(async () => {
      finish({ kind: "REMOTE_UNKNOWN" });
      await active;
    });
    expect(localStorage.getItem(unknownKey)).toBe("1");
    expect(api.addProjectMediaAssetEpisodeReference).toHaveBeenCalledOnce();
  });

  test("storage failure after opening a reference confirmation prevents dispatch", async () => {
    const current = historicalAsset();
    const api = setup(current);
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    click("查看此版本详情与引用");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    await submitEditor();
    expect(api.addProjectMediaAssetEpisodeReference).not.toHaveBeenCalled();
    expect(screen.getByText(/无法保存素材写入恢复记录/)).toBeInTheDocument();
  });

  test("a definite reference refusal clears only its durable marker and never claims a successful pin", async () => {
    const current = historicalAsset();
    const api = setup(current);
    api.addProjectMediaAssetEpisodeReference.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "REFERENCE_EXISTS",
      request_id: "rejected",
    });
    render(<AssetsPage />);
    await ready(current.latest_version.filename);
    chooseVersion(versionId);
    click("查看此版本详情与引用");
    await submitEditor();
    expect(localStorage.getItem(unknownKey)).toBeNull();
    expect(screen.getByText(/引用操作被拒绝/)).toBeInTheDocument();
    expect(screen.queryByText(/已引用该资产版本/)).toBeNull();
  });
});
