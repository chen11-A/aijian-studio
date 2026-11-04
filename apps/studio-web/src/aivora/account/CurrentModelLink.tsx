import { useSyncExternalStore } from "react";
import { getModelCenterSnapshot, subscribeModelCenter } from "./model-center";
import { openAivoraPage } from "./navigation";
import type { Capability } from "../../domain/provider-settings-model";

const labels: Record<Capability, string> = {
  TEXT: "文本",
  IMAGE: "图像",
  VIDEO: "视频",
  SPEECH: "配音",
};

export function useModelCenter() {
  return useSyncExternalStore(subscribeModelCenter, getModelCenterSnapshot, getModelCenterSnapshot);
}

export function CurrentModelLink({ capability }: { capability: Capability }) {
  const choice = useModelCenter().choices[capability];
  const name = choice?.modelId ?? "未选择";
  return (
    <p className="current-model-link">
      <span>
        当前{labels[capability]}模型：<strong>{name}</strong>
      </span>
      <button type="button" className="button" onClick={() => openAivoraPage("services")}>
        在模型中心更改
      </button>
    </p>
  );
}
