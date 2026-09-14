import "@testing-library/jest-dom/vitest";
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CharacterPage } from "./CharacterPage";
import { EditorDialog } from "./Common";
import { DemoProvider, useDemo, createAivoraSampleFixture } from "./model";
import type { Outfit } from "./model";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function Harness() {
  const d = useDemo();
  return (
    <>
      <CharacterPage />
      <EditorDialog />
      <button onClick={() => d.setSelectedCharacter(2)}>切换到缺少视图的角色</button>
      <button onClick={() => d.setScenario("loading")}>进入参考加载状态</button>
      <button onClick={() => d.setScenario("error")}>进入参考失败状态</button>
      <button onClick={() => d.setScenario("normal")}>完成参考加载</button>
      <button
        onClick={() =>
          d.setOutfits((old) =>
            old.map((item) =>
              item.id === 100
                ? { ...item, version: item.version + 1, name: "审核时被更新的造型" }
                : item,
            ),
          )
        }
      >
        更新已打开审核中的造型
      </button>
      <button
        onClick={() =>
          d.setOutfits((old) => old.map((item) => ({ ...item, startShot: 77, endShot: 99 })))
        }
      >
        设置未绑定的旧范围候选值
      </button>
      <output aria-label="角色工作流状态">
        {JSON.stringify({
          outfits: d.outfits,
          selectedCharacter: d.selectedCharacter,
          locked: d.value("locked-1") === "true",
          tasks: d.tasks.length,
        })}
      </output>
    </>
  );
}
function open() {
  window.history.replaceState({}, "", "#character");
  render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <Harness />
    </DemoProvider>,
  );
}
function state() {
  return JSON.parse(screen.getByLabelText("角色工作流状态").textContent!) as {
    outfits: Outfit[];
    selectedCharacter: number;
    locked: boolean;
    tasks: number;
  };
}
function details() {
  fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.click(dialog.getByRole("button", { name: "造型" }));
  return dialog;
}

describe("V2 character confirmation and separate sample shot selection", () => {
  it("retains all four scene labels and allows appearance confirmation without a scene-to-shot mapping", () => {
    open();
    for (const scenes of ["08–09", "01–04", "05–07", "10–13"])
      expect(screen.getByText(`场次 ${scenes}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设置未绑定的旧范围候选值" }));
    fireEvent.click(screen.getByRole("button", { name: "确认角色造型" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/未建立场次与镜头的映射/)).toBeInTheDocument();
    expect(dialog.queryByText(/Shot 77/)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "确认本集全部造型并继续" }));
    expect(state()).toMatchObject({ selectedCharacter: 2, locked: true, tasks: 0 });
    expect(
      state()
        .outfits.filter((item) => item.characterId === 1)
        .every((item) => item.confirmed && !item.rangeBindingExplicit),
    ).toBe(true);
  });

  it("opens the review for missing views and disables confirmation inside the review", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "切换到缺少视图的角色" }));
    expect(screen.getByRole("button", { name: "确认角色造型" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "确认角色造型" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/请补齐同一角色/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "确认本集全部造型并继续" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(state().outfits.some((item) => item.confirmed)).toBe(false);
  });

  it("requires a fresh review after an outfit version changes while the review is open", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "确认角色造型" }));
    fireEvent.click(screen.getByRole("button", { name: "更新已打开审核中的造型" }));
    let dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "确认本集全部造型并继续" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(state().locked).toBe(false);
    fireEvent.click(dialog.getByRole("button", { name: "重新检查当前版本" }));
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/审核时被更新的造型/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "确认本集全部造型并继续" })).toBeEnabled();
  });

  it("keeps the inner confirm disabled during loading and requires a recheck after loading finishes", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "进入参考加载状态" }));
    fireEvent.click(screen.getByRole("button", { name: "确认角色造型" }));
    let dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "确认本集全部造型并继续" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "完成参考加载" }));
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "确认本集全部造型并继续" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: "重新检查当前版本" }));
    expect(dialog.getByRole("button", { name: "确认本集全部造型并继续" })).toBeEnabled();
  });

  it("does not set a shot range on rename and changes it only through explicit sample-shot selection", () => {
    open();
    fireEvent.click(details().getByRole("button", { name: "编辑当前造型" }));
    expect(screen.queryByLabelText("起始镜头编号")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("造型名称"), { target: { value: "雨夜外套" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(state().outfits.find((item) => item.id === 100)?.rangeBindingExplicit).toBe(false);
    fireEvent.click(details().getByRole("button", { name: "选择样例镜头范围" }));
    fireEvent.change(screen.getByLabelText("起始样例镜头"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("结束样例镜头"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(state().outfits.find((item) => item.id === 100)).toMatchObject({
      startShot: 2,
      endShot: 3,
      rangeBindingExplicit: true,
      confirmed: false,
    });
    expect(screen.getByText("场次 08–09")).toBeInTheDocument();
  });
  it("renders failed references without presenting them as usable, then restores only on retry", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "进入参考失败状态" }));
    expect(screen.getByRole("button", { name: "加载失败 · 重试" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "大屏查看苏晚侧面参考" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "重试" })[0]!);
    expect(screen.getByRole("button", { name: "大屏查看苏晚侧面参考" })).toBeInTheDocument();
  });

  it("confirms one explicitly selected outfit without locking the whole character and can retract it", () => {
    open();
    const drawer = details();
    fireEvent.click(drawer.getByRole("button", { name: "确认当前造型" }));
    const review = within(screen.getByRole("dialog"));
    fireEvent.click(review.getByRole("button", { name: "确认此造型" }));
    expect(state()).toMatchObject({ locked: false });
    expect(state().outfits.find((item) => item.id === 100)?.confirmed).toBe(true);
    const reopened = details();
    expect(reopened.getByRole("button", { name: "撤回造型确认" })).toBeInTheDocument();
    fireEvent.click(reopened.getByRole("button", { name: "撤回造型确认" }));
    expect(state().outfits.find((item) => item.id === 100)?.confirmed).toBe(false);
  });
});
