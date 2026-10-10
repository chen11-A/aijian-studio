import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      .mockResolvedValue({ kind: "REFERENCED", receipt }),
    removeProjectMediaAssetEpisodeReference: vi
      .fn<AssetLibraryGateway["removeProjectMediaAssetEpisodeReference"]>()
      .mockResolvedValue({ kind: "UNREFERENCED", receipt }),
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
              : /引用回执身份不符/,
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
