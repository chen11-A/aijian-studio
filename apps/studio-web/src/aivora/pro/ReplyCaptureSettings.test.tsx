import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import * as capture from "./agent-capture";
import { ReplyCaptureSettings } from "./ReplyCaptureSettings";
import { ProWorkspace } from "./ProWorkspace";
import { saveFilm } from "../film/library";

const file = { name: "aivora-排查.json", text: '{"captureDeclaration":"real-capture"}', scenes: 2 };
let current: FilmProject | null;
const onNotice = vi.fn<(text: string) => void>();
let clicked: { name: string; href: string }[];
const createUrl = vi.fn((_blob: Blob) => "blob:reply-capture");
const revokeUrl = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  current = sampleFilm();
  onNotice.mockReset();
  clicked = [];
  createUrl.mockClear();
  revokeUrl.mockClear();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ name: this.download, href: this.href });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const open = () => render(<ReplyCaptureSettings getFilm={() => current} onNotice={onNotice} />);
const toggle = () => screen.getByRole("checkbox");
const download = () => fireEvent.click(screen.getByRole("button", { name: "导出排查文件" }));

describe("3JR-U06 reply capture settings", () => {
  it("starts off, persists the switch, and clears local replies when turned off", () => {
    const view = open();
    expect(toggle()).not.toBeChecked();
    fireEvent.click(toggle());
    expect(capture.captureEnabled()).toBe(true);
    view.unmount();
    open();
    expect(toggle()).toBeChecked();
    window.localStorage.setItem("aivora.agentCapture", "saved replies");
    fireEvent.click(toggle());
    expect(capture.captureEnabled()).toBe(false);
    expect(window.localStorage.getItem("aivora.agentCapture")).toBeNull();
    expect(clicked).toEqual([]);
  });
  it("requires an open work and an enabled switch before collecting a download", () => {
    const build = vi.spyOn(capture, "captureFile");
    current = null;
    open();
    download();
    expect(onNotice).toHaveBeenLastCalledWith("先打开一个作品，再导出排查文件。");
    current = sampleFilm();
    download();
    expect(onNotice).toHaveBeenLastCalledWith("先开启保存原始回复，再进行导演或动作生成。");
    expect(build).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });
  it("does not create a file for missing or unmatched replies", async () => {
    capture.setCaptureEnabled(true);
    vi.spyOn(capture, "captureFile").mockResolvedValue(null);
    open();
    download();
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("没有匹配")));
    expect(createUrl).not.toHaveBeenCalled();
  });
  it("downloads only on request and releases the JSON URL", async () => {
    capture.setCaptureEnabled(true);
    const build = vi.spyOn(capture, "captureFile").mockResolvedValue(file);
    open();
    expect(build).not.toHaveBeenCalled();
    download();
    await waitFor(() => expect(clicked).toEqual([{ name: file.name, href: "blob:reply-capture" }]));
    expect(build).toHaveBeenCalledWith(current);
    const blob = createUrl.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(await blob.text()).toBe(file.text);
    await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:reply-capture"));
    expect(document.querySelector("a[download]")).toBeNull();
  });
  for (const change of ["project", "source", "script", "close", "unmount"]) {
    it(`does not download after ${change} changes while preparing the file`, async () => {
      capture.setCaptureEnabled(true);
      let finish!: (value: typeof file) => void;
      vi.spyOn(capture, "captureFile").mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const view = open();
      download();
      expect(screen.getByRole("button", { name: "正在整理排查文件…" })).toBeDisabled();
      if (change === "project") current = { ...current!, id: "another-work" };
      if (change === "source") current = { ...current!, sourceText: "改过的正文" };
      if (change === "script")
        current = {
          ...current!,
          scenes: current!.scenes.map((scene, index) =>
            index ? scene : { ...scene, text: "改过的剧本" },
          ),
        };
      if (change === "close") {
        fireEvent.click(toggle());
        fireEvent.click(toggle());
      }
      if (change === "unmount") view.unmount();
      await act(async () => finish(file));
      expect(createUrl).not.toHaveBeenCalled();
      if (["project", "source", "script"].includes(change)) {
        expect(onNotice).toHaveBeenLastCalledWith("作品内容已变化，请重新导出排查文件。");
      }
    });
  }
  it("reports a failed export without downloading", async () => {
    capture.setCaptureEnabled(true);
    vi.spyOn(capture, "captureFile").mockRejectedValue(new Error("storage failure"));
    open();
    download();
    await waitFor(() => expect(onNotice).toHaveBeenLastCalledWith("排查文件没有导出，请重试。"));
    expect(createUrl).not.toHaveBeenCalled();
  });
});

it("exposes the capture settings through the workspace account menu", async () => {
  delete window.aijian;
  delete window.aijianGrok;
  await saveFilm(sampleFilm());
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(screen.getByRole("button", { name: "账号" }));
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  expect(screen.getByRole("checkbox", { name: /保存导演和动作的原始回复/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: /保存导演和动作的原始回复/ }));
  expect(capture.captureEnabled()).toBe(true);
  expect(screen.getByRole("button", { name: "导出排查文件" })).toBeEnabled();
  expect(createUrl).not.toHaveBeenCalled();
});
