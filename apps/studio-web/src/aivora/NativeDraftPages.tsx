import { ChangeCostNotice, FormalDeliveryChecklist } from "./account/SandboxSurfaces";
import { openWuchengSample, promptNewProject } from "./sample-project";
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
        {view === "changes" && <ChangeCostNotice onOpenCosts={() => d.go("costs")} />}
        {view === "export" && <FormalDeliveryChecklist />}
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
            <p>还没有打开作品。打开示例「雾城来信」后，才能查看这一集的草稿和修改。</p>
            <Button onClick={() => promptNewProject(d)}>新建项目</Button>
            <Button primary onClick={() => void openWuchengSample(d)}>
              打开示例
            </Button>
            <Button onClick={() => d.go("home")}>回到首页</Button>
          </section>
        )}
      </div>
      {projectId && episodeId && (
        <FlowFooter
          label={
            view === "review" ? "查看本集修改" : view === "changes" ? "去导出草稿" : "回到成片"
          }
          action={() =>
            d.go(view === "review" ? "changes" : view === "changes" ? "export" : "assembly")
          }
          secondaryLabel={view === "changes" ? "回到审片" : "回到剪辑"}
          secondaryAction={() => d.go(view === "changes" ? "review" : "assembly")}
          reason="当前导出的是草稿。正式发行还要另外完成检查。"
        />
      )}
    </>
  );
}
