import { useDemo } from "./model";
import { EpisodeScriptEditor } from "./EpisodeScriptEditor";
import { StoryboardWorkspaceView } from "./StoryboardWorkspaceView";
import { CreativeWorkspaceExit, CreativeWorkspaceFrame } from "./CreativeWorkspaceFrame";
import "./creative-workspace.css";

/** Opt-in presentation only. The shell owns the runtime switch and guarded exit. */
export function CreativeWorkspace({ onExit }: { onExit: () => void }) {
  const d = useDemo();
  const projectId = d.backendProjectId;
  const episodeId = d.selectedEpisodeId;
  const brief = d.productionBrief?.data;
  const briefVersionId =
    d.productionBriefState === "ready" &&
    brief?.project_id === projectId &&
    brief.head.latest_version_id === brief.version.id
      ? brief.version.id
      : null;
  const scopeKey = `${projectId ?? "none"}/${episodeId ?? "none"}`;
  return (
    <CreativeWorkspaceExit.Provider value={onExit}>
      {!projectId || !episodeId ? (
        <CreativeWorkspaceFrame
          outlineTitle="内容"
          outline={null}
          status="选择作品和剧集后开始编辑"
        >
          <div className="cw-document-empty">
            <h1>选择一个剧集</h1>
            <p>
              {d.episodeState === "loading"
                ? "正在读取本地剧集…"
                : "从左侧选择剧集，或新建一集开始编写。"}
            </p>
          </div>
        </CreativeWorkspaceFrame>
      ) : d.page === "storyboard" ? (
        <StoryboardWorkspaceView
          key={`storyboard/${scopeKey}`}
          projectId={projectId}
          episodeId={episodeId}
          setNavigationGuard={d.setNavigationGuard}
        />
      ) : (
        <EpisodeScriptEditor
          key={`script/${scopeKey}`}
          workspace
          projectId={projectId}
          episodeId={episodeId}
          briefVersionId={briefVersionId}
          episodeTitle={d.episodes.find((episode) => episode.id === episodeId)?.title}
          setNavigationGuard={d.setNavigationGuard}
          onOpenSource={() => d.go("source")}
        />
      )}
    </CreativeWorkspaceExit.Provider>
  );
}
