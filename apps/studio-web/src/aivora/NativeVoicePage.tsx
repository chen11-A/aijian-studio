import { useMemo } from "react";
import { createStudioTransport } from "../api/studio";
import { Button, PageTitle } from "./Common";
import { EpisodeMediaAssemblyPanel } from "./EpisodeMediaAssemblyPanel";
import { useDemo } from "./model";

export function NativeVoicePage() {
  const d = useDemo();
  const transport = useMemo(createStudioTransport, []);
  return (
    <div className="v2-utility-page v2-utility-management">
      <PageTitle
        actions={
          <>
            <Button onClick={() => d.go("assets")}>导入录音与音乐</Button>
            <Button onClick={() => d.go("script")}>编辑本集对白</Button>
            <Button onClick={() => d.go("assembly")}>本集成片组装</Button>
          </>
        }
      />
      <p>
        声音页与成片组装使用同一本集剪辑版本。选择真实本地录音，可绑定保存剧本的对白、裁剪与另存版本。
      </p>
      <p>
        声线授权、语音生成、对白内容核验和口型同步尚未接通。DRAFT 绑定不证明录音说出了该句对白。
      </p>
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
  );
}
