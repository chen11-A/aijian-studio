import { useState } from "react";
import { takePickerData } from "./adapters";
import { sampleProjectJson } from "./adapters/sampleProject";
import { TakePicker, type TakeOption } from "./TakePicker";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page: three made-up versions of 第 2 场第 17 个镜头. */
const STATES = [
  { id: "three", label: "3 个版本" },
  { id: "two", label: "2 个版本" },
  { id: "one", label: "1 个版本" },
  { id: "generating", label: "还在生成" },
  { id: "project", label: "按 project.json" },
];

const A: TakeOption = {
  id: "scene-2-shot-17-take-1",
  label: "A 版",
  verdict: "必须重做",
  notes: [
    { tone: "bad", text: "0.5 到 1.1 秒，铁棍从沈砚的肩膀穿了过去" },
    { tone: "ok", text: "没有黑屏，画面没停住" },
  ],
};

const B: TakeOption = {
  id: "scene-2-shot-17-take-2",
  label: "B 版",
  verdict: "可用",
  notes: [
    { tone: "ok", text: "砸空干净，木屑清楚，方向是从画右到画左" },
    { tone: "ok", text: "没有黑屏，画面没停住" },
  ],
};

const C: TakeOption = {
  id: "scene-2-shot-17-take-3",
  label: "C 版",
  verdict: "建议重做",
  notes: [
    { tone: "warn", text: "开头 0.4 秒黑屏，剪掉会少了挥棍的起势" },
    { tone: "ok", text: "人物和动作都对" },
  ],
};

const C_GENERATING: TakeOption = {
  id: C.id,
  label: "C 版",
  status: "generating",
  statusText: "正在生成 · 已等 48 秒",
};

function takesFor(state: string): TakeOption[] {
  if (state === "two") return [A, B];
  if (state === "one") return [B];
  if (state === "generating") return [A, B, C_GENERATING];
  return [A, B, C];
}

/** 第 2 场第 1 个镜头 of the example project.json, through takePickerData. Stills are not loaded. */
const FROM_PROJECT = takePickerData(sampleProjectJson(), "scene-2-shot-1", { mediaUrl: () => "" });

export function TakePickerStory({ state = "three" }: { state?: string }) {
  const [selected, setSelected] = useState<string | null>();
  const [log, setLog] = useState<string>();
  if (state === "project" && FROM_PROJECT.ok) {
    return (
      <StoryFrame story="take-picker" states={STATES} state={state} log={log}>
        <TakePicker
          {...FROM_PROJECT.props}
          selectedId={selected === undefined ? FROM_PROJECT.props.selectedId : selected}
          onSelect={(id) => {
            setSelected(id);
            setLog(`用 ${id}`);
          }}
        />
      </StoryFrame>
    );
  }
  return (
    <StoryFrame story="take-picker" states={STATES} state={state} log={log}>
      <TakePicker
        shotLabel="第 2 场第 17 个镜头 · 中景 · 3 秒"
        shotCode="scene-2-shot-17"
        description="画右的周烈猛地挥棍砸向画左，沈砚侧身一让，铁棍擦着耳边落下，砸在木箱上，木屑四溅。"
        takes={takesFor(state)}
        aiChoiceId={B.id}
        selectedId={selected}
        onSelect={(id) => {
          setSelected(id);
          setLog(`用 ${id}`);
        }}
      />
    </StoryFrame>
  );
}
