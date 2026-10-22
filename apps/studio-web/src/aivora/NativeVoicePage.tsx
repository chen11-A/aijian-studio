import { useMemo } from "react";
import { createStudioTransport } from "../api/studio";
import { Button, PageTitle } from "./Common";
import { EpisodeMediaAssemblyPanel } from "./EpisodeMediaAssemblyPanel";
import { useDemo } from "./model";
import { openWuchengSample } from "./sample-project";

export function NativeVoicePage() {
  const d = useDemo();
  const transport = useMemo(createStudioTransport, []);
  return (
    <div className="v2-utility-page v2-utility-management native-voice-page">
      <PageTitle
        actions={
          d.backendProjectId && d.selectedEpisodeId ? (
            <>
              <Button onClick={() => d.go("assets")}>导入录音与音乐</Button>
              <Button onClick={() => d.go("script")}>编辑本集对白</Button>
              <Button onClick={() => d.go("assembly")}>本集成片组装</Button>
            </>
          ) : undefined
        }
      />
      <div className="native-voice-fit">
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
              <p>还没有打开作品。配音声音在「AI 服务」里选择。也可以先打开示例「雾城来信」。</p>
              <Button primary onClick={() => void openWuchengSample(d)}>
                打开雾城来信
              </Button>
              <Button onClick={() => d.go("services")}>去选择配音</Button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
