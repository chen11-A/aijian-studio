import { chatGPTBridge, readChatGPTStatus } from "./transport";
import type { OfficialConnectionState } from "./ChatGPTConnectionContext";

/** Read-only freshness check immediately before a one-shot generation request. */
export async function verifySelectedModel(
  account: OfficialConnectionState,
  projectId: string,
  modelSlug: string,
): Promise<string | null> {
  const selected = account.resolve(projectId);
  const profileId = account.catalogProfileId;
  const bridge = chatGPTBridge();
  if (!selected.verified || selected.modelSlug !== modelSlug || !profileId || !bridge) return null;
  try {
    const before = await readChatGPTStatus(bridge);
    if (before.state !== "CONNECTED" || before.activeProfileId !== profileId) return null;
    const result = await bridge.models();
    if (
      result.kind !== "OK" ||
      result.profileId !== profileId ||
      !result.models.some((model) => model.slug === modelSlug)
    )
      return null;
    const after = await readChatGPTStatus(bridge);
    return after.state === "CONNECTED" && after.activeProfileId === profileId ? profileId : null;
  } catch {
    return null;
  }
}
