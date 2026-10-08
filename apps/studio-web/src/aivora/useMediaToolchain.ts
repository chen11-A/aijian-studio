import { useEffect, useSyncExternalStore } from "react";
import { createStudioTransport } from "../api/studio";
import type { MediaToolchainGateway } from "./mediaToolchainContract";
import { createMediaToolchainStore, mediaToolchainMessage } from "./adapters/mediaToolchain";

const stores = new WeakMap<MediaToolchainGateway, ReturnType<typeof createMediaToolchainStore>>();
const unavailable = createMediaToolchainStore();
export function useMediaToolchain(provided?: MediaToolchainGateway) {
  const gateway = provided ?? createStudioTransport().mediaToolchain;
  let store = gateway ? stores.get(gateway) : unavailable;
  if (!store) {
    store = createMediaToolchainStore(gateway);
    stores.set(gateway!, store);
  }
  const current = store;
  const snapshot = useSyncExternalStore(
    current.subscribe,
    current.getSnapshot,
    current.getSnapshot,
  );
  useEffect(() => {
    void current.refresh();
    const refresh = () => {
      void current.refresh();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [current]);
  const verified =
    snapshot.phase === "READY" && !snapshot.busy && snapshot.status?.state === "AVAILABLE";
  return {
    ...snapshot,
    ...current,
    message: mediaToolchainMessage(snapshot),
    canProbe: verified && snapshot.status!.can_probe,
    canPreview: verified && snapshot.status!.can_preview,
    canDraftExport: verified && snapshot.status!.can_draft_export,
  };
}
