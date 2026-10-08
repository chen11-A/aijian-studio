import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { V2ImageViewer, clampViewerPan, fitImageScale, imageArtworkSize } from "./V2ImageViewer";
import { EditorDialog } from "./Common";
import { DemoProvider, useDemo, createAivoraSampleFixture } from "./model";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
});

function loadImage(width: number, height: number) {
  const image = screen.getByTestId("v2-viewer-source");
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  fireEvent.load(image);
}

describe("V2 image viewing", () => {
  it("contains actual landscape, portrait and nonstandard source ratios", () => {
    const slot = { width: 1464, height: 674 };
    expect(fitImageScale({ width: 704, height: 396 }, slot)).toBeCloseTo(674 / 396);
    expect(fitImageScale({ width: 512, height: 752 }, slot)).toBeCloseTo(674 / 752);
    expect(fitImageScale({ width: 3000, height: 600 }, slot)).toBeCloseTo(1464 / 3000);
  });

  it("shows full artwork at fit, uses source pixels for 100%, and resets after zoom", () => {
    render(<V2ImageViewer title="故事参考图" src="/story-art.png" onClose={vi.fn()} />);
    loadImage(704, 396);
    expect(screen.getByText("704 × 396 px / 适应 170.2%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect(screen.getByTestId("v2-viewer-artwork")).toHaveStyle({
      width: "704px",
      height: "396px",
    });
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(screen.getByTestId("v2-viewer-artwork")).toHaveStyle({
      width: "880px",
      height: "495px",
    });
    fireEvent.click(screen.getByRole("button", { name: "适应窗口" }));
    expect(screen.getByText("704 × 396 px / 适应 170.2%")).toBeInTheDocument();
  });

  it("bounds pan to the artwork edges and centers axes smaller than the slot", () => {
    expect(
      clampViewerPan(
        { x: 1000, y: -1000 },
        { width: 1000, height: 400 },
        { width: 600, height: 500 },
        1,
      ),
    ).toEqual({ x: 200, y: 0 });
    expect(
      clampViewerPan(
        { x: -1000, y: 1000 },
        { width: 1000, height: 800 },
        { width: 600, height: 500 },
        2,
      ),
    ).toEqual({ x: -700, y: 550 });
  });

  it("resets to fit when switching gallery images without altering the caller", () => {
    render(
      <V2ImageViewer
        title="参考图"
        src="/story-art.png"
        images={[
          { src: "/story-art.png", title: "故事" },
          { src: "/portrait.png", title: "角色" },
        ]}
        onClose={vi.fn()}
      />,
    );
    loadImage(704, 396);
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    loadImage(512, 752);
    expect(screen.getByText("512 × 752 px / 适应 89.6%")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "大屏预览 · 角色" })).toBeInTheDocument();
  });

  it("measures legacy artwork crops in real source pixels instead of UI screenshot pixels", () => {
    const crop = { x: 400, y: 276, width: 624, height: 351, sourceWidth: 1536 };
    expect(imageArtworkSize({ width: 3072, height: 1728 }, crop)).toEqual({
      width: 1248,
      height: 702,
    });
    render(<V2ImageViewer title="世界" src="/legacy.png" crop={crop} onClose={vi.fn()} />);
    loadImage(3072, 1728);
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect(screen.getByTestId("v2-viewer-artwork")).toHaveStyle({
      width: "1248px",
      height: "702px",
    });
    expect(screen.getByTestId("v2-viewer-source")).toHaveStyle({ left: "-800px", top: "-552px" });
  });

  it("closes on Escape and restores focus to the opening control on unmount", () => {
    const close = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(<V2ImageViewer title="参考图" src="/story-art.png" onClose={close} />);
    expect(screen.getByRole("button", { name: "关闭查看器" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("reports image failure and keeps the viewer closable", () => {
    render(<V2ImageViewer title="缺失素材" src="/missing.png" onClose={vi.fn()} />);
    fireEvent.error(screen.getByTestId("v2-viewer-source"));
    expect(screen.getByRole("alert")).toHaveTextContent("图片加载失败");
    expect(screen.getByRole("button", { name: "100%" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭查看器" })).toBeEnabled();
  });

  it("routes image previews to the viewer while retaining editable drawers", () => {
    function Harness() {
      const demo = useDemo();
      return (
        <>
          <button onClick={() => demo.setEditor({ title: "预览", image: "/story-art.png" })}>
            打开预览
          </button>
          <button
            onClick={() =>
              demo.setEditor({
                title: "详细设定",
                presentation: "drawer",
                image: "/story-art.png",
                fields: [{ key: "note", label: "设定", value: "已有草稿" }],
                save: vi.fn(),
              })
            }
          >
            打开编辑
          </button>
          <EditorDialog />
        </>
      );
    }
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <Harness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开预览" }));
    expect(screen.getByRole("dialog")).toHaveClass("v2-image-viewer");
    fireEvent.click(screen.getByRole("button", { name: "关闭查看器" }));
    fireEvent.click(screen.getByRole("button", { name: "打开编辑" }));
    expect(screen.getByRole("dialog")).toHaveClass("detail-drawer");
    expect(screen.getByLabelText("设定")).toHaveValue("已有草稿");
    expect(screen.getByRole("button", { name: "确认" })).toBeInTheDocument();
  });
});
