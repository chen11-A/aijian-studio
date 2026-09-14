import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Button, FlowFooter, Info, Pill, Section, StateView, Tabs } from "./Common";
import { createAivoraSampleFixture, DemoProvider, useDemo } from "./model";

function StateHarness() {
  const demo = useDemo();
  return (
    <>
      <button onClick={() => demo.setScenario("loading")}>加载</button>
      <button onClick={() => demo.setScenario("error")}>失败</button>
      <StateView />
      <FlowFooter />
      <output aria-label="common-page">{demo.page}</output>
    </>
  );
}

describe("C19 common interaction contracts", () => {
  it("renders common atoms and reports tab selection to its caller", () => {
    const change = vi.fn();
    render(
      <>
        <Button primary icon="check">
          保存
        </Button>
        <Pill tone="ok">就绪</Pill>
        <Section title="摘要" action={<button>操作</button>}>
          <Info title="说明">本地内容</Info>
        </Section>
        <Tabs items={["甲", "乙"]} value="甲" onChange={change} />
      </>,
    );
    expect(screen.getByRole("button", { name: "保存" })).toHaveClass("primary");
    expect(screen.getByText("就绪")).toHaveClass("ok");
    expect(screen.getByRole("heading", { name: "摘要" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "乙" }));
    expect(change).toHaveBeenCalledWith("乙");
  });

  it("renders loading and error state recovery without leaving the current page", () => {
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <StateHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "加载" }));
    expect(document.querySelector(".state-view")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button", { name: "查看正常示例" }));
    expect(document.querySelector(".state-view")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "失败" }));
    fireEvent.click(screen.getByRole("button", { name: "重试演示" }));
    expect(screen.getByLabelText("common-page")).toHaveTextContent("project");
  });

  it("uses the flow footer default next and previous navigation actions", () => {
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <StateHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /下一步/ }));
    expect(screen.getByLabelText("common-page")).toHaveTextContent("source");
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByLabelText("common-page")).toHaveTextContent("project");
  });
});
