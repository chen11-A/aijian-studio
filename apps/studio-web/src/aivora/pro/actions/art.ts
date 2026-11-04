import type { FilmProject } from "../../film/project";
import { artFromModel, parseLooseJson } from "../../film/phase2";
import { applyArtDraft, type AgentReply } from "../workflow";

export type ArtActionHost = {
  request: (agent: "art", context: string, instruction: string) => Promise<AgentReply>;
  /** The workspace supplies its existing turn and assistant-scope guard. */
  current: () => boolean;
};
export type ArtActionResult =
  | { status: "stale" }
  | { status: "rejected"; notice: string }
  | { status: "ready"; lines: string[]; draft: FilmProject };

/** Prepare an art suggestion only. Applying/saving still requires the workspace's user action. */
export async function planArtDraft(
  film: FilmProject,
  host: ArtActionHost,
): Promise<ArtActionResult> {
  const reply = await host.request(
    "art",
    `画风：${film.styleZh}\n人物：${film.characters.map((item) => item.name).join("、")}`,
    "写出画风、每人一句固定外貌、场景和道具。只输出 JSON。",
  );
  if (!host.current()) return { status: "stale" };
  const parsed = reply.text ? artFromModel(parseLooseJson(reply.text)) : null;
  if (!parsed)
    return {
      status: "rejected",
      notice: reply.text
        ? "美术没有按格式返回，这次没有改作品。"
        : `${reply.detail} 这次没有改作品。`,
    };
  return { status: "ready", lines: parsed.lines, draft: applyArtDraft(film, parsed) };
}
