import { useEffect, useRef } from "react";
import { useOfficialConnection } from "../chatgpt-auth/ChatGPTConnectionContext";
import { useModelCenter } from "./CurrentModelLink";

/**
 * Keeps ChatGPT generation on the model chosen in the center.
 * A transition back to "no ChatGPT text model" clears that channel's saved choice.
 * It does not clear a choice the user never made in this mounted screen.
 */
export function useFollowCenteredChatModel({
  models,
  setModel,
  onClear,
}: {
  models: readonly { slug: string }[];
  setModel: (slug: string) => void;
  onClear: () => void;
}) {
  const account = useOfficialConnection();
  const choice = useModelCenter().choices.TEXT ?? null;
  const previous = useRef<string | null>(null);
  const applied = useRef<string | null>(null);
  const slugKey = models.map((model) => model.slug).join("\n");
  useEffect(() => {
    if (account?.requiresReselection) return;
    const next = choice?.provider === "CHATGPT_OFFICIAL" ? choice.modelId : null;
    const prev = previous.current;
    if (prev === next && (next === null || applied.current === next)) return;
    previous.current = next;
    if (next === null) {
      applied.current = null;
      if (prev !== null) onClear();
      return;
    }
    if (!slugKey.split("\n").filter(Boolean).includes(next)) return;
    applied.current = next;
    setModel(next);
  }, [account?.requiresReselection, choice, slugKey, setModel, onClear]);
}
