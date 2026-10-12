import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaPreparationVersion } from "@aijian/contracts/media-preparation";
import type { StudioTransport } from "../api/studio";
import type { MediaInputLeave } from "./MediaInputLeave";
import { MediaPreparationPanel } from "./MediaPreparationPanel";
import { ManualMediaCandidatePanel } from "./ManualMediaCandidatePanel";

export function MediaPreparationWorkflow({
  projectId,
  episodeId,
  gateway,
  setNavigationGuard,
  go,
}: {
  projectId: string;
  episodeId: string;
  gateway: StudioTransport;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
  go: (page: "storyboard" | "assets" | "assembly" | "services") => void;
}) {
  const checks = useRef(new Map<string, MediaInputLeave>()),
    [selected, setSelected] = useState<MediaPreparationVersion | null>(null);
  const primary = useCallback((c: MediaInputLeave | null) => {
    if (c) checks.current.set("preparation", c);
    else checks.current.delete("preparation");
  }, []);
  const candidate = useCallback((c: MediaInputLeave | null) => {
    if (c) checks.current.set("candidate", c);
    else checks.current.delete("candidate");
  }, []);
  useEffect(() => {
    setNavigationGuard(() => {
      const current = [...checks.current.values()];
      if (!current.every((c) => c.preserve())) return false;
      return (
        !current.some((c) => c.dirty()) ||
        window.confirm("制作请求或手工候选有未保存输入。放弃输入并离开吗？")
      );
    });
    return () => setNavigationGuard(null);
  }, [setNavigationGuard]);
  return (
    <div className="media-preparation-workflow" aria-label="本分集制作请求与手工候选">
      <MediaPreparationPanel
        projectId={projectId}
        episodeId={episodeId}
        gateway={gateway}
        registerLeaveCheck={primary}
        onSelected={setSelected}
        go={go}
      />
      <details className="manual-candidate-section">
        <summary>关联本地素材为手工候选 · DRAFT</summary>
        <ManualMediaCandidatePanel
          projectId={projectId}
          episodeId={episodeId}
          gateway={gateway}
          preparation={selected}
          registerLeaveCheck={candidate}
          go={() => go("assembly")}
        />
      </details>
    </div>
  );
}
