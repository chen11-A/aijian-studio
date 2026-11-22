import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SkillMarkdownImport } from "./SkillMarkdownImport";

function open() {
  const onPreview = vi.fn(),
    onDraftChange = vi.fn();
  const view = render(
    <SkillMarkdownImport
      disabled={false}
      onPreview={onPreview}
      onDraftChange={onDraftChange}
      onClose={vi.fn()}
    />,
  );
  const choose = (files: File[]) =>
    fireEvent.change(screen.getByLabelText("选择本地 Markdown"), { target: { files } });
  return { ...view, onPreview, onDraftChange, choose };
}
it.each([
  [new File(["not Markdown"], "run.js")],
  [new File(["x".repeat(65537)], "large.md")],
  [new File(["a"], "one.md"), new File(["b"], "two.md")],
])("rejects invalid local selection before reading or previewing", (...files) => {
  const env = open();
  env.choose(files);
  expect(screen.getByRole("alert")).toHaveTextContent("请选择一个不超过 64 KB");
  expect(screen.queryByRole("textbox", { name: "Markdown 原文参考" })).toBeNull();
  expect(env.onPreview).not.toHaveBeenCalled();
});
it("cancel stays inert and a new selection clears guidance rather than adopting the file", async () => {
  const env = open();
  env.choose([]);
  expect(screen.queryByRole("alert")).toBeNull();
  env.choose([new File(["# 自写参考\n左侧留白。"], "SKILL.md")]);
  const source = (await screen.findByRole("textbox", {
    name: "Markdown 原文参考",
  })) as HTMLTextAreaElement;
  expect(screen.getByRole("button", { name: "采用选中文字" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "本镜构图指导" }), {
    target: { value: "  主体居左。  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "预览本镜构图指导" }));
  expect(env.onPreview).toHaveBeenCalledExactlyOnceWith("主体居左。");
  source.setSelectionRange(0, 3);
  fireEvent.select(source);
  fireEvent.click(screen.getByRole("button", { name: "采用选中文字" }));
  expect(screen.getByRole("textbox", { name: "本镜构图指导" })).toHaveValue("# 自");
  env.choose([new File(["新参考，不自动采用。"], "other.markdown")]);
  await screen.findByRole("textbox", { name: "Markdown 原文参考" });
  expect(screen.getByRole("textbox", { name: "本镜构图指导" })).toHaveValue("");
  expect(env.onDraftChange).toHaveBeenCalled();
});
it("does not silently truncate an overlong selected snippet", async () => {
  const env = open();
  env.choose([new File(["景".repeat(2001)], "long.md")]);
  const source = (await screen.findByRole("textbox", {
    name: "Markdown 原文参考",
  })) as HTMLTextAreaElement;
  source.setSelectionRange(0, 2001);
  fireEvent.select(source);
  fireEvent.click(screen.getByRole("button", { name: "采用选中文字" }));
  expect(screen.getByRole("alert")).toHaveTextContent("2000 字符");
  expect(screen.getByRole("textbox", { name: "本镜构图指导" })).toHaveValue("");
  expect(env.onPreview).not.toHaveBeenCalled();
});
