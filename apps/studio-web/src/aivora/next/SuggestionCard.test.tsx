import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SuggestionItem } from "./adapters/suggestionDiff";
import { SuggestionCard } from "./SuggestionCard";

const shots = (prefix: string, texts: string[]): SuggestionItem[] =>
  texts.map((text, index) => ({ id: `${prefix}${index + 1}`, text, tail: "3s" }));

const NOW = shots("a", ["推门进来", "风铃特写", "抬头", "放信", "看字迹", "车灯扫过"]);
const NEXT = shots("b", ["推门进来", "抬头看她", "放信", "刹车声"]);

describe("SuggestionCard", () => {
  it("draws nothing when there is no suggestion, so no empty card shows", () => {
    const { container } = render(
      <SuggestionCard unit="shot" current={NOW} proposed={[]} onApply={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says what changes against what is there now, line by line", () => {
    render(<SuggestionCard unit="shot" current={NOW} proposed={NEXT} onApply={() => {}} />);
    expect(screen.getByText("现在 6 个 → 建议 4 个")).toBeInTheDocument();
    expect(screen.getByText("新增 1 · 改了 1 · 删掉 3")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.dataset.kind)).toEqual([
      "same",
      "removed",
      "changed",
      "same",
      "removed",
      "removed",
      "added",
    ]);
    expect(rows[1]?.querySelector("del")).toHaveTextContent("风铃特写");
    expect(rows[2]).toHaveTextContent("2抬头看她原来：抬头3s改了");
    expect(rows[3]).toHaveTextContent(/^3放信/);
    expect(rows[6]).toHaveTextContent("4刹车声3s新增");
  });

  it("has three plain choices and no filled primary button of its own", () => {
    const apply = vi.fn();
    const another = vi.fn();
    const reject = vi.fn();
    render(
      <SuggestionCard
        unit="shot"
        current={NOW}
        proposed={NEXT}
        onApply={apply}
        onAnother={another}
        onReject={reject}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
    fireEvent.click(screen.getByRole("button", { name: "换一个" }));
    fireEvent.click(screen.getByRole("button", { name: "不要" }));
    expect([apply, another, reject].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
    expect(document.querySelector(".nx-primary, .primary")).toBeNull();
  });

  it("names a first suggestion without a 现在 0 个 and scenes in 场", () => {
    const { rerender } = render(
      <SuggestionCard unit="shot" current={[]} proposed={NEXT} onApply={() => {}} />,
    );
    expect(screen.getByText("建议拆成 4 个镜头")).toBeInTheDocument();
    expect(screen.queryByText("新增")).toBeNull();
    rerender(
      <SuggestionCard
        unit="scene"
        current={shots("s", ["旧书店", "医院"])}
        proposed={shots("t", ["旧书店", "车里", "医院"])}
        onApply={() => {}}
      />,
    );
    expect(screen.getByText("现在 2 场 → 建议 3 场")).toBeInTheDocument();
    expect(screen.getByText("新增 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放进剧本" })).toBeInTheDocument();
  });

  it("offers 撤销 once it is put in, and waits while another one is being written", () => {
    const undo = vi.fn();
    const { rerender } = render(
      <SuggestionCard
        unit="shot"
        current={NOW}
        proposed={NEXT}
        busy
        onApply={() => {}}
        onAnother={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "放进分镜" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在换" })).toBeDisabled();
    rerender(
      <SuggestionCard
        unit="shot"
        current={NOW}
        proposed={NEXT}
        applied
        onApply={() => {}}
        onUndo={undo}
      />,
    );
    expect(screen.getByText("已放进去。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放进分镜" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

it("uses fixed field rows and field counts instead of the scene or shot comparison", () => {
  const apply = vi.fn();
  render(
    <SuggestionCard
      unit="shot"
      current={NOW}
      proposed={NEXT}
      fieldRows={[
        {
          key: "prompt-zh",
          label: "中文画面说明",
          kind: "changed",
          before: "请求时的旧说明",
          after: "建议的新说明",
        },
        {
          key: "prompt-en",
          label: "英文画面说明",
          kind: "added",
          before: null,
          after: "New description",
        },
      ]}
      onApply={apply}
    />,
  );
  expect(screen.getByText("建议变更 2 个字段")).toBeInTheDocument();
  expect(screen.queryByText("现在 6 个 → 建议 4 个")).toBeNull();
  expect(screen.queryByText("风铃特写")).toBeNull();
  expect(screen.getByText("请求时的旧说明")).toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
  expect(apply).toHaveBeenCalledTimes(1);
});

it("renders field-only suggestions even without a proposed shot list and respects busy/applied state", () => {
  const fields = [
    {
      key: "prompt-zh",
      label: "中文画面说明",
      kind: "changed" as const,
      before: "旧",
      after: "新",
    },
  ];
  const { rerender } = render(
    <SuggestionCard
      unit="shot"
      current={[]}
      proposed={[]}
      fieldRows={fields}
      busy
      onApply={vi.fn()}
    />,
  );
  expect(screen.getByText("建议变更 1 个字段")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认修改" })).toBeDisabled();
  rerender(
    <SuggestionCard
      unit="shot"
      current={[]}
      proposed={[]}
      fieldRows={fields}
      applied
      onApply={vi.fn()}
    />,
  );
  expect(screen.getByText("已应用这次字段修改。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
  expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
});

it("does not fall back to guessed shot changes when the host supplies an empty field diff", () => {
  render(
    <SuggestionCard unit="shot" current={NOW} proposed={NEXT} fieldRows={[]} onApply={vi.fn()} />,
  );
  expect(screen.getByText("建议变更 0 个字段")).toBeInTheDocument();
  expect(screen.getByText("没有字段改动。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认修改" })).toBeDisabled();
  expect(screen.queryByText("现在 6 个 → 建议 4 个")).toBeNull();
});

it("blocks rejection while field confirmation is saving and preserves legacy busy rejection", () => {
  const reject = vi.fn();
  const fields = [
    {
      key: "prompt-zh",
      label: "中文画面说明",
      kind: "changed" as const,
      before: "旧",
      after: "新",
    },
  ];
  const { rerender } = render(
    <SuggestionCard
      unit="shot"
      current={NOW}
      proposed={NEXT}
      fieldRows={fields}
      busy
      onApply={vi.fn()}
      onReject={reject}
    />,
  );
  expect(screen.getByRole("button", { name: "不要" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "不要" }));
  expect(reject).not.toHaveBeenCalled();
  rerender(
    <SuggestionCard
      unit="shot"
      current={NOW}
      proposed={NEXT}
      busy
      onApply={vi.fn()}
      onReject={reject}
    />,
  );
  expect(screen.getByRole("button", { name: "不要" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "不要" }));
  expect(reject).toHaveBeenCalledTimes(1);
});
