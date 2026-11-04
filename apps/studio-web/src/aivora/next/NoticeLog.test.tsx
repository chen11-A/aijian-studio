import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoticeLog } from "./NoticeLog";

const at = new Date("2026-11-04T12:03:09");

describe("NoticeLog", () => {
  it("draws nothing before the first message", () => {
    const { container } = render(<NoticeLog log={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays closed until asked, then lists the messages with their time and detail", () => {
    render(
      <NoticeLog
        log={[
          { id: 2, at, code: "STORYBOARD_READY", text: "分镜好了。", detail: "雨停：3 个镜头" },
          { id: 1, at, code: "OPERATION_STATUS", text: "已记下人物：林晚。", detail: "" },
        ]}
      />,
    );
    const toggle = screen.getByRole("button", { name: "最近的提示（2）" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("分镜好了。")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "收起最近的提示" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("分镜好了。");
    expect(items[0]).toHaveTextContent("雨停：3 个镜头");
    expect(items[1]).toHaveTextContent("已记下人物：林晚。");
    expect(items[0]?.querySelector("time")).toHaveAttribute("dateTime", at.toISOString());
  });
});
