import { AssemblyReadinessPanel } from "./AssemblyReadinessPanel";
import { ScriptConfirmationImpactHistory } from "./ScriptConfirmationImpactHistory";
import { SavedInvalidationHistory } from "./SavedInvalidationHistory";
import { Button, FlowFooter, PageTitle } from "./Common";
import { DraftExportPanel } from "./DraftExportPanel";
import { DraftReviewWorkspace } from "./DraftReviewWorkspace";
import type { useDemo } from "./model";
import type { createStudioTransport } from "../api/studio";

export function NativeDraftPages({
  d,
  transport,
}: {
  d: ReturnType<typeof useDemo>;
  transport: ReturnType<typeof createStudioTransport>;
}) {
  const view = d.page === "changes" ? "changes" : d.page === "export" ? "export" : "review";
  const projectId = d.backendProjectId;
  const episodeId = d.selectedEpisodeId;
  return (
    <>
      <PageTitle />
      <div className="v2-media-body native-assembly-body">
        {view === "changes" && d.invalidationHistory && d.invalidationHistoryController && (
          <section aria-label="作品批准替代与下游影响">
            <h2>作品批准替代与下游影响</h2>
            <SavedInvalidationHistory
              projectId={projectId}
              history={d.invalidationHistory}
              controller={d.invalidationHistoryController}
            />
          </section>
        )}
        {view === "changes" && (
          <ScriptConfirmationImpactHistory projectId={projectId} gateway={transport} />
        )}
        {projectId && episodeId ? (
          <>
            {view === "export" && (
              <DraftExportPanel
                key={`${projectId}/${episodeId}`}
                projectId={projectId}
                episodeId={episodeId}
                assembly={transport.episodeMediaAssembly}
                exports={transport.draftExports}
                showReview={false}
              />
            )}
            {view === "export" && (
              <AssemblyReadinessPanel
                key={`readiness/${projectId}/${episodeId}`}
                projectId={projectId}
                episodeId={episodeId}
                gateway={transport}
                assembly={transport.episodeMediaAssembly}
              />
            )}
            <DraftReviewWorkspace
              projectId={projectId}
              episodeId={episodeId}
              exports={transport.draftExports}
              view={view}
              onAssembly={() => d.go("assembly")}
              onExport={view === "export" ? undefined : () => d.go("export")}
              setNavigationGuard={d.setNavigationGuard}
            />
          </>
        ) : (
          <section role="status">
            <p>请先选择真实项目和剧集，再读取此分集的草稿、批注和修改计划。</p>
            <Button onClick={() => d.go("project")}>选择项目和剧集</Button>
          </section>
        )}
      </div>
      <FlowFooter
        label={
          view === "review"
            ? "查看本集修改计划"
            : view === "changes"
              ? "另行导出本集新装配 DRAFT"
              : "返回成片组装"
        }
        action={() =>
          d.go(view === "review" ? "changes" : view === "changes" ? "export" : "assembly")
        }
        secondaryLabel={view === "changes" ? "返回本集审片" : "返回本集剪辑"}
        secondaryAction={() => d.go(view === "changes" ? "review" : "assembly")}
        reason="DRAFT 手工闭环 · 修改和导出须分别操作 · 正式签发待完成"
      />
    </>
  );
}
