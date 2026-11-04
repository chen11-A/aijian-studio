import { useState } from "react";
import { VisualBibleEditor } from "./VisualBibleEditor";
import { useDemo } from "./model";
import { Button, Pill } from "./Common";
import { ManualCreativeEditor } from "./ManualCreativeEditor";
import { SavedInvalidationHistory } from "./SavedInvalidationHistory";

/** The key discards a previous project's asynchronous view before rendering the next project. */
export function ManualCreativePage({ kind }: { kind: "characters" | "world" | "scenes" }) {
  const d = useDemo();
  const [visual, setVisual] = useState(false);
  return (
    <>
      <nav aria-label="共享设定与正式视觉环境审签">
        <Button
          onClick={() => {
            if (d.canLeaveCurrentEditor()) setVisual(false);
          }}
        >
          共享设定库
        </Button>
        <Button
          onClick={() => {
            if (d.canLeaveCurrentEditor()) setVisual(true);
          }}
        >
          视觉与环境
        </Button>
      </nav>
      {visual ? (
        d.backendProjectId ? (
          <VisualBibleEditor
            key={d.backendProjectId}
            projectId={d.backendProjectId}
            setNavigationGuard={d.setNavigationGuard}
          />
        ) : (
          <p>请先选择真实作品。</p>
        )
      ) : (
        <ManualCreativeEditor
          key={`${d.backendProjectId ?? "unselected"}:${kind}`}
          kind={kind}
          projectId={d.backendProjectId}
          episodeId={d.selectedEpisodeId}
          episodes={d.episodes}
          episodeListReady={d.episodeState === "ready"}
          setNavigationGuard={d.setNavigationGuard}
        />
      )}
      {visual && d.invalidationHistory && d.invalidationHistoryController && (
        <section aria-label="视觉环境批准替代与下游影响">
          <h2>视觉环境批准替代与下游影响</h2>
          <SavedInvalidationHistory
            projectId={d.backendProjectId}
            history={d.invalidationHistory}
            controller={d.invalidationHistoryController}
          />
        </section>
      )}
    </>
  );
}
/** Professional mode must not expose fixture-only controls for real creative records. */
export function ManualCreativeInspector() {
  const d = useDemo();
  const project = d.projects.find((item) => item.backendId === d.backendProjectId);
  return (
    <aside className="inspector manual-creative-inspector" aria-label="作品设定检查器">
      <header>
        <h2>作品共享设定</h2>
        <Pill>人工草稿</Pill>
      </header>
      <section>
        <h3>{project?.name ?? "当前作品"}</h3>
        <p>角色、世界和场景在本作品各集共享。请在主编辑区修改，再保存为新版本。</p>
        <p>保存状态与回读结果显示在主编辑区；此处没有单独的修改或批准操作。</p>
        <Button
          onClick={() => {
            const editor = document.getElementById("manual-creative-editor");
            editor?.scrollIntoView({ block: "nearest" });
            editor?.focus();
          }}
        >
          返回设定编辑区
        </Button>
      </section>
    </aside>
  );
}
