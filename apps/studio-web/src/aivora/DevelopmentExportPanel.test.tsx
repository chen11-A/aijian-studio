import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DevelopmentExportResponse, StudioTransport } from "../api/studio";
import type * as StudioModule from "../api/studio";
import type { DevelopmentTimelineSnapshotResult } from "./adapters/developmentTimeline";
import { DevelopmentExportPanel } from "./DevelopmentExportPanel";

let transport: Partial<StudioTransport>;
vi.mock("../api/studio", async (importOriginal) => ({
  ...(await importOriginal<typeof StudioModule>()),
  createStudioTransport: () => transport,
}));
const projectId = `prj_${"1".repeat(32)}`;
const versionId = `ver_${"2".repeat(32)}`;
const contentHash = `sha256:${"3".repeat(64)}`;
const outputHash = `sha256:${"4".repeat(64)}`;
const exportId = `dex_${"5".repeat(32)}`;
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const key = `aivora.development-export.v2.${projectId}`;
const snapshot: DevelopmentTimelineSnapshotResult = {
  kind: "ready",
  snapshot: {
    projectId,
    versionId,
    contentHash,
    revision: 1,
    clips: [],
    assets: [],
    mediaPackage: {
      schema_version: 1,
      manifest_relative_path: "manifest.json",
      media_package_id: `fmp_${"6".repeat(32)}`,
      manifest_sha256: contentHash,
      assets: [],
    },
    durationFrames: 25,
    frameRate: { num: 25, den: 1 },
  },
};
function receipt(): DevelopmentExportResponse {
  return {
    request_id: operationId,
    data: {
      project_id: projectId,
      export_id: exportId,
      operation_id: operationId,
      timeline_version_id: versionId,
      timeline_content_hash: contentHash,
      timeline_revision: 1,
      purpose: "DEVELOPMENT_EVIDENCE",
      status: "SUCCEEDED",
      output: {
        workspace_scope: "SIDECAR_WORKSPACE",
        relative_path: "exports/synthetic.mp4",
        mime_type: "video/mp4",
        sha256: outputHash,
        byte_length: 4,
        width: 1080,
        height: 1920,
        frame_rate_num: 25,
        frame_rate_den: 1,
        duration_frames: 25,
        duration_seconds: 1,
        has_audio: false,
      },
    },
  };
}
function saved(status = "UNKNOWN") {
  return {
    projectId,
    timelineVersionId: versionId,
    contentHash,
    revision: 1,
    operationId,
    status,
    exportId: status === "SUCCEEDED" ? exportId : null,
    receipt: null,
    rejection: null,
  };
}
function setup(timeline = snapshot, project: string | null = projectId) {
  const api = {
    createDevelopmentExport: vi.fn().mockResolvedValue(receipt()),
    getDevelopmentExport: vi.fn().mockResolvedValue(receipt()),
    openDevelopmentExport: vi.fn().mockResolvedValue({ kind: "OPENED", export_id: exportId }),
    saveDevelopmentExport: vi.fn().mockResolvedValue({ kind: "SAVED", export_id: exportId }),
    readDevelopmentExportPreview: vi.fn().mockResolvedValue({
      kind: "READY",
      export_id: exportId,
      sha256: outputHash,
      mime_type: "video/mp4",
      bytes: new ArrayBuffer(4),
    }),
  };
  transport = api;
  return { api, ...render(<DevelopmentExportPanel projectId={project} timeline={timeline} />) };
}
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
async function create() {
  click("生成开发 MP4");
  await screen.findByText("开发导出回执已保存。");
}
const makeUrl = vi.fn(() => "blob:synthetic-preview");
const revoke = vi.fn();
beforeEach(() => {
  localStorage.clear();
  makeUrl.mockClear();
  revoke.mockClear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = makeUrl;
      static revokeObjectURL = revoke;
    },
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("development export panel durable user actions", () => {
  test.each(["no-project", "not-ready", "wrong-rate", "corrupt-journal"])(
    "%s blocks export",
    (reason) => {
      const value = structuredClone(snapshot);
      if (reason === "corrupt-journal") localStorage.setItem(key, "{");
      if (reason === "wrong-rate" && value.kind === "ready") value.snapshot.frameRate.num = 24;
      const h = setup(
        reason === "not-ready" || reason === "no-project"
          ? { kind: "unavailable", reason: "NOT_READY" }
          : value,
        reason === "no-project" ? null : projectId,
      );
      expect(screen.getByRole("button", { name: "生成开发 MP4" })).toBeDisabled();
      expect(h.api.createDevelopmentExport).not.toHaveBeenCalled();
    },
  );

  test("creates once, renders exact receipt, and needs explicit completion before new export", async () => {
    const h = setup();
    await create();
    expect(screen.getByText(/文件：exports\/synthetic.mp4/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成开发 MP4" })).toBeDisabled();
    expect(h.api.createDevelopmentExport).toHaveBeenCalledTimes(1);
    click("结束已完成操作并新建");
    expect(screen.getByText(/已结束上一项已完成导出/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成开发 MP4" })).toBeEnabled();
    expect(localStorage.getItem(key)).toBeNull();
  });

  test("UNKNOWN locks create and can only query the original operation", async () => {
    const h = setup();
    h.api.createDevelopmentExport.mockRejectedValue(new Error("lost"));
    click("生成开发 MP4");
    expect(await screen.findByText(/导出结果未知；只能/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成开发 MP4" })).toBeDisabled();
    click("查询原操作");
    expect(await screen.findByText(/已读取原操作的开发导出回执/)).toBeInTheDocument();
    expect(h.api.getDevelopmentExport).toHaveBeenCalledExactlyOnceWith(
      projectId,
      operationId,
      versionId,
      1,
    );
    expect(h.api.createDevelopmentExport).toHaveBeenCalledTimes(1);
  });

  test("reopened success cannot access output until GET restores matching metadata", async () => {
    localStorage.setItem(key, JSON.stringify(saved("SUCCEEDED")));
    setup();
    expect(screen.getByRole("button", { name: "另存 MP4" })).toBeDisabled();
    click("查询原操作");
    await screen.findByText(/已读取原操作的开发导出回执/);
    expect(screen.getByRole("button", { name: "另存 MP4" })).toBeEnabled();
  });

  test.each(["read-unavailable", "still-unknown"])(
    "%s preserves original operation",
    async (fault) => {
      localStorage.setItem(key, JSON.stringify(saved()));
      const h = setup();
      if (fault === "read-unavailable") delete transport.getDevelopmentExport;
      else h.api.getDevelopmentExport.mockRejectedValue(new Error("offline"));
      click("查询原操作");
      expect(
        await screen.findByText(
          fault === "read-unavailable" ? /不支持查询开发导出/ : /原操作仍为未知/,
        ),
      ).toBeInTheDocument();
      expect(h.api.createDevelopmentExport).not.toHaveBeenCalled();
    },
  );

  test("storage failure reports unavailability without dispatch", async () => {
    const h = setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    click("生成开发 MP4");
    expect(await screen.findByText(/无法保存导出操作身份/)).toBeInTheDocument();
    expect(h.api.createDevelopmentExport).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    "safe first rejection requires verified audit closure, storage works=%s",
    async (works) => {
      const h = setup();
      h.api.createDevelopmentExport.mockResolvedValue({
        kind: "DEFINITE_REJECTION",
        project_id: projectId,
        operation_id: operationId,
        timeline_version_id: versionId,
        expected_revision: 1,
        status: 422,
        code: "DEVELOPMENT_EXPORT_PREFLIGHT_REJECTED",
        disposition: "REVIEW_INPUT",
        request_effect: "NO_EXPORT_CLAIM",
        request_id: operationId,
      });
      click("生成开发 MP4");
      await screen.findByText(/首次提交被明确拒绝，且服务端/);
      if (!works)
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new Error("full");
        });
      click("审计并结束已拒绝操作");
      expect(
        screen.getByText(works ? /拒绝操作已审计并结案/ : /拒绝操作未能完成审计/),
      ).toBeInTheDocument();
      expect(h.api.createDevelopmentExport).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "生成开发 MP4" }).hasAttribute("disabled")).toBe(
        !works,
      );
    },
  );

  test("ambiguous rejection is displayed but cannot close UNKNOWN", async () => {
    const h = setup();
    h.api.createDevelopmentExport.mockResolvedValue({
      kind: "DEFINITE_REJECTION",
      project_id: projectId,
      operation_id: operationId,
      timeline_version_id: versionId,
      expected_revision: 1,
      status: 409,
      code: "CONFLICT",
      disposition: "RECONCILE_OPERATION",
      request_id: operationId,
    });
    click("生成开发 MP4");
    expect(await screen.findByText(/收到拒绝信息，但不足以证明/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审计并结束已拒绝操作" })).not.toBeInTheDocument();
  });

  test("failed completion cleanup retains the prior operation", async () => {
    setup();
    await create();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("locked");
    });
    click("结束已完成操作并新建");
    expect(screen.getByText(/无法清除已完成操作/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成开发 MP4" })).toBeDisabled();
  });

  test.each(["OPENED", "SAVED", "CANCELLED", "REMOTE_UNKNOWN", "UNAVAILABLE"])(
    "access reports %s without claiming playback",
    async (kind) => {
      const h = setup();
      await create();
      if (kind === "OPENED") click("用系统播放器打开");
      else {
        h.api.saveDevelopmentExport.mockResolvedValue({
          kind,
          export_id: exportId,
          operation_id: operationId,
        });
        click("另存 MP4");
      }
      const text = {
        OPENED: /已交给系统播放器打开/,
        SAVED: /已保存开发 MP4 副本/,
        CANCELLED: /已取消另存/,
        REMOTE_UNKNOWN: /打开或另存结果未知/,
        UNAVAILABLE: /无法打开或另存该导出/,
      }[kind]!;
      expect(await screen.findByText(text)).toBeInTheDocument();
    },
  );
});

describe("development preview lifecycle and byte identity", () => {
  test("exact preview becomes a blob and is revoked when timeline changes", async () => {
    const h = setup();
    await create();
    click("读取页面预览");
    expect(await screen.findByLabelText("当前开发 MP4 页面预览")).toHaveAttribute(
      "src",
      "blob:synthetic-preview",
    );
    expect(h.api.readDevelopmentExportPreview).toHaveBeenCalledExactlyOnceWith(
      projectId,
      operationId,
      versionId,
      1,
      outputHash,
    );
    const changed = structuredClone(snapshot);
    if (changed.kind !== "ready") throw new Error("fixture");
    h.rerender(
      <DevelopmentExportPanel
        projectId={projectId}
        timeline={{ ...changed, snapshot: { ...changed.snapshot, revision: 2 } }}
      />,
    );
    expect(screen.queryByLabelText("当前开发 MP4 页面预览")).not.toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-preview");
    expect(screen.getByRole("button", { name: "另存 MP4" })).toBeDisabled();
  });

  test("media element error releases preview without claiming an encoding failure", async () => {
    setup();
    await create();
    click("读取页面预览");
    fireEvent.error(await screen.findByLabelText("当前开发 MP4 页面预览"));
    expect(screen.getByText(/视频无法在页面播放/)).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-preview");
  });

  test.each(["export", "hash", "mime", "type", "length", "empty"])(
    "rejects %s mismatch without creating a blob",
    async (fault) => {
      const h = setup();
      await create();
      const result = {
        kind: "READY",
        export_id: exportId,
        sha256: outputHash,
        mime_type: "video/mp4",
        bytes: new ArrayBuffer(4),
      };
      if (fault === "export") result.export_id = "wrong";
      if (fault === "hash") result.sha256 = "wrong";
      if (fault === "mime") result.mime_type = "text/html";
      if (fault === "type") result.bytes = new Uint8Array(4) as unknown as ArrayBuffer;
      if (fault === "length") result.bytes = new ArrayBuffer(3);
      if (fault === "empty") result.bytes = new ArrayBuffer(0);
      h.api.readDevelopmentExportPreview.mockResolvedValue(result);
      click("读取页面预览");
      expect(await screen.findByText(/预览回包与当前导出回执不一致/)).toBeInTheDocument();
      expect(makeUrl).not.toHaveBeenCalled();
    },
  );

  test.each(["PREVIEW_TOO_LARGE", "REMOTE_UNKNOWN", "UNAVAILABLE", "WRONG_ID", "THROW"])(
    "reports %s preview without a playback address",
    async (kind) => {
      const h = setup();
      await create();
      h.api.readDevelopmentExportPreview.mockResolvedValue({
        kind: kind === "WRONG_ID" ? "UNAVAILABLE" : kind,
        operation_id: kind === "WRONG_ID" ? "wrong" : operationId,
      });
      if (kind === "THROW")
        h.api.readDevelopmentExportPreview.mockRejectedValue(new Error("offline"));
      click("读取页面预览");
      const notice = {
        PREVIEW_TOO_LARGE: /超过 64 MiB/,
        REMOTE_UNKNOWN: /预览读取结果未知/,
        UNAVAILABLE: /预览文件不可读/,
        WRONG_ID: /预览响应身份不一致/,
        THROW: /预览读取失败/,
      }[kind]!;
      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(makeUrl).not.toHaveBeenCalled();
    },
  );

  test.each([false, true])(
    "late preview after navigation is discarded, failure=%s",
    async (failure) => {
      const h = setup();
      await create();
      let finish!: () => void;
      h.api.readDevelopmentExportPreview.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish = () =>
              failure
                ? reject(new Error("offline"))
                : resolve({
                    kind: "READY",
                    export_id: exportId,
                    sha256: outputHash,
                    mime_type: "video/mp4",
                    bytes: new ArrayBuffer(4),
                  });
          }),
      );
      click("读取页面预览");
      h.rerender(
        <DevelopmentExportPanel
          projectId={null}
          timeline={{ kind: "unavailable", reason: "NO_PROJECT" }}
        />,
      );
      await act(async () => {
        finish();
      });
      expect(makeUrl).not.toHaveBeenCalled();
      expect(screen.queryByText(/预览读取失败/)).not.toBeInTheDocument();
    },
  );
});
