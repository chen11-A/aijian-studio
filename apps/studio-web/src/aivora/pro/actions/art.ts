import { artCastContext, aspectContext, type FilmProject } from "../../film/project";
import { artFromModel, parseLooseJson } from "../../film/phase2";
import type { UiNotice } from "../../film/contracts3j";
import { agentFailureNotice } from "./agent-failure-notice";
import { applyArtDraft, type AgentReply } from "../workflow";

export type ArtActionHost = {
  request: (agent: "art", context: string, instruction: string) => Promise<AgentReply>;
  /** The workspace supplies its existing turn and assistant-scope guard. */
  current: () => boolean;
};
export type ArtActionResult =
  | { status: "stale" }
  | { status: "rejected"; notice: string; structuredNotice: UiNotice }
  | { status: "ready"; lines: string[]; draft: FilmProject };

/** Prepare an art suggestion only. Applying/saving still requires the workspace's user action. */
export async function planArtDraft(
  film: FilmProject,
  host: ArtActionHost,
): Promise<ArtActionResult> {
  const reply = await host.request(
    "art",
    `画风：${film.styleZh}\n${aspectContext(film)}\n${artCastContext(film)}`,
    "写出画风、每人一句固定外貌、场景和道具。只输出 JSON。",
  );
  if (!host.current()) return { status: "stale" };
  const parsed = reply.text ? artFromModel(parseLooseJson(reply.text)) : null;
  if (!parsed)
    return {
      status: "rejected",
      ...agentFailureNotice(reply, "PLANART_FAILED", "本次没有修改作品。"),
    };
  return { status: "ready", lines: parsed.lines, draft: applyArtDraft(film, parsed) };
}
