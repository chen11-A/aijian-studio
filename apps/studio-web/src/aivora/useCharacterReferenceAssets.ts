import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import { readAssetLibrary } from "./adapters/assetLibrary";
import type { AssetLibraryListState } from "./adapters/assetLibrary";

export function useCharacterReferenceAssets(projectId: string) {
  const gateway = useMemo(() => createStudioTransport().assetLibrary, []);
  const [read, setRead] = useState<{ projectId: string; state: AssetLibraryListState }>({
    projectId,
    state: { kind: "LOADING" },
  });
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    setRead({ projectId, state: { kind: "LOADING" } });
    const state = await readAssetLibrary(gateway, projectId);
    if (request === epoch.current) setRead({ projectId, state });
  }, [projectId, gateway]);
  useEffect(() => {
    void refresh();
    return () => {
      epoch.current += 1;
    };
  }, [refresh]);
  return {
    state: read.projectId === projectId ? read.state : { kind: "LOADING" as const },
    refresh,
    gateway,
  };
}
