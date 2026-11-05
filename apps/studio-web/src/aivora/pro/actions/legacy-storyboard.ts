import { directorBudget } from "../director-budget";
import { NOTICE_TEXT } from "../../film/notices";
import { parseWriterPlan } from "../../film/writer-plan";
import { applyWriterPlan } from "../../film/operations";
import { applyContinuityChecks } from "../../film/continuity-rules";
import { applyScenes, numberedScript, parseWriterScenes } from "../../film/operations";
import type { FilmProject, FilmShot } from "../../film/project";
import { directorRequestInput, requestDirectorDraft, type DirectorRequestHost } from "./director";
import type { AgentReply, AgentRequestControl } from "../workflow";

export type LegacyStoryboardHost = {
  current: () => FilmProject | null;
  valid: () => boolean;
  request: (
    agent: "writer" | "director",
    context: string,
    instruction: string,
    control?: AgentRequestControl,
  ) => Promise<AgentReply>;
  apply: (film: FilmProject) => void;
  fillCast: (film: FilmProject) => Promise<void>;
  enrich: (
    film: FilmProject,
    sceneId: string,
    shots: FilmShot[],
    valid: () => boolean,
    control?: AgentRequestControl,
  ) => Promise<FilmShot[]>;
  merge: (film: FilmProject, sceneId: string, shots: FilmShot[]) => FilmProject;
  progress: DirectorRequestHost["progress"];
  notify: DirectorRequestHost["notify"];
};
type Result =
  { kind: "ready"; film: FilmProject } | { kind: "stopped"; text: string } | { kind: "stale" };

// Derive the same continuity notes on both sides; saving metadata and new object identities
// are not edits. No snapshot is persisted or logged.
function content(film: FilmProject): string {
  const normalized = applyContinuityChecks(film);
  const excluded = new Set([
    "savedAt",
    "backendProjectId",
    "directory",
    "productionPipeline",
    "productionInputFingerprint",
    "pipeline",
  ]);
  return JSON.stringify(
    Object.fromEntries(Object.entries(normalized).filter(([key]) => !excluded.has(key))),
  );
}
function source(film: FilmProject): string {
  return JSON.stringify([
    film.sourceText,
    film.title,
    film.styleZh,
    film.scenes.map(({ id, title, text }) => ({ id, title, text })),
  ]);
}
const edited = (): Result => ({
  kind: "stopped",
  text: "作品已修改，已停下连续编导。保留了你的修改，请重新开始。",
});

/** Legacy text-only orchestration. UI state, saving and the durable pipeline remain owned
 * by the workspace; this flow never requests portraits or videos. */
export async function buildLegacyStoryboard(
  base: FilmProject,
  host: LegacyStoryboardHost,
): Promise<Result> {
  let expected = content(base);
  const owned = () => host.valid() && host.current()?.id === base.id;
  const unchanged = () => owned() && content(host.current()!) === expected;
  const stopped = (): Result => (owned() ? edited() : { kind: "stale" });
  const apply = (film: FilmProject) => {
    host.apply(film);
    expected = content(host.current() ?? film);
  };
  const idea =
    base.scenes
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n") || base.title;
  const writer = await host.request(
    "writer",
    `画风：${base.styleZh}`,
    `写成短剧：\n${numberedScript(idea)}`,
  );
  if (!unchanged()) return stopped();
  const scenes = writer.text ? parseWriterScenes(writer.text, idea) : null;
  if (!scenes)
    return {
      kind: "stopped",
      text: writer.detail || "编剧没有按格式返回，已停。没有写入离线剧本。点「继续」再试。",
    };
  apply(
    applyWriterPlan(applyScenes(host.current()!, scenes), parseWriterPlan(writer.text ?? "", idea)),
  );
  const castBase = host.current()!;
  const castSource = source(castBase);
  await host.fillCast(castBase);
  if (!owned()) return { kind: "stale" };
  let next = host.current()!;
  // Cast merges into the latest film. Retain those edits, but never direct changed prose
  // using the writer's old response.
  if (source(next) !== castSource) return edited();
  expected = content(next);
  const withText = next.scenes.filter((item) => item.text.trim());
  const directed = withText.length ? withText : next.scenes.slice(0, 1);
  for (const [index, scene] of directed.entries()) {
    const budget = directorBudget({ current: unchanged, progress: host.progress });
    budget.progress(`正在写第 ${index + 1}/${directed.length} 场「${scene.title}」`);
    try {
      const story = scene.text.trim() || next.title;
      const reply = await budget.run(() =>
        requestDirectorDraft(directorRequestInput(next, scene.id, story, scene.text || story), {
          request: host.request,
          progress: budget.progress,
          notify: host.notify,
          current: budget.current,
          control: budget.control,
        }),
      );
      if (!unchanged()) return stopped();
      if (!reply.shots)
        return {
          kind: "stopped",
          text:
            reply.detail ||
            `「${scene.title}」导演没有按格式返回，已停。没有写入这一场的离线镜头。点「继续」再试。`,
        };
      budget.progress(
        `第 ${index + 1}/${directed.length} 场已写 ${reply.shots.length} 镜，正在写表演。`,
      );
      const performed = await budget.run(() =>
        host.enrich(next, scene.id, reply.shots!, budget.current, budget.control),
      );
      if (!unchanged()) return stopped();
      apply(host.merge(host.current()!, scene.id, performed));
      next = host.current()!;
    } catch (error) {
      if (!unchanged()) return stopped();
      if (budget.reason() !== "TEXT_TIMEOUT") throw error;
      host.notify?.({ code: "TEXT_TIMEOUT", text: NOTICE_TEXT.TEXT_TIMEOUT });
      return { kind: "stopped", text: NOTICE_TEXT.TEXT_TIMEOUT };
    } finally {
      budget.dispose();
    }
  }

  next = {
    ...next,
    shots: [...next.shots]
      .sort((a, b) => {
        const order =
          next.scenes.findIndex((item) => item.id === a.sceneId) -
          next.scenes.findIndex((item) => item.id === b.sceneId);
        return order || a.no - b.no;
      })
      .map((shot, index) => ({ ...shot, no: index + 1 })),
  };
  apply(next);
  return { kind: "ready", film: host.current()! };
}
