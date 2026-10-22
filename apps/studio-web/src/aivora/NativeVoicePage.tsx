import { useMemo } from "react";
import { createStudioTransport } from "../api/studio";
import { Button, PageTitle } from "./Common";
import { EpisodeMediaAssemblyPanel } from "./EpisodeMediaAssemblyPanel";
import { SandboxVoicePlan } from "./account/SandboxSurfaces";
import { useDemo } from "./model";

export function NativeVoicePage() {
  const d = useDemo();
  const transport = useMemo(createStudioTransport, []);
  return (
    <div className="v2-utility-page v2-utility-management native-voice-page">
      <PageTitle
        actions={
          <>
            <Button onClick={() => d.go("assets")}>导入录音与音乐</Button>
            <Button onClick={() => d.go("script")}>编辑本集对白</Button>
            <Button onClick={() => d.go("assembly")}>本集成片组装</Button>
          </>
        }
      />
      <div className="native-voice-fit">
        <SandboxVoicePlan />
        <div className="v2-media-body native-assembly-body">
          {d.backendProjectId && d.selectedEpisodeId ? (
            <EpisodeMediaAssemblyPanel
              key={`${d.backendProjectId}/${d.selectedEpisodeId}`}
              projectId={d.backendProjectId}
              episodeId={d.selectedEpisodeId}
              assets={transport.assetLibrary}
              assembly={transport.episodeMediaAssembly}
              script={transport}
              setNavigationGuard={d.setNavigationGuard}
              audioOnly
            />
          ) : (
            <section role="status">
              <p>请先选择真实作品和分集，再读取该集声音与保存剧本。</p>
              <Button onClick={() => d.go("project")}>选择作品和分集</Button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
