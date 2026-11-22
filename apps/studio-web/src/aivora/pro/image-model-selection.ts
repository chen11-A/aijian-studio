import { getModelCenterSnapshot } from "../account/model-center";
import type { FilmImageModelSelection } from "@aijian/contracts/film-generation-execution";

/** Capture at the existing consent/run boundary, not when an image slot starts. */
export function snapshotImageSelection(): FilmImageModelSelection | undefined {
  const choice = getModelCenterSnapshot().choices.IMAGE;
  if (!choice) return undefined;
  return {
    provider: choice.provider,
    modelId: choice.modelId,
    ...(choice.provider === "CONNECTION" ? { connectionId: choice.connectionId } : {}),
  };
}
