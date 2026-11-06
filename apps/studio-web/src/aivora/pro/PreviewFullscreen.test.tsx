import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PreviewFullscreen } from "./PreviewFullscreen";

let fullscreenElement: Element | null;
let requestFullscreen: ReturnType<typeof vi.fn>;
let exitFullscreen: ReturnType<typeof vi.fn>;
const originalRequest = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
const originalExit = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
const originalElement = Object.getOwnPropertyDescriptor(document, "fullscreenElement");

function changeFullscreen(element: Element | null) {
  fullscreenElement = element;
  document.dispatchEvent(new Event("fullscreenchange"));
}

beforeEach(() => {
  fullscreenElement = null;
  requestFullscreen = vi.fn(function (this: HTMLElement) {
    changeFullscreen(this);
    return Promise.resolve();
  });
  exitFullscreen = vi.fn(() => {
    changeFullscreen(null);
    return Promise.resolve();
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
});

afterEach(() => {
  cleanup();
  for (const [object, key, original] of [
    [HTMLElement.prototype, "requestFullscreen", originalRequest],
    [document, "exitFullscreen", originalExit],
    [document, "fullscreenElement", originalElement],
  ] as const) {
    if (original) Object.defineProperty(object, key, original);
    else Reflect.deleteProperty(object, key);
  }
});

function openPreview() {
  const onNotice = vi.fn();
  const ignoreShortcut = vi.fn((event: KeyboardEvent) =>
    event.target instanceof Element ? Boolean(event.target.closest("input, textarea")) : false,
  );
  const result = render(
    <PreviewFullscreen ignoreShortcut={ignoreShortcut} onNotice={onNotice}>
      <div className="screen">
        <video src="/preview.mp4" data-testid="video" />
      </div>
      <div className="ctrl">
        <button type="button">播放</button>
        <span>00:12</span>
      </div>
      <input aria-label="描述" />
    </PreviewFullscreen>,
  );
  return { ...result, onNotice, ignoreShortcut };
}

it("double-clicks the picture into fullscreen with the same video and controls", async () => {
  openPreview();
  const video = screen.getByTestId("video") as HTMLVideoElement;
  video.currentTime = 12;
  fireEvent.doubleClick(video);
  await screen.findByRole("button", { name: "退出全屏 (Esc)" });
  expect(requestFullscreen).toHaveBeenCalledTimes(1);
  expect(document.fullscreenElement).toBe(video.closest(".preview-player"));
  expect(screen.getByTestId("video")).toBe(video);
  expect(video.currentTime).toBe(12);
  expect(document.fullscreenElement).toContainElement(screen.getByRole("button", { name: "播放" }));
  expect(document.fullscreenElement).toHaveTextContent("00:12");
  fireEvent.doubleClick(screen.getByRole("button", { name: "播放" }));
  expect(exitFullscreen).not.toHaveBeenCalled();
});

it("toggles with F or the button and exits with Escape", async () => {
  openPreview();
  fireEvent.keyDown(window, { key: "f" });
  await screen.findByRole("button", { name: "退出全屏 (Esc)" });
  await act(async () => undefined);
  fireEvent.keyDown(window, { key: "F" });
  await screen.findByRole("button", { name: "全屏预览 (F)" });
  await act(async () => undefined);
  fireEvent.click(screen.getByRole("button", { name: "全屏预览 (F)" }));
  await screen.findByRole("button", { name: "退出全屏 (Esc)" });
  await act(async () => undefined);
  fireEvent.keyDown(window, { key: "Escape" });
  await screen.findByRole("button", { name: "全屏预览 (F)" });
  expect(requestFullscreen).toHaveBeenCalledTimes(2);
  expect(exitFullscreen).toHaveBeenCalledTimes(2);
});

it("keeps typing, modifier combinations, repeats and open dialogs out of the shortcut", () => {
  openPreview();
  fireEvent.keyDown(screen.getByLabelText("描述"), { key: "f" });
  for (const options of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { repeat: true },
  ]) {
    fireEvent.keyDown(window, { key: "f", ...options });
  }
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  fireEvent.keyDown(window, { key: "f" });
  dialog.setAttribute("role", "menu");
  fireEvent.keyDown(window, { key: "f" });
  dialog.remove();
  expect(requestFullscreen).not.toHaveBeenCalled();
});

it("follows the browser's own Escape exit instead of leaving a stale button", async () => {
  openPreview();
  fireEvent.click(screen.getByRole("button", { name: "全屏预览 (F)" }));
  await screen.findByRole("button", { name: "退出全屏 (Esc)" });
  act(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  expect(screen.getByRole("button", { name: "全屏预览 (F)" })).toBeInTheDocument();
});

it("reports a denied fullscreen request and still allows a later retry", async () => {
  const { onNotice } = openPreview();
  requestFullscreen.mockRejectedValueOnce(new Error("not allowed"));
  fireEvent.click(screen.getByRole("button", { name: "全屏预览 (F)" }));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("暂时不能全屏预览，请再试一次。"));
  expect(screen.getByRole("button", { name: "全屏预览 (F)" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "全屏预览 (F)" }));
  await screen.findByRole("button", { name: "退出全屏 (Esc)" });
});

it("exits its own fullscreen and releases the shortcut when the preview unmounts", async () => {
  const { unmount } = openPreview();
  fireEvent.keyDown(window, { key: "f" });
  await screen.findByRole("button", { name: "退出全屏 (Esc)" });
  unmount();
  expect(exitFullscreen).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: "f" });
  expect(requestFullscreen).toHaveBeenCalledTimes(1);
});
