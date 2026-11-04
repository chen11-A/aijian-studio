import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CreativeWorkspaceExit, CreativeWorkspaceFrame } from "./CreativeWorkspaceFrame";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "./model";

function State() {
  const model = useDemo();
  return <output aria-label="workspace route">{model.page}</output>;
}
function open(page = "script") {
  window.history.replaceState({}, "", `#${page}`);
  const exit = vi.fn();
  const result = render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <CreativeWorkspaceExit.Provider value={exit}>
        <CreativeWorkspaceFrame
          outlineTitle="Synthetic outline"
          outline={<p>Outline content</p>}
          properties={<p>Inspector content</p>}
          status="Local test status"
          notice="No provider called"
          tools={<span>Editor toolbar</span>}
          actions={<button>Local action</button>}
        >
          <p>Document content</p>
        </CreativeWorkspaceFrame>
        <State />
      </CreativeWorkspaceExit.Provider>
    </DemoProvider>,
  );
  return { ...result, exit };
}
function pointer(element: HTMLElement, type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(element, event);
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("creative workspace shell preserves bounded layout and guarded routes", () => {
  test.each([
    ["调整导航宽度", 218, 176, 300, 1],
    ["调整属性宽度", 284, 236, 380, -1],
  ] as const)(
    "%s supports keyboard resize with strict bounds",
    (label, initial, min, max, direction) => {
      const { container } = open();
      const separator = screen.getByRole("separator", { name: label });
      expect(separator).toHaveAttribute("aria-valuenow", String(initial));
      fireEvent.keyDown(separator, { key: "Enter" });
      expect(separator).toHaveAttribute("aria-valuenow", String(initial));
      fireEvent.keyDown(separator, { key: "ArrowRight" });
      expect(separator).toHaveAttribute("aria-valuenow", String(initial + 12 * direction));
      for (let index = 0; index < 30; index++)
        fireEvent.keyDown(separator, { key: direction === 1 ? "ArrowRight" : "ArrowLeft" });
      expect(separator).toHaveAttribute("aria-valuenow", String(max));
      const shell = container.querySelector<HTMLElement>(".creative-workspace")!;
      expect(
        shell.style.getPropertyValue(direction === 1 ? "--cw-left-width" : "--cw-right-width"),
      ).toBe(`${max}px`);
      for (let index = 0; index < 30; index++)
        fireEvent.keyDown(separator, { key: direction === 1 ? "ArrowLeft" : "ArrowRight" });
      expect(separator).toHaveAttribute("aria-valuenow", String(min));
    },
  );

  test.each([
    ["调整导航宽度", 218, 1],
    ["调整属性宽度", 284, -1],
  ] as const)(
    "%s releases pointer capture and ignores late movement",
    (label, initial, direction) => {
      open();
      const separator = screen.getByRole("separator", { name: label });
      const set = vi.fn(),
        release = vi.fn();
      Object.defineProperties(separator, {
        setPointerCapture: { value: set },
        hasPointerCapture: { value: () => true },
        releasePointerCapture: { value: release },
      });
      pointer(separator, "pointermove", 125);
      expect(separator).toHaveAttribute("aria-valuenow", String(initial));
      pointer(separator, "pointerdown", 100);
      pointer(separator, "pointermove", 120);
      expect(separator).toHaveAttribute("aria-valuenow", String(initial + 20 * direction));
      expect(set).toHaveBeenCalledExactlyOnceWith(1);
      pointer(separator, "pointerup", 120);
      expect(release).toHaveBeenCalledExactlyOnceWith(1);
      pointer(separator, "pointermove", 170);
      expect(separator).toHaveAttribute("aria-valuenow", String(initial + 20 * direction));
      pointer(separator, "pointerdown", 100);
      pointer(separator, "lostpointercapture", 100);
      pointer(separator, "pointermove", 150);
      expect(separator).toHaveAttribute("aria-valuenow", String(initial + 20 * direction));
    },
  );

  test.each([
    ["返回作品概览", "project"],
    ["来源与灵感", "source"],
    ["素材", "assets"],
    ["作品概览", "project"],
    ["分镜", "storyboard"],
  ])("%s navigates through the shared model to %s", (button, route) => {
    open();
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(screen.getByLabelText("workspace route")).toHaveTextContent(route!);
  });
  test("document tabs expose current selection and return from storyboard to script", () => {
    open("storyboard");
    expect(screen.getByRole("button", { name: "分镜" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "分镜" }));
    expect(screen.getByLabelText("workspace route")).toHaveTextContent("storyboard");
    fireEvent.click(screen.getByRole("button", { name: "剧本" }));
    expect(screen.getByRole("button", { name: "剧本" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "剧本" }));
    expect(screen.getByLabelText("workspace route")).toHaveTextContent("script");
  });
  test("AI inspector keeps manual creation independent and restores properties", () => {
    open();
    expect(screen.getByText("Inspector content")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "AI 助手" }));
    expect(screen.getByText("Inspector content")).not.toBeVisible();
    expect(screen.getByText(/手工创作不需要 AI/)).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "属性" }));
    expect(screen.getByText("Inspector content")).toBeVisible();
    expect(screen.queryByText(/手工创作不需要 AI/)).toBeNull();
  });
  test("exit uses its parent callback and all document regions remain independently addressed", () => {
    const { exit } = open();
    fireEvent.click(screen.getByRole("button", { name: "返回原布局" }));
    expect(exit).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "跳到编辑正文" })).toHaveAttribute(
      "href",
      "#creative-document",
    );
    expect(screen.getByText("Document content").parentElement).toHaveAttribute(
      "id",
      "creative-document",
    );
    expect(screen.getByText("Outline content")).toBeVisible();
    expect(screen.getByText("Editor toolbar")).toBeVisible();
    expect(screen.getByText("No provider called")).toBeVisible();
  });
});
