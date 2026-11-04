import { updateShot } from "../../film/operations";
import { parseLooseJson, prompterFromModel, withIdentityLocks } from "../../film/phase2";
import { keyframePrompt, type FilmProject, type FilmShot } from "../../film/project";
import type { AgentReply } from "../workflow";

export type PrompterActionHost = {
  request: (agent: "prompter", context: string, instruction: string) => Promise<AgentReply>;
  current: () => boolean;
};
export type PrompterActionResult =
  | { status: "stale" }
  | { status: "rejected"; notice: string }
  | { status: "ready"; film: FilmProject; zh: string; en: string; missing: string[] };

/** Prepare the same two prompt-field updates; the workspace retains final guard and persistence. */
export async function planPrompterDraft(
  film: FilmProject,
  shot: FilmShot,
  host: PrompterActionHost,
): Promise<PrompterActionResult> {
  const locked = withIdentityLocks(keyframePrompt(shot, film), film.characters, shot.characters);
  const reply = await host.request("prompter", locked.prompt, "写成这一镜的提示词。只输出 JSON。");
  if (!host.current()) return { status: "stale" };
  const parsed = reply.text ? prompterFromModel(parseLooseJson(reply.text)) : null;
  if (!parsed)
    return { status: "rejected", notice: reply.text ? "提示词没有按格式返回。" : reply.detail };
  const zh = withIdentityLocks(parsed.zh || locked.prompt, film.characters, shot.characters);
  return {
    status: "ready",
    film: updateShot(film, shot.id, { promptZh: zh.prompt, promptEn: parsed.en }),
    zh: zh.prompt,
    en: parsed.en,
    missing: zh.missing,
  };
}
