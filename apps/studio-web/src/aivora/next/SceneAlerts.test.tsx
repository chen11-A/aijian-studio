import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BEAT_DRAG_TYPE, SceneAlerts } from "./SceneAlerts";

describe("SceneAlerts", () => {
  it("draws nothing when the scene is covered and every action has a shot", () => {
    const { container } = render(<SceneAlerts missingTail={null} missingLines={[]} beats={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the missing end and asks the director to add it", () => {
    const fix = vi.fn();
    const { rerender } = render(
      <SceneAlerts
        missingTail="门外传来一声急刹车，雨幕被车灯劈开，有人喊她的名字。"
        missingLines={["你来晚了。"]}
        beats={[]}
        onFixEnding={fix}
      />,
    );
    const line = screen.getByText("这一场结尾还没拍到：「门外传来一声急刹车，雨幕被车灯劈开，…」");
    expect(line).toHaveAttribute(
      "title",
      "门外传来一声急刹车，雨幕被车灯劈开，有人喊她的名字。\n你来晚了。",
    );
    fireEvent.click(screen.getByRole("button", { name: "补上结尾" }));
    expect(fix).toHaveBeenCalledTimes(1);
    rerender(
      <SceneAlerts
        missingTail="门外传来一声急刹车"
        missingLines={[]}
        beats={[]}
        onFixEnding={fix}
        fixing
      />,
    );
    expect(screen.getByRole("button", { name: "正在补…" })).toBeDisabled();
  });

  it("counts the lines nobody speaks yet when the end itself is there", () => {
    render(<SceneAlerts missingTail={null} missingLines={["报警？", "走。"]} beats={[]} />);
    expect(screen.getByText("这一场还有 2 句台词没拍到：「报警？」")).toBeInTheDocument();
  });

  it("lists the actions without a shot, to drag onto a card or put on the picked shot", () => {
    const place = vi.fn();
    const { rerender } = render(
      <SceneAlerts
        missingTail={null}
        missingLines={[]}
        beats={["周烈挥铁棍砸向沈砚", "沈砚肘击反制"]}
        onPlaceBeat={place}
      />,
    );
    // 3JR-U04: open from the start, so there is something to drag.
    expect(screen.getByText("有 2 个动作没对上镜头")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "收起没对上镜头的动作" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "展开没对上镜头的动作" }));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "先选一个镜头" })[0]).toBeDisabled();
    const data = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(items[1]!, { dataTransfer: data });
    expect(data.setData).toHaveBeenCalledWith(
      BEAT_DRAG_TYPE,
      JSON.stringify({ index: 1, text: "沈砚肘击反制" }),
    );
    fireEvent.dragEnd(items[1]!);
    rerender(
      <SceneAlerts
        missingTail={null}
        missingLines={[]}
        beats={["周烈挥铁棍砸向沈砚", "沈砚肘击反制"]}
        onPlaceBeat={place}
        pickedShot="镜头 4"
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "放到镜头 4" })[0]!);
    expect(place).toHaveBeenCalledWith(0);
  });
});

it("keeps paragraph ownership warnings visible without inventing a missing ending or dialogue", () => {
  const warning = "有原文段落的场次归属需要核对。请按原文核对顺序。";
  const fix = vi.fn();
  const { rerender } = render(
    <SceneAlerts
      missingTail={null}
      missingLines={[]}
      beats={[]}
      coverageWarning={warning}
      onFixEnding={fix}
    />,
  );
  expect(screen.getByText(warning)).toHaveAttribute("title", warning);
  expect(screen.queryByText(/结尾还没拍到|句台词没拍到/)).toBeNull();
  expect(screen.queryByRole("button", { name: "补上结尾" })).toBeNull();
  rerender(<SceneAlerts missingTail={null} missingLines={[]} beats={[]} />);
  expect(screen.queryByText(warning)).toBeNull();
});
