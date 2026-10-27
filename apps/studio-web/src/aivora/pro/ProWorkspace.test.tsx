import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ProWorkspace } from "./ProWorkspace";

describe("professional workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
  });

  it("feeds a renamed character into that shot's picture prompt", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /角色/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.change(screen.getByLabelText("人物名字"), { target: { value: "阿宁" } });
    fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "阿宁，短发，灰外套" } });
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /分镜/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "单镜" }));
    const prompt = screen.getByTestId("keyframe-prompt");
    expect(prompt.textContent).toContain("阿宁，短发，灰外套");
    expect(prompt.textContent).toContain("起始画面");
    await waitFor(() => {
      expect(JSON.stringify(window.localStorage)).toContain("阿宁");
    });
  });

  it("writes a short drama, keeps cast choices, and reports shots still missing", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    fireEvent.click(screen.getByRole("button", { name: "编剧" }));
    fireEvent.click(screen.getByRole("button", { name: "让编剧写" }));
    expect(await screen.findByText(/离线编剧/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入剧本" }));
    expect(screen.getByText(/已放入剧本/)).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /角色/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "生成定妆照" }));
    expect(screen.getAllByText(/改图接口还没验证/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "选用" })[0]!);
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /分镜/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "加镜头" }));
    expect(screen.getByText(/已加一个镜头/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
    expect(screen.getByText(/审片还不能看图打分/)).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /剪辑/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /镜头 5/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "剪掉" }));
    expect(screen.getByText(/已剪掉这一段/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    expect(screen.getByTestId("export-summary").textContent).toContain("没生成");
  });

  it("keeps four stages, confirms a batch, and does not invent an export", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    const tabs = screen.getAllByRole("button").filter((item) => item.className.includes("tab"));
    expect(tabs).toHaveLength(4);
    expect(tabs.some((item) => item.textContent?.includes("生成"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "新建一集" }));
    expect(screen.getByText(/已新建第 2 集/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "撤销" })[0]!);
    expect(screen.getByRole("button", { name: "作品" }).textContent).toContain("第 1 集");
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /分镜/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
    expect(screen.getByTestId("batch-estimate").textContent).toContain("记在 Grok 会员额度里");
    fireEvent.click(screen.getByRole("button", { name: "先不生成" }));
    fireEvent.click(screen.getByRole("button", { name: "单镜" }));
    expect(screen.getByTestId("generation-estimate").textContent).toContain("将生成");
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /剪辑/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "分割" }));
    expect(screen.getByText("分割还没接上。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    expect(screen.getByText(/网页里不能写成片/)).toBeInTheDocument();
    expect(screen.queryByText(/D:\\/)).toBeNull();
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
