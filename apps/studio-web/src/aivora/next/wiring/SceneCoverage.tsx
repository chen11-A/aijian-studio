import { useState } from "react";
import type { FilmProject } from "../../film/project";

export function SceneCoverage({
  film,
  sceneId,
  onRepair,
}: {
  film: FilmProject;
  sceneId: string;
  onRepair: (sceneId: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const scene = film.scenes.find((item) => item.id === sceneId);
  const coverage = scene?.coverage;
  const unassigned = (film.unassignedBeats ?? []).filter((item) => item.sceneId === sceneId);
  if ((!coverage || coverage.ok) && unassigned.length === 0) return null;
  return (
    <div className="field">
      {failed && <span role="alert">未完成，可以重试。</span>}
      {coverage && !coverage.ok && (
        <div role="status">
          <span
            title={[...coverage.missingLines, coverage.missingTail ?? ""]
              .filter(Boolean)
              .join("\n")}
          >
            这一场还有内容没拍到：
            {coverage.missingTail || coverage.missingLines[0] || coverage.lastLine}
          </span>
          <button
            className="btn sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFailed(false);
              void onRepair(sceneId)
                .catch(() => setFailed(true))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "正在补齐" : "补上结尾"}
          </button>
        </div>
      )}
      {unassigned.length > 0 && (
        <details>
          <summary>有 {unassigned.length} 个动作没对上镜头</summary>
          <ul>
            {unassigned.map((beat, index) => (
              <li key={index}>{beat.text}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
