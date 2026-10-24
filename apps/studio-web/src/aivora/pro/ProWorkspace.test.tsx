import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FILM_KEY } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";

describe("professional workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("feeds a renamed character into that shot's picture prompt", () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    fireEvent.click(screen.getAllByRole("button", { name: /角色/ }).find((item) => item.className.includes("tab"))!);
    fireEvent.change(screen.getByLabelText("人物名字"), { target: { value: "阿宁" } });
    fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "阿宁，短发，灰外套" } });
    fireEvent.click(screen.getAllByRole("button", { name: /生成/ }).find((item) => item.className.includes("tab"))!);
    const prompt = screen.getByTestId("keyframe-prompt");
    expect(prompt.textContent).toContain("阿宁，短发，灰外套");
    expect(prompt.textContent).toContain("起始画面");
    const saved = window.localStorage.getItem(FILM_KEY) ?? "";
    expect(saved).toContain("阿宁");
  });

  it("uses the offline director until the user confirms", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/离线拆镜/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
    expect(screen.getByText(/已放入分镜/)).toBeInTheDocument();
  });
});
