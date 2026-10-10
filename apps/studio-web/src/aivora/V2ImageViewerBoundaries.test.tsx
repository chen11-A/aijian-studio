import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { V2ImageViewer } from "./V2ImageViewer";

const dialogMethods = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype);
beforeEach(() => {
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
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const method of ["showModal", "close"] as const) {
    const original = dialogMethods[method];
    if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>)[method];
  }
});
function load(width = 2000, height = 2000) {
  const image = screen.getByTestId("v2-viewer-source");
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  fireEvent.load(image);
}
function pointer(element: HTMLElement, type: string, id: number, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: id });
  fireEvent(element, event);
}
describe("image viewer keeps viewing interactions bounded", () => {
  test("keyboard zoom and directional pan can return to exact fit", () => {
    render(<V2ImageViewer src="/synthetic.png" title="Synthetic" onClose={vi.fn()} />);
    load();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    const artwork = screen.getByTestId("v2-viewer-artwork");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(artwork.style.transform).toContain("40px");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    expect(artwork.style.transform).toContain("40px");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "=" });
    expect(artwork.style.width).toBe("2500px");
    fireEvent.keyDown(dialog, { key: "-" });
    expect(artwork.style.width).toBe("2000px");
    fireEvent.keyDown(dialog, { key: "0" });
    expect(screen.getByRole("button", { name: "适应窗口" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "缩小" }));
    expect(screen.getByRole("button", { name: "适应窗口" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  test("pointer capture isolates the active drag and ends on release or loss", () => {
    render(<V2ImageViewer src="/synthetic.png" title="Synthetic" onClose={vi.fn()} />);
    load();
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    const canvas = screen.getByLabelText("图片画布");
    const capture = vi.fn();
    const release = vi.fn();
    Object.assign(canvas, {
      setPointerCapture: capture,
      hasPointerCapture: () => true,
      releasePointerCapture: release,
    });
    pointer(canvas, "pointerdown", 1, 100, 100);
    expect(capture).toHaveBeenCalledWith(1);
    pointer(canvas, "pointermove", 2, 500, 500);
    expect(screen.getByTestId("v2-viewer-artwork").style.transform).not.toContain("400px");
    pointer(canvas, "pointermove", 1, 120, 130);
    expect(screen.getByTestId("v2-viewer-artwork").style.transform).toBe(
      "translate(calc(-50% + 20px), calc(-50% + 30px))",
    );
    pointer(canvas, "pointerup", 1, 120, 130);
    expect(release).toHaveBeenCalledWith(1);
    pointer(canvas, "pointerdown", 3, 100, 100);
    pointer(canvas, "lostpointercapture", 3, 100, 100);
    pointer(canvas, "pointermove", 3, 500, 500);
    expect(screen.getByTestId("v2-viewer-artwork").style.transform).toContain("20px");
  });
  test("zero-sized load fails, retry reloads, previous gallery wraps, and cancel closes", () => {
    const close = vi.fn();
    render(
      <V2ImageViewer
        src="/a.png"
        title="A"
        images={[
          { src: "/a.png", title: "A" },
          { src: "/b.png", title: "B" },
        ]}
        onClose={close}
      />,
    );
    load(0, 0);
    expect(screen.getByRole("alert")).toHaveTextContent("图片加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(screen.getByText("正在读取图片原始尺寸…")).toBeVisible();
    load();
    fireEvent.click(screen.getByRole("button", { name: "上一张" }));
    expect(screen.getByRole("heading", { name: "大屏预览 · B" })).toBeVisible();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
