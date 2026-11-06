import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SuggestionFieldDiff, type SuggestionFieldRow } from "./SuggestionFieldDiff";

const rows: SuggestionFieldRow[] = [
  { key: "private-key", label: "中文画面说明", kind: "changed", before: "旧画面", after: "新画面" },
  { key: "added", label: "英文画面说明", kind: "added", before: null, after: "A quiet street." },
  { key: "removed", label: "备注", kind: "removed", before: "旧备注", after: null },
];
describe("SuggestionFieldDiff", () => {
  it("shows actual before and after values with Chinese field labels and change states", () => {
    render(<SuggestionFieldDiff rows={rows} />);
    const items = within(screen.getByRole("list", { name: "字段改动" })).getAllByRole("listitem");
    expect(items.map((item) => item.dataset.kind)).toEqual(["changed", "added", "removed"]);
    expect(items[0]).toHaveTextContent("中文画面说明修改原来旧画面建议新画面");
    expect(items[1]).toHaveTextContent("英文画面说明新增原来未设置建议A quiet street.");
    expect(items[2]).toHaveTextContent("备注删除原来旧备注建议未设置");
    expect(screen.queryByText("private-key")).toBeNull();
  });
  it("distinguishes an absent value from a present empty value", () => {
    render(
      <SuggestionFieldDiff
        rows={[{ key: "empty", label: "中文画面说明", kind: "added", before: null, after: "" }]}
      />,
    );
    expect(screen.getByText("未设置")).toBeInTheDocument();
    expect(screen.getByText("空", { exact: true })).toBeInTheDocument();
  });
  it("preserves long multiline text without truncating it or interpreting markup", () => {
    const text = `${"合成长文本".repeat(120)}\n<strong>这是文字</strong>`;
    render(
      <SuggestionFieldDiff
        rows={[
          { key: "long", label: "中文画面说明", kind: "changed", before: "旧说明", after: text },
        ]}
      />,
    );
    const values = document.querySelectorAll("dd");
    expect(values[1]?.textContent).toBe(text);
    expect(values[1]?.querySelector("strong")).toBeNull();
  });
  it("reports an empty fixed diff instead of making up a text comparison", () => {
    render(<SuggestionFieldDiff rows={[]} />);
    expect(screen.getByText("没有字段改动。")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
