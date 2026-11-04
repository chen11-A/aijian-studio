import { describe, expect, it, vi } from "vitest";
import { openWuchengSample } from "./sample-project";

function host(workspaceState: string, kind = "SUCCEEDED") {
  return {
    workspaceState,
    notify: vi.fn(),
    createRealProject: vi.fn(async () => ({ kind })),
    put: vi.fn(),
    setFilmStep: vi.fn(),
    go: vi.fn(),
  };
}

describe("雾城来信", () => {
  it("asks for a workspace before creating the example", async () => {
    const d = host("missing");
    await openWuchengSample(d);
    expect(d.notify).toHaveBeenCalledWith("请先连接本地工作区，再打开示例「雾城来信」。");
    expect(d.createRealProject).not.toHaveBeenCalled();
  });

  it("opens the example after the workspace is connected", async () => {
    const d = host("connected");
    await openWuchengSample(d);
    expect(d.createRealProject).toHaveBeenCalledWith({
      name: "雾城来信",
      aspect_ratio: "16:9",
      target_duration_seconds: 60,
      source_language: "zh-CN",
    });
    expect(d.put).toHaveBeenCalledWith("input", "雾散之前，不要回头。");
    expect(d.setFilmStep).toHaveBeenCalledWith(0);
    expect(d.go).toHaveBeenCalledWith("story");
  });

  it("stops when the project is not created", async () => {
    const d = host("connected", "FAILED");
    await openWuchengSample(d);
    expect(d.go).not.toHaveBeenCalled();
  });
});
