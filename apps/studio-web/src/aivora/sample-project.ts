/** Opens the bundled example, or the new-project dialog, without creating until asked. */

import { isProjectAspectRatio } from "@aijian/contracts/project-aspect";
import type { PageId } from "./data";
import type { Field } from "./model";

type SampleHost = {
  workspaceState: string;
  notify: (message: string) => void;
  createRealProject: (input: {
    name: string;
    aspect_ratio: "16:9" | "9:16";
    target_duration_seconds: number;
    source_language: "zh-CN";
  }) => Promise<{ kind: string }>;
  put: (key: string, value: string) => void;
  setFilmStep: (step: number) => void;
  go: (page: PageId) => void;
  value?: (key: string, fallback?: string) => string;
  edit?: (
    title: string,
    fields: Field[],
    onSave?: (data: Record<string, string>) => void | false | Promise<void | false>,
  ) => void;
};

export async function openWuchengSample(d: SampleHost): Promise<void> {
  if (d.workspaceState !== "connected") {
    d.notify("请先连接本地工作区，再打开示例「雾城来信」。");
    return;
  }
  const outcome = await d.createRealProject({
    name: "雾城来信",
    aspect_ratio: "16:9",
    target_duration_seconds: 60,
    source_language: "zh-CN",
  });
  if (outcome.kind !== "SUCCEEDED") return;
  d.put("input", "雾散之前，不要回头。");
  d.setFilmStep(0);
  d.go("story");
}

export function promptNewProject(d: SampleHost) {
  if (!d.edit) {
    d.go("home");
    return;
  }
  d.edit(
    "新建项目",
    [
      { key: "title", label: "作品名称", value: "", required: true },
      { key: "aspect_ratio", label: "项目画幅", value: "16:9", options: ["16:9", "9:16"] },
      { key: "input", label: "故事灵感", type: "textarea", value: d.value?.("input") ?? "" },
    ],
    async (data) => {
      if (d.workspaceState !== "connected") {
        d.notify("请先连接本地工作区，再创建真实项目。");
        return false;
      }
      const title = data.title?.trim() ?? "";
      if (!title) return false;
      if (!isProjectAspectRatio(data.aspect_ratio)) {
        d.notify("请选择 16:9 或 9:16 项目画幅，再创建项目。");
        return false;
      }
      const outcome = await d.createRealProject({
        name: title,
        aspect_ratio: data.aspect_ratio,
        target_duration_seconds: 60,
        source_language: "zh-CN",
      });
      if (outcome.kind === "SUCCEEDED") {
        const inspiration = data.input?.trim() ?? "";
        d.put("input", inspiration);
        d.put("c3DraftIntent", inspiration ? "original" : "");
        d.go("source");
      }
      return outcome.kind === "SUCCEEDED" ? undefined : false;
    },
  );
}
