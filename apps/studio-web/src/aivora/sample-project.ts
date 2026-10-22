/** Opens the bundled example without creating it until the user asks. */

import type { PageId } from "./data";

type SampleHost = {
  workspaceState: string;
  notify: (message: string) => void;
  createRealProject: (input: {
    name: string;
    aspect_ratio: "16:9";
    target_duration_seconds: number;
    source_language: "zh-CN";
  }) => Promise<{ kind: string }>;
  put: (key: string, value: string) => void;
  setFilmStep: (step: number) => void;
  go: (page: PageId) => void;
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
  d.go("project");
}
