import { useEffect, useRef, useState } from "react";
import { settingsResponse } from "@aijian/contracts/project-settings";
import type { ProjectSettingsGateway } from "@aijian/contracts/project-settings";
import type { AssemblyContent } from "./adapters/episodeMediaAssembly";
import { Button } from "./Common";

const empty = (c: AssemblyContent) =>
  c.total_frames === 0 &&
  !c.visual_segments.length &&
  !c.audio_segments.length &&
  !c.subtitle_segments.length;
export function AssemblyProjectTimebase({
  projectId,
  episodeId,
  content,
  locked,
  gateway,
  edit,
}: {
  projectId: string;
  episodeId: string;
  content: AssemblyContent;
  locked: boolean;
  gateway?: Pick<ProjectSettingsGateway, "getProjectSettings">;
  edit: (content: AssemblyContent) => unknown;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const inFlight = useRef(false);
  const live = useRef({ content, locked });
  live.current = { content, locked };
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setBusy(false);
    setNotice("");
    return () => {
      generation.current += 1;
    };
  }, [projectId, episodeId]);
  async function adopt() {
    if (!gateway || locked || !empty(content) || inFlight.current) return;
    const request = ++generation.current;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await gateway.getProjectSettings(projectId);
      if (generation.current !== request) return;
      if (live.current.locked || live.current.content !== content || !empty(live.current.content)) {
        setNotice("装配已变化；未选用返回的项目时基，请重新核对。");
        return;
      }
      if (result.kind !== "FOUND" || !settingsResponse(result.receipt, projectId)) {
        setNotice("项目默认时基无法核实，装配未修改。");
        return;
      }
      const t = result.receipt.data.sequence_timebase;
      if (!t) {
        setNotice("项目尚未指定默认时基，装配未修改。");
        return;
      }
      edit({ ...content, sequence_timebase: t });
      setNotice(`已选用项目修订 ${result.receipt.data.revision} 的默认时基；请显式保存装配版本。`);
    } catch {
      if (generation.current === request) setNotice("项目设置读取失败，装配未修改。");
    } finally {
      if (generation.current === request) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <div>
      <Button disabled={!gateway || locked || !empty(content) || busy} onClick={() => void adopt()}>
        读取并选用项目默认时基
      </Button>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
