import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { EditorDialog } from "./Common";
import { VisualPages } from "./VisualPages";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "./model";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

function Harness() {
  const demo = useDemo();
  return (
    <>
      <button onClick={() => demo.setCharacters([])}>清空角色</button>
      <VisualPages />
      <EditorDialog />
      <output aria-label="visual-state">
        {JSON.stringify({
          selected: demo.selectedCharacter,
          page: demo.page,
          characters: demo.characters.map((item) => item.name),
          relation: demo.value("relation"),
        })}
      </output>
    </>
  );
}

function state() {
  return JSON.parse(screen.getByLabelText("visual-state").textContent ?? "{}") as {
    selected: number;
    page: string;
    characters: string[];
    relation: string;
  };
}

function open() {
  window.history.replaceState({}, "", "#characters");
  render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <Harness />
    </DemoProvider>,
  );
}

describe("visual characters page", () => {
  it("opens reference and relation editing through explicit local interactions", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: /大屏查看.*角色参考/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("角色参考");

    fireEvent.click(screen.getByRole("button", { name: /人物关系/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("修改人物关系");
    fireEvent.change(screen.getByLabelText("人物关系"), { target: { value: "合作伙伴" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(state().relation).toBe("合作伙伴");
  });

  it("does not render stale character facts once the active project has no characters", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "清空角色" }));
    expect(screen.getByRole("heading", { name: "角色与世界" })).toBeInTheDocument();
    expect(screen.getByText("尚未从已确认的故事资料读取角色信息。")).toBeInTheDocument();
    expect(screen.queryByText(/当前角色/)).not.toBeInTheDocument();
  });

  it("adds a local character only after the explicit editor confirmation", () => {
    open();

    fireEvent.click(screen.getByText("角色详情"));
    fireEvent.click(screen.getByRole("button", { name: "新增角色" }));
    fireEvent.change(screen.getByLabelText("角色名称"), { target: { value: "新角色" } });
    fireEvent.change(screen.getByLabelText("身份与作用"), { target: { value: "旁观者" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));

    expect(state()).toMatchObject({ characters: expect.arrayContaining(["新角色"]) });
    expect(state().page).toBe("character");
  });
});
