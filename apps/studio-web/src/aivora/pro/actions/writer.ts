import { parseWriterPlan, type WriterPlan } from "../../film/writer-plan";
import {
  adaptToShortDrama,
  offlineScreenplay,
  numberedScript,
  parseWriterScenes,
} from "../../film/operations";
import { scenesEchoRequest } from "../../film/phase2";
import type { FilmProject, FilmScene } from "../../film/project";
import type { AgentReply } from "../workflow";
export function writerDraftInput(film: FilmProject, kind: "write" | "adapt", chat: string) {
  const story =
    film.scenes
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n") || film.title;
  const idea = chat.trim() || story;
  const asked =
    chat.trim() || (kind === "adapt" ? "把现有内容改成短剧" : "按地点和时间把现有剧本分成几场");
  return { story, idea, asked, kind, chat: chat.trim(), styleZh: film.styleZh };
}
export type WriterDraftResult = {
  scenes: FilmScene[] | null;
  writerPlan?: WriterPlan;
  notice: string;
  event: "scenes" | "rejected" | "offline";
};
export async function planWriterDraft(
  input: ReturnType<typeof writerDraftInput>,
  host: {
    connected: boolean;
    request: (agent: "writer", context: string, instruction: string) => Promise<AgentReply>;
  },
): Promise<WriterDraftResult> {
  const { story, idea, asked, kind, chat, styleZh } = input;
  const connected = host.connected;
  let scenes: FilmScene[] | null = null;
  let writerPlan: WriterPlan | undefined;
  let text = "没有登录，已用离线编剧。点「放入剧本」才会写入。";
  try {
    if (!connected) {
      scenes = kind === "adapt" ? adaptToShortDrama(idea, 60) : offlineScreenplay(idea, 60);
      text = kind === "adapt" ? "没有登录，已按大约 60 秒收成短剧。点「放入剧本」才会写入。" : text;
    }
    const reply = await host.request(
      "writer",
      `画风：${styleZh}\n目标大约 60 秒。\n原文段落：\n${numberedScript(story)}`,
      `${kind === "adapt" ? "把原文改成短剧" : "写成短剧，按地点和时间分场"}，保留全部台词与结尾。${chat.trim()}`,
    );
    if (reply.text) {
      const parsed = parseWriterScenes(reply.text, story);
      const echo = parsed ? scenesEchoRequest(parsed, asked) : false;
      if (parsed && !echo) {
        scenes = parsed;
        writerPlan = parseWriterPlan(reply.text, story);
        text = "编剧写好了。点「放入剧本」才会写入。";
      } else if (connected) {
        scenes = null;
        text = echo
          ? "模型把请求原文当成了结果，这次没有改剧本。"
          : "模型没有按格式返回，这次没有改剧本。";
      }
    } else if (connected) {
      scenes = null;
      text = `${reply.detail} 这次没有改剧本。`;
    }
  } catch {
    scenes = null;
    text = "编剧请求失败，没有改动剧本，可以重试。";
  }
  return {
    scenes,
    ...(writerPlan ? { writerPlan } : {}),
    notice: text,
    event: scenes && connected ? "scenes" : connected ? "rejected" : "offline",
  };
}
