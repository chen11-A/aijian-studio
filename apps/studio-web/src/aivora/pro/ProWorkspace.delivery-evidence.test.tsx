import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  FilmExportQcPrepared,
  FilmExportQcPublishResult,
} from "@aijian/contracts/film-export-qc";
import { sampleFilm, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";
import * as editors from "./actions/editor-host";
import * as delivery from "./use-export-delivery";
import { writtenDelivery } from "./delivery-evidence.test-fixture";
import { deferred } from "./shot-audio-suggestions.test-fixture";
const createHost = editors.createEditorHost,
  originalDelivery = delivery.useExportDelivery;
const writes = new Set<Promise<unknown>>();
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(async () => {
  cleanup();
  while (writes.size) await Promise.allSettled([...writes]);
  vi.restoreAllMocks();
});
const ready: FilmExportQcPrepared = {
  kind: "READY",
  qcReceipt: "synthetic-review-only",
  outputs: [
    {
      aspectRatio: "16:9",
      report: {
        schemaVersion: 1,
        media: { duration: 2.25, width: 1920, height: 1080 },
        audio: { present: false, integratedLufs: null, truePeakDbtp: null },
        assumptions: { streams: "技术记录" },
        issues: [],
      },
    },
  ],
  shots: [],
  fileName: "合成成片.mp4",
  unverified: ["完整观看和试听未完成。"],
};
async function open() {
  const film = sampleFilm();
  film.jobs = [];
  film.audioClips = [];
  film.shots = film.shots.slice(0, 2).map((s, i) => ({
    ...s,
    selectedTakeId: `delivery-take-${i}`,
    takes: [
      {
        id: `delivery-take-${i}`,
        shotId: s.id,
        index: 1,
        status: "done",
        videoPath: `/synthetic/source-${i}.mp4`,
        videoUrl: "",
        stillUrl: "",
        prompt: "",
        reason: "",
        createdAt: "",
      },
    ],
  }));
  const disk = new Map([[film.id, structuredClone(film)]]),
    firstWrite = deferred<void>();
  let host!: Parameters<typeof createHost>[0],
    failWrite = false;
  vi.spyOn(editors, "createEditorHost").mockImplementation((value) => {
    host = value;
    return createHost(value);
  });
  const callbacks: ReturnType<typeof originalDelivery>[] = [];
  vi.spyOn(delivery, "useExportDelivery").mockImplementation((...args) => {
    const value = originalDelivery(...args);
    callbacks.push(value);
    return value;
  });
  const write = vi.fn((raw: FilmProject) => {
    const promise = (async () => {
      if (failWrite) throw Error("SYNTHETIC_SAVE_FAILED");
      disk.set(raw.id, structuredClone(raw));
      firstWrite.resolve();
      return structuredClone(raw);
    })();
    writes.add(promise);
    void promise.then(
      () => writes.delete(promise),
      () => writes.delete(promise),
    );
    return promise;
  });
  const publish = vi.fn(async (): Promise<FilmExportQcPublishResult> => ({
    kind: "PUBLISHED",
    outputs: [{ aspectRatio: "16:9", path: "/synthetic/published/合成成片.mp4" }],
    deliveryEvidence: writtenDelivery(),
  }));
  const prepare = vi.fn(async () => structuredClone(ready)),
    discard = vi.fn(async () => undefined),
    old = vi.fn(),
    provider = vi.fn(),
    reveal = vi.fn(),
    play = vi.fn();
  window.aijian = {
    listFilmSeries: async () => [],
    readFilmProject: async (id: string) => structuredClone(disk.get(id) ?? null),
    writeFilmProject: write,
    prepareFilmExport: prepare,
    publishFilmExport: publish,
    discardFilmExport: discard,
    exportFilmCut: old,
    assembleFilm: old,
    createStoryFilm: provider,
    revealFilmPath: reveal,
    openFilmPath: play,
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  const rendered = render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await firstWrite.promise;
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  {
    const silentChoice = screen.queryByRole("button", { name: "本片静音" });
    if (silentChoice) fireEvent.click(silentChoice);
  }
  fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "审核后发布" })).toBeEnabled());
  const publishNow = () => fireEvent.click(screen.getByRole("button", { name: "审核后发布" }));
  return {
    film,
    disk,
    publish,
    prepare,
    discard,
    old,
    provider,
    reveal,
    play,
    write,
    callbacks,
    rendered,
    publishNow,
    host: () => host,
    failSave: () => {
      failWrite = true;
    },
  };
}
it("requires original review before showing main evidence, preserves media and sends only one explicit publish", async () => {
  const f = await open(),
    before = structuredClone(f.host().current()!);
  expect(screen.queryByRole("region", { name: "交付证据" })).not.toBeInTheDocument();
  expect(f.publish).not.toHaveBeenCalled();
  f.publishNow();
  await screen.findByRole("heading", { name: "交付清单已生成" });
  expect(screen.getByText("合成交付清单.json")).toBeInTheDocument();
  expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("/synthetic/published");
  expect(document.body.textContent).not.toMatch(/private-shot-id|private-take-id/);
  fireEvent.click(screen.getByRole("button", { name: "打开文件夹" }));
  fireEvent.click(screen.getByRole("button", { name: "播放" }));
  expect(f.reveal).toHaveBeenCalledExactlyOnceWith("/synthetic/published/合成成片.mp4");
  expect(f.play).toHaveBeenCalledExactlyOnceWith("/synthetic/published/合成成片.mp4");
  expect(f.host().current()!.shots).toEqual(before.shots);
  expect(f.publish).toHaveBeenCalledTimes(1);
  expect(f.old).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("shows legacy absence explicitly and does not fabricate a manifest from the published path", async () => {
  const f = await open();
  f.publish.mockResolvedValueOnce({
    kind: "PUBLISHED",
    outputs: [{ aspectRatio: "16:9", path: "/synthetic/legacy.mp4" }],
  });
  f.publishNow();
  await screen.findByText("这次导出未提供交付清单，暂时不能核对交付证据。");
  expect(screen.queryByRole("heading", { name: "交付清单已生成" })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain("/synthetic/legacy.mp4");
  expect(f.publish).toHaveBeenCalledTimes(1);
});
it.each(["WRITTEN", "FAILED"] as const)(
  "retains only confirmed partial files when evidence is %s",
  async (kind) => {
    const f = await open(),
      evidence = writtenDelivery("partial");
    evidence.manifest.settings.aspects = ["16:9", "9:16"];
    f.publish.mockResolvedValueOnce({
      kind: "PARTIAL",
      outputs: [{ aspectRatio: "16:9", path: "/synthetic/partial.mp4" }],
      deliveryEvidence:
        kind === "WRITTEN"
          ? evidence
          : {
              kind: "FAILED",
              code: "EVIDENCE_WRITE_FAILED",
              files: [{ role: "video", aspectRatio: "16:9", fileName: "已落横屏.mp4" }],
            },
    });
    f.publishNow();
    await screen.findByText("本次导出仅完成一部分，已写出的文件保留。");
    if (kind === "FAILED") {
      expect(screen.queryByRole("heading", { name: "交付清单已生成" })).not.toBeInTheDocument();
      expect(screen.getByText("已落横屏.mp4")).toBeInTheDocument();
    } else expect(screen.getByText("合成交付清单.json")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开文件夹" })).toBeEnabled();
    expect(f.publish).toHaveBeenCalledTimes(1);
    expect(f.provider).not.toHaveBeenCalled();
  },
);
it.each(["FAILED", "CANCELLED"] as const)(
  "does not manufacture delivery success for %s",
  async (kind) => {
    const f = await open();
    f.publish.mockResolvedValueOnce(
      kind === "FAILED" ? { kind: "FAILED", code: "PUBLISH_FAILED" } : { kind: "CANCELLED" },
    );
    f.publishNow();
    await waitFor(() => expect(f.publish).toHaveBeenCalledTimes(1));
    if (kind === "FAILED") {
      await screen.findAllByText("发布没有完成，请检查输出文件夹后重新检查。");
      expect(screen.getByRole("button", { name: "审核后发布" })).toBeDisabled();
    } else
      await waitFor(() => expect(screen.getByRole("button", { name: "审核后发布" })).toBeEnabled());
    expect(screen.queryByRole("region", { name: "交付证据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开文件夹" })).not.toBeInTheDocument();
  },
);
it("does not adopt a late old-project publish or enable stale file callbacks in the new work", async () => {
  const f = await open(),
    pending = deferred<FilmExportQcPublishResult>();
  f.publish.mockReturnValueOnce(pending.promise);
  f.publishNow();
  const other = {
    ...structuredClone(f.host().current()!),
    id: "delivery-other-project",
    title: "另一作品",
    exportPath: "",
  };
  act(() => f.host().applyLive(other));
  await act(async () =>
    pending.resolve({
      kind: "PUBLISHED",
      outputs: [{ aspectRatio: "16:9", path: "/synthetic/old.mp4" }],
      deliveryEvidence: writtenDelivery(),
    }),
  );
  expect(f.host().current()!.id).toBe(other.id);
  expect(f.host().current()!.exportPath).toBe("");
  expect(screen.queryByRole("region", { name: "交付证据" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "打开文件夹" })).not.toBeInTheDocument();
  expect(f.play).not.toHaveBeenCalled();
});
it("retires retained file actions synchronously on project change and when a new check begins", async () => {
  const f = await open();
  f.publishNow();
  await screen.findByRole("heading", { name: "交付清单已生成" });
  const old = f.callbacks.at(-1)!;
  const original = structuredClone(f.host().current()!);
  act(() => {
    f.host().applyLive({ ...original, id: "delivery-other", exportPath: "" });
    old.onOpen();
    old.onReveal();
  });
  expect(f.play).not.toHaveBeenCalled();
  expect(f.reveal).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "交付证据" })).not.toBeInTheDocument();
  act(() => f.host().applyLive(original));
  {
    const silentChoice = screen.queryByRole("button", { name: "本片静音" });
    if (silentChoice) fireEvent.click(silentChoice);
  }
  fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
  act(() => {
    old.onOpen();
    old.onReveal();
  });
  expect(f.play).not.toHaveBeenCalled();
  expect(f.reveal).not.toHaveBeenCalled();
});
it("keeps real written evidence when only the engineering record save fails", async () => {
  const f = await open();
  f.failSave();
  f.publishNow();
  await screen.findByRole("heading", { name: "交付清单已生成" });
  await waitFor(() =>
    expect(document.querySelector(".status-note")?.getAttribute("title")).toContain(
      "文件已发布，工程中的导出记录尚未保存。",
    ),
  );
  expect(screen.getByRole("button", { name: "打开文件夹" })).toBeEnabled();
  expect(f.publish).toHaveBeenCalledTimes(1);
});
it.each(["WRITTEN", "FAILED"] as const)(
  "keeps actual %s evidence and truthful cleanup uncertainty without repeating publish",
  async (kind) => {
    const f = await open(),
      written = writtenDelivery();
    written.cleanupUnconfirmed = true;
    f.publish.mockResolvedValueOnce({
      kind: "PARTIAL",
      outputs: [{ aspectRatio: "16:9", path: "/synthetic/cleanup-written.mp4" }],
      deliveryEvidence:
        kind === "WRITTEN"
          ? written
          : {
              kind: "FAILED",
              code: "EVIDENCE_WRITE_FAILED",
              cleanupUnconfirmed: true,
              files: [{ role: "video", aspectRatio: "16:9", fileName: "已落视频.mp4" }],
            },
    });
    f.publishNow();
    if (kind === "WRITTEN") {
      await screen.findByText("清单已写入，暂存清理未确认。");
      expect(screen.getByRole("heading", { name: "交付清单已生成" })).toBeInTheDocument();
      expect(screen.getByText(written.manifestSha256)).toBeInTheDocument();
      expect(
        screen.queryByText("本次导出仅完成一部分，已写出的文件保留。"),
      ).not.toBeInTheDocument();
      await waitFor(() =>
        expect(document.querySelector(".status-note")?.getAttribute("title")).toContain(
          "交付清单已写入，暂存清理尚未确认。",
        ),
      );
    } else {
      await screen.findByText("交付清单与暂存清理尚未确认。");
      expect(screen.getByText("已落视频.mp4")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "交付清单已生成" })).not.toBeInTheDocument();
    }
    expect(document.querySelector(".status-note")?.getAttribute("title")).not.toContain(
      "其余没有发布",
    );
    expect(f.publish).toHaveBeenCalledTimes(1);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.provider).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "打开文件夹" })).toBeEnabled();
  },
);
it("refuses the complete-manifest/partial-operation combination without the explicit cleanup flag", async () => {
  const f = await open();
  f.publish.mockResolvedValueOnce({
    kind: "PARTIAL",
    outputs: [{ aspectRatio: "16:9", path: "/synthetic/inconsistent.mp4" }],
    deliveryEvidence: writtenDelivery(),
  });
  f.publishNow();
  await screen.findByText("交付证据没有读懂，请核对已发布的文件。");
  expect(screen.queryByRole("heading", { name: "交付清单已生成" })).not.toBeInTheDocument();
  expect(f.publish).toHaveBeenCalledTimes(1);
  expect(f.provider).not.toHaveBeenCalled();
});
