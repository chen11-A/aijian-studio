import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FilmTake } from "../../film/project";
import { TakePicker } from "../TakePicker";
import { SAMPLE_PROJECT, sampleProjectJson } from "./sampleProject";
import { takePickerData } from "./takePicker";

const still = (id: string) =>
  `aivora-media://local/?path=${encodeURIComponent(`/home/demo/.config/AIVORA/films/film_sample3jseries000001/stills/${id}.png`)}`;
const video = (id: string) =>
  `aivora-media://local/?path=${encodeURIComponent(`/home/demo/.config/AIVORA/films/film_sample3jseries000001/takes/${id}.mp4`)}`;

function ready(...args: Parameters<typeof takePickerData>) {
  const adapted = takePickerData(...args);
  if (!adapted.ok) throw new Error(adapted.empty.title);
  return adapted.props;
}

function withTakes(takes: Partial<FilmTake>[], selectedTakeId = ""): unknown {
  const project = JSON.parse(JSON.stringify(SAMPLE_PROJECT)) as typeof SAMPLE_PROJECT;
  const shot = project.shots[3]!;
  shot.takes = takes.map((take, index) => ({
    ...shot.takes[0]!,
    id: `t${index + 1}`,
    index: index + 1,
    ...take,
  }));
  shot.selectedTakeId = selectedTakeId;
  return project;
}

describe("takePickerData", () => {
  it("puts the versions of one shot side by side and marks the one the export uses", () => {
    expect(ready(sampleProjectJson(), "scene-2-shot-1")).toEqual({
      shotLabel: "第 2 场第 1 个镜头 · 中景 · 5 秒",
      shotCode: "scene-2-shot-1",
      description: "周烈挥棍砸向沈砚，沈砚侧身一让，铁棍砸在木箱上，木屑四溅。",
      takes: [
        { id: "s2-1-t1", label: "第 1 版", imageUrl: still("s2-1-t1"), videoUrl: video("s2-1-t1") },
        { id: "s2-1-t2", label: "第 2 版", imageUrl: still("s2-1-t2"), videoUrl: video("s2-1-t2") },
        {
          id: "s2-1-t3",
          label: "第 3 版",
          status: "failed",
          statusText: "Grok 没有接受这段描述，可能是「铁棍砸在木箱上」被当成了暴力内容。",
        },
      ],
      aiChoiceId: null,
      selectedId: "s2-1-t1",
      aspect: "9:16",
    });
  });

  it("keeps the version in use and the newest finished ones when there are more than three", () => {
    const value = withTakes(
      [
        { status: "done" },
        { status: "failed", videoPath: "" },
        { status: "done" },
        { status: "running", videoPath: "" },
        { status: "done" },
      ],
      "t1",
    );
    expect(ready(value, "scene-2-shot-1").takes.map((take) => take.id)).toEqual(["t1", "t3", "t5"]);
    const busy = withTakes([
      { status: "queued", videoPath: "", reason: "已暂停。点继续再生成剩下的。" },
      { status: "running", videoPath: "" },
      { status: "failed", videoPath: "", reason: "" },
      { status: "failed", videoPath: "", reason: "超时" },
    ]);
    expect(ready(busy, "scene-2-shot-1").takes).toEqual([
      expect.objectContaining({ id: "t1", status: "generating", statusText: "排队中" }),
      expect.objectContaining({ id: "t2", status: "generating", statusText: "正在生成" }),
      expect.objectContaining({ id: "t4", status: "failed", statusText: "超时" }),
    ]);
    const gaveUp = withTakes([{ status: "failed", videoPath: "", reason: "" }]);
    expect(ready(gaveUp, "scene-2-shot-1").takes[0]?.statusText).toBe("没有做成");
  });

  it("marks no version in use when the selected one failed, as the export does", () => {
    const data = ready(sampleProjectJson(), "scene-1-shot-3");
    expect(data.selectedId).toBeNull();
    expect(data.takes).toEqual([
      { id: "s1-3-t1", label: "第 1 版", status: "failed", statusText: "已中断，可以重试。" },
    ]);
  });

  it("uses the host's way of loading stills and leaves out what the shot does not have", () => {
    const value = JSON.parse(JSON.stringify(SAMPLE_PROJECT)) as Record<string, unknown>;
    delete value.aspectRatio;
    const shots = value.shots as Record<string, unknown>[];
    Object.assign(shots[0]!, { picture: "", action: "", seconds: "4", size: "" });
    const takes = shots[0]!.takes as Record<string, unknown>[];
    delete takes[0]!.index;
    const data = ready(value, "scene-1-shot-1", { mediaUrl: (path) => `file:${path.length}` });
    expect(data.shotLabel).toBe("第 1 场第 1 个镜头");
    expect(data.description).toBeUndefined();
    expect(data.aspect).toBeUndefined();
    expect(data.takes.map((take) => [take.label, take.imageUrl])).toEqual([
      ["第 1 版", "file:76"],
      ["第 2 版", "file:76"],
    ]);
    expect(ready(value, "scene-1-shot-2", { mediaUrl: () => "" }).takes[0]).toEqual({
      id: "s1-2-t1",
      label: "第 1 版",
    });
  });

  it("gives an empty state for a shot with no versions or no such shot", () => {
    expect(takePickerData(sampleProjectJson(), "scene-2-shot-3")).toMatchObject({
      ok: false,
      empty: { title: "这个镜头还没有版本" },
    });
    expect(takePickerData(sampleProjectJson(), "scene-3-shot-2")).toMatchObject({
      ok: false,
      empty: { title: "这个镜头还没有版本" },
    });
    expect(takePickerData(sampleProjectJson(), "nope")).toEqual({
      ok: false,
      empty: { title: "找不到这个镜头", detail: "作品里没有编号为 nope 的镜头。" },
      missing: [],
    });
    expect(takePickerData([], "nope")).toMatchObject({ ok: false });
  });

  it("gives TakePicker versions it can draw and pick", () => {
    const onSelect = vi.fn();
    render(
      <TakePicker
        {...ready(sampleProjectJson(), "scene-2-shot-1", { mediaUrl: () => "" })}
        onSelect={onSelect}
      />,
    );
    const first = screen.getByRole("listitem", { name: "第 1 版" });
    expect(within(first).getByText("正在用这一版")).toBeInTheDocument();
    expect(screen.queryByText("AI 选的，可换")).toBeNull();
    within(screen.getByRole("listitem", { name: "第 2 版" }))
      .getByRole("button", { name: "用第 2 版" })
      .click();
    expect(onSelect).toHaveBeenCalledWith("s2-1-t2");
  });
});
