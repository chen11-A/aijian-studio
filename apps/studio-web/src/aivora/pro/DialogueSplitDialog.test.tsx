import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { DialogueSplitDialog, type DialogueSplitReviewView } from "./DialogueSplitDialog";
afterEach(cleanup);
const text = "完整句 <script>不是脚本</script>。\n".repeat(30);
const review: DialogueSplitReviewView = {
  sourceLines: [{ speaker: "甲", text }],
  parts: [
    { speaker: "甲", text, estimatedSeconds: 10 },
    { speaker: "乙", text: "另一完整句。", estimatedSeconds: 8 },
  ],
  versions: 3,
  videoCount: 6,
  modelCapSeconds: 15,
  notes: ["旧音轨引用保留原绑定，尚未重新排时。", "本机历史不在工程包里。"],
  limitations: ["文字估算不等于实际语音时长。"],
};
function setup(extra: Partial<Parameters<typeof DialogueSplitDialog>[0]> = {}) {
  const apply = vi.fn(),
    close = vi.fn(),
    refresh = vi.fn();
  function Harness() {
    const [accepted, setAccepted] = useState(false);
    return (
      <DialogueSplitDialog
        review={review}
        busy={false}
        applying={false}
        stale={false}
        accepted={accepted}
        message=""
        onAccepted={setAccepted}
        onApply={apply}
        onRefresh={refresh}
        onClose={close}
        {...extra}
      />
    );
  }
  const view = render(<Harness />);
  return { ...view, apply, close, refresh };
}
it("shows every full line/note and requires explicit structure acceptance without dispatching on review or close", () => {
  const f = setup(),
    dialog = screen.getByRole("dialog", { name: "按完整句拆镜" });
  expect(within(dialog).getByRole("region", { name: "原镜完整台词" })).toHaveTextContent(
    "不是脚本",
  );
  expect(dialog.querySelector("script")).toBeNull();
  expect(dialog).toHaveTextContent("预计新增 6 个视频");
  expect(dialog).toHaveTextContent("旧音轨引用保留原绑定");
  const submit = within(dialog).getByRole("button", { name: "接受这份拆镜结构" });
  expect(submit).toBeDisabled();
  fireEvent.click(submit);
  expect(f.apply).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(submit);
  expect(f.apply).toHaveBeenCalledOnce();
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.apply).toHaveBeenCalledOnce();
});
it.each([{ busy: true }, { applying: true }, { stale: true }])(
  "locks confirmation for unavailable lifecycle %j",
  (extra) => {
    const f = setup(extra);
    const c = screen.getByRole("checkbox");
    expect(c).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "接受这份拆镜结构" }));
    expect(f.apply).not.toHaveBeenCalled();
    if (extra.applying) expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
  },
);
it("separates trusted measured target limit from the still-estimated split durations and budget", () => {
  setup({
    review: {
      ...review,
      actualLimit: {
        requiredSeconds: 19.25,
        maxSeconds: 15,
        rawAudioSaved: true,
        targetVideoSubmitted: false,
      },
    },
  });
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("实际配音需要 19.25 秒");
  expect(dialog).toHaveTextContent("本次目标尚未提交视频");
  expect(dialog).toHaveTextContent("每段时长是文字估算");
  expect(dialog).toHaveTextContent("不含配音、图片或失败重试");
});
