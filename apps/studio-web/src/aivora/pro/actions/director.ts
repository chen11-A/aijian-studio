import { writerNumberedScript, writerSceneContext } from "../../film/writer-elements";
import { numberedScript } from "../../film/operations";
import { parseDirectorShots, type FilmProject } from "../../film/project";
import type { UiNotice } from "../../film/contracts3j";
import { retryDirectorTimeout, type AgentReply, type AgentRequestControl } from "../workflow";

export function directorRequestInput(
  film: FilmProject,
  sceneId: string,
  story: string,
  sourceText: string,
) {
  const scene = film.scenes.find((item) => item.id === sceneId);
  const script =
    writerNumberedScript(scene, story) ??
    `本地段号（不是原文来源段号）：\n${numberedScript(story)}`;
  const names = film.characters.map((item) => `${item.name}：${item.identity}`).join("\n");
  return {
    sceneId,
    sourceText,
    context: `画风：${film.styleZh}\n场次 id：${sceneId}\n人物：\n${names}\n剧本：\n${script}${writerSceneContext(scene)}`,
    sceneRefs: [...film.scenes],
  };
}
export type DirectorRequestHost = {
  request: (
    agent: "director",
    context: string,
    instruction: string,
    control?: AgentRequestControl,
  ) => Promise<AgentReply>;
  progress: (message: string) => void;
  notify?: (message: UiNotice) => void;
  current: () => boolean;
};
/** Only transport/retry and parsing. Enrichment, coverage notices, ownership and saving stay with the caller. */
export async function requestDirectorDraft(
  input: ReturnType<typeof directorRequestInput>,
  host: DirectorRequestHost,
) {
  const reply = await retryDirectorTimeout(
    (control) => host.request("director", input.context, "把这一场拆成镜头", control),
    host.progress,
    host.notify,
    { current: host.current },
  );
  return {
    shots: reply.text
      ? parseDirectorShots(reply.text, input.sceneId, input.sourceText, input.sceneRefs)
      : null,
    detail: reply.detail,
  };
}
