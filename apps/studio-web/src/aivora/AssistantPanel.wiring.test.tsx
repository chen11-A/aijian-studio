import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "./AssistantPanel";
import { DemoProvider, useDemo } from "./model";
import type * as AssistantSelection from "./assistantSelection";

const wiring = vi.hoisted(() => ({ setIncluded: vi.fn() }));
vi.mock("./assistantSelection", async (load) => {
  const actual = await load<typeof AssistantSelection>();
  return {
    ...actual,
    useOptionalAssistantSelection: () => ({
      publication: {
        kind: "AVAILABLE",
        selection: { page: "world" },
      },
      included: false,
      setIncluded: wiring.setIncluded,
    }),
  };
});
vi.mock("./AssistantChatConversation", () => ({
  AssistantChatConversation: (props: {
    setIncluded: (included: boolean) => void;
    onOpenServices: () => void;
    onOpenEditor: () => void;
  }) => (
    <div>
      <button onClick={() => props.setIncluded(true)}>包括所选内容</button>
      <button onClick={props.onOpenServices}>服务入口</button>
      <button onClick={props.onOpenEditor}>编辑入口</button>
    </div>
  ),
}));
function CurrentPage() {
  const demo = useDemo();
  return <output aria-label="当前页面">{demo.page}</output>;
}
describe("assistant shell wiring", () => {
  it("passes selection actions to the conversation and routes to services and the selected editor", () => {
    render(
      <DemoProvider>
        <AssistantPanel />
        <CurrentPage />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "包括所选内容" }));
    expect(wiring.setIncluded).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "服务入口" }));
    expect(screen.getByLabelText("当前页面")).toHaveTextContent("services");
    fireEvent.click(screen.getByRole("button", { name: "编辑入口" }));
    expect(screen.getByLabelText("当前页面")).toHaveTextContent("world");
  });
});
