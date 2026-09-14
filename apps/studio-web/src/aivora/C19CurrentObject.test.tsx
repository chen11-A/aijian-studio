import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { useCurrentObject } from "./useCurrentObject";
import { createAivoraSampleFixture, DemoProvider, useDemo } from "./model";

function Harness() {
  const demo = useDemo();
  const current = useCurrentObject();
  return (
    <>
      <button
        onClick={() => {
          demo.go("storyboard");
          demo.setTime(10);
        }}
      >
        分镜镜头
      </button>
      <button
        onClick={() => {
          demo.go("character");
          demo.setSelectedCharacter(2);
          demo.put("episode", "第 2 集 · 回声");
        }}
      >
        角色服装
      </button>
      <button onClick={() => current.putField("outfit", "回声礼服")}>更新服装</button>
      <button onClick={() => demo.go("story")}>故事来源</button>
      <button onClick={() => current.putField("source", "新的故事来源")}>更新来源</button>
      <button onClick={() => demo.go("world")}>世界草稿</button>
      <button onClick={() => current.putField("description", "本地世界草稿")}>写入世界草稿</button>
      <output aria-label="current-object">
        {JSON.stringify({
          family: current.family,
          scope: current.scope,
          label: current.label,
          detail: current.detail,
          field: current.field("description"),
          outfit: current.field("outfit"),
          sourceVersion: demo.value("sourceVersion"),
          sourceApproved: demo.value("sourceApproved"),
          assetsConfirmed: demo.value("assetsConfirmed"),
        })}
      </output>
    </>
  );
}

function current() {
  return JSON.parse(screen.getByLabelText("current-object").textContent ?? "{}") as Record<
    string,
    string
  >;
}

describe("C19 current object scope", () => {
  it("uses the timeline-selected shot as the storyboard context", () => {
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <Harness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "分镜镜头" }));
    expect(current()).toMatchObject({
      family: "shot",
      scope: "shot-1",
      label: "Shot 001 · 城市入夜",
    });
  });

  it("switches the current-object context when the selected character and episode change", () => {
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <Harness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "角色服装" }));
    expect(current()).toMatchObject({ family: "character", scope: "character-2", label: "程野" });
  });

  it("invalidates character assets when the selected episode has no matching outfit record", () => {
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <Harness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "角色服装" }));
    fireEvent.click(screen.getByRole("button", { name: "更新服装" }));
    expect(current()).toMatchObject({ assetsConfirmed: "false" });
  });

  it("increments the local source version and clears approval when its story source changes", () => {
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <Harness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "故事来源" }));
    fireEvent.click(screen.getByRole("button", { name: "更新来源" }));
    expect(current()).toMatchObject({ sourceVersion: "2", sourceApproved: "false" });
  });

  it("aliases a world description into the current world draft", () => {
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <Harness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "世界草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "写入世界草稿" }));
    expect(current()).toMatchObject({ family: "world", field: "本地世界草稿" });
  });
});
