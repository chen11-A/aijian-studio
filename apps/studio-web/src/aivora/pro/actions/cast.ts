import { extractCastOffline, mergeCast, parseCastReply } from "../../film/operations";
import type { FilmProject } from "../../film/project";
import type { AgentReply } from "../workflow";

export type CastExtractionHost = {
  connected: boolean;
  request: (agent: "writer", context: string, instruction: string) => Promise<AgentReply>;
  current: () => FilmProject | null;
  /** Project identity plus the workspace's monotonic cast-request epoch. */
  valid: () => boolean;
  noticeCurrent: () => boolean;
  apply: (film: FilmProject) => void;
  notice: (text: string) => void;
};
export function castExtractionStory(base: FilmProject): string | null {
  if (base.characters.length > 0 && base.locations.length > 0) return null;
  const story = base.scenes
    .map((item) => item.text)
    .filter(Boolean)
    .join("\n");
  return story.trim() ? story : null;
}

/** Offline extraction and application intentionally complete synchronously before returning
 * this promise. An extra await there would race a simultaneously prepared director plan. */
export async function extractAndMergeCast(
  base: FilmProject,
  story: string,
  host: CastExtractionHost,
): Promise<void> {
  let extracted = host.connected ? null : extractCastOffline(story);
  if (host.connected) {
    const reply = await host
      .request(
        "writer",
        story,
        '抽出人物和场景，只返回 JSON：{"characters":[{"name":"","identity":"","gender":"male/female/unknown","age_band":"child/young/adult/elder/unknown"}],"locations":[{"name":"","prompt":""}]}',
      )
      .catch(() => ({ text: null, detail: "人物提取失败，可以重试。" }));
    if (!host.valid() || host.current()?.id !== base.id) return;
    const parsed = reply.text ? parseCastReply(reply.text) : null;
    if (parsed && (parsed.characters.length > 0 || parsed.locations.length > 0)) extracted = parsed;
    else {
      if (host.noticeCurrent()) host.notice(reply.detail || "没有认出人物和场景，没有写入猜测。");
      return;
    }
  }
  const live = host.current();
  if (!extracted || !live || live.id !== base.id || !host.valid()) return;
  const merged = mergeCast(live, extracted);
  if (merged === live) {
    if (base.characters.length === 0 && base.locations.length === 0)
      host.notice("这一场还没有认出人物和场景。");
    return;
  }
  host.apply(merged);
  const names = merged.characters.map((item) => item.name).filter(Boolean);
  if (names.length > 0) host.notice(`已记下人物：${names.join("、")}。`);
}
