import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UiNotice } from "../../film/contracts3j";
import { normalizeNotice, NOTICE_TEXT } from "../../film/notices";
import { NOTICE_COPY } from "./noticeCopy";
import { NOTICE_FADE_MS, NOTICE_LOG_SIZE, NOTICE_SHOW_MS, useStatusNotice } from "./statusNotice";

// Stands in for ProWorkspace: setNotice announces the message, then keeps the sentence.
let say: (value: string | UiNotice) => void = () => {};
let chatReply: (text: string) => void = () => {};

function Bar() {
  const [shown, setShown] = useState("");
  say = (value) => {
    const structured = normalizeNotice(value);
    window.dispatchEvent(new CustomEvent("aivora-notice", { detail: structured }));
    setShown(
      typeof value === "string"
        ? value
        : [structured.text, structured.detail].filter(Boolean).join(" "),
    );
  };
  chatReply = (text) =>
    window.dispatchEvent(new CustomEvent("aivora-notice", { detail: normalizeNotice(text) }));
  const status = useStatusNotice(shown);
  return (
    <div>
      <p data-testid="line" className={status.fading ? "fading" : ""} title={status.line?.detail}>
        {status.line?.text ?? ""}
      </p>
      <ol>
        {status.log.map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ol>
    </div>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const line = () => screen.getByTestId("line");

describe("useStatusNotice", () => {
  it("shows a coded message in its own words, then fades it after five seconds", () => {
    render(<Bar />);
    act(() =>
      say({ code: "STORYBOARD_READY", text: NOTICE_TEXT.STORYBOARD_READY, detail: "第 1 场：16" }),
    );
    expect(line()).toHaveTextContent(NOTICE_COPY.STORYBOARD_READY!);
    expect(line()).toHaveAttribute("title", "第 1 场：16");
    act(() => vi.advanceTimersByTime(NOTICE_SHOW_MS - NOTICE_FADE_MS));
    expect(line()).toHaveClass("fading");
    act(() => vi.advanceTimersByTime(NOTICE_FADE_MS));
    expect(line()).toBeEmptyDOMElement();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps a plain sentence as it is", () => {
    render(<Bar />);
    act(() => say("已记下人物：林晚、沈砚。"));
    expect(line()).toHaveTextContent("已记下人物：林晚、沈砚。");
  });

  it("does not put chat replies in the status bar or let them hold an old message", () => {
    render(<Bar />);
    act(() => say("已放入剧本。"));
    act(() => vi.advanceTimersByTime(3000));
    act(() => chatReply("导演拆好了。点「写入分镜」才会写入。"));
    expect(line()).toHaveTextContent("已放入剧本。");
    act(() => vi.advanceTimersByTime(2000));
    expect(line()).toBeEmptyDOMElement();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("starts the five seconds again when the same message comes twice", () => {
    render(<Bar />);
    act(() => say("已取消。"));
    act(() => vi.advanceTimersByTime(4000));
    act(() => say("已取消。"));
    act(() => vi.advanceTimersByTime(4000));
    expect(line()).toHaveTextContent(NOTICE_COPY.OPERATION_CANCELLED!);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("drops the line at once when the workspace clears it", () => {
    render(<Bar />);
    act(() => say("正在写…"));
    act(() => say(""));
    expect(line()).toBeEmptyDOMElement();
  });

  it("keeps only the latest messages in the log, newest first", () => {
    render(<Bar />);
    for (let index = 0; index < NOTICE_LOG_SIZE + 5; index += 1) act(() => say(`第 ${index} 条`));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(NOTICE_LOG_SIZE);
    expect(items[0]).toHaveTextContent(`第 ${NOTICE_LOG_SIZE + 4} 条`);
  });
});
