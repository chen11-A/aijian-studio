import { directorBudget } from "./director-budget";
import { parseWriterPlan } from "../film/writer-plan";
import { applyWriterPlan } from "../film/operations";
import { writerNumberedScript, writerSceneContext } from "../film/writer-elements";
import { applyPerformancePlans, performancePlanPrompt } from "../film/performance-plan";
import { applyActionPlan } from "../film/action-plan";
import type { UiNotice } from "../film/contracts3j";
import { shotLines } from "../film/director-continuity";
import {
  applyScenes,
  assignActionBeats,
  fightConstraints,
  isFightScene,
  mergeCast,
  numberedScript,
  parseCastReply,
  parseWriterScenes,
  updateShot,
} from "../film/operations";
import {
  actionFromModel,
  artFromModel,
  assignPerformance,
  parseLooseJson,
  prompterFromModel,
  withIdentityLocks,
  type AgentId,
} from "../film/phase2";
import { keyframePrompt, parseDirectorShots, type FilmProject } from "../film/project";
import { applyDirectorPlan, repairDirectorCoverage } from "./director-workflow";
import {
  applyArtDraft,
  retryDirectorTimeout,
  type AgentReply,
  type AgentRequestControl,
} from "./workflow";

export type PipelineAgentTarget =
  | { step: "writer"; targetId: "script" | "cast" }
  | { step: "art"; targetId: "art" }
  | { step: "director" | "action" | "performance"; targetId: string }
  | { step: "prompter"; targetId: string };
export type PipelineAgentResult = {
  film?: FilmProject;
  status: "done" | "failed" | "blocked";
  code: string;
  detail?: string;
};
export type PipelineAgentHost = {
  request: (
    agent: AgentId,
    context: string,
    instruction: string,
    control?: AgentRequestControl,
  ) => Promise<AgentReply>;
  /** Checks both project identity and the persisted target's input version. */
  valid: () => boolean;
  notify?: (notice: UiNotice) => void;
  signal?: AbortSignal;
};

/** One stable text target. The host saves returned snapshots before advancing the pipeline. */
export async function runPipelineAgentAction(
  film: FilmProject,
  target: PipelineAgentTarget,
  host: PipelineAgentHost,
): Promise<PipelineAgentResult> {
  const current = () => host.valid() && !host.signal?.aborted;
  const stale = (): PipelineAgentResult => ({
    status: "blocked",
    code: host.signal?.aborted ? "OPERATION_CANCELLED" : "REQUEST_STALE",
  });
  const failed = (code: string, detail = "这一步没有完成，可以重试。"): PipelineAgentResult => ({
    status: "failed",
    code,
    detail,
  });
  const done = (next = film, code = "STEP_COMPLETE"): PipelineAgentResult =>
    current() ? { film: next, status: "done", code } : stale();
  const blocked = (code: string, next?: FilmProject): PipelineAgentResult =>
    current() ? { status: "blocked", code, ...(next ? { film: next } : {}) } : stale();
  const request = async (
    agent: AgentId,
    context: string,
    instruction: string,
    control?: AgentRequestControl,
  ) => {
    if (!current()) return { text: null, detail: "", code: "REQUEST_STALE" };
    return host.request(agent, context, instruction, control);
  };
  const replyFailure = (reply: AgentReply) =>
    failed(
      [
        "TEXT_TIMEOUT",
        "TEXT_STALLED",
        "TEXT_CANCELLED",
        "TEXT_REJECTED",
        "ENTITLEMENT_DENIED",
        "REQUEST_STALE",
      ].includes(reply.code ?? "")
        ? reply.code!
        : `${target.step.toUpperCase()}_REQUEST_FAILED`,
    );
  if (!current()) return stale();
  try {
    if (target.step === "writer") {
      const source =
        target.targetId === "script"
          ? film.sourceText ||
            film.scenes
              .map((scene) => scene.text)
              .filter(Boolean)
              .join("\n")
          : film.scenes
              .map((scene) => scene.text)
              .filter(Boolean)
              .join("\n");
      if (!source.trim()) return blocked("SOURCE_REQUIRED");
      const reply = await request(
        "writer",
        `画风：${film.styleZh}\n原文段落：\n${numberedScript(source)}`,
        target.targetId === "script"
          ? "写成短剧分场，使用 source_paragraphs 标注每段归属，原文台词与结尾完整保留。只输出 JSON。"
          : '抽出人物和场景，只返回 JSON：{"characters":[{"name":"","identity":"","gender":"男/女/空","ageBand":"儿童/少年/青年/中年/老年/空"}],"locations":[{"name":"","prompt":""}]}',
      );
      if (!current()) return stale();
      if (!reply.text) return replyFailure(reply);
      if (target.targetId === "cast") {
        const cast = parseCastReply(reply.text);
        return cast ? done(mergeCast(film, cast)) : failed("CAST_PARSE_FAILED");
      }
      const scenes = parseWriterScenes(reply.text, source);
      if (!scenes?.length) return failed("WRITER_PARSE_FAILED");
      const next = applyWriterPlan(applyScenes(film, scenes), parseWriterPlan(reply.text, source));
      return scenes.some((scene) => scene.paragraphCoverage && !scene.paragraphCoverage.ok)
        ? blocked("SCRIPT_COVERAGE_REVIEW", next)
        : done(next);
    }
    if (target.step === "art") {
      const reply = await request(
        "art",
        `画风：${film.styleZh}\n人物：${JSON.stringify(film.characters.map(({ name, identity }) => ({ name, identity })))}`,
        "写出画风、每人一句固定外貌、场景和道具。只输出 JSON。",
      );
      if (!current()) return stale();
      if (!reply.text) return replyFailure(reply);
      const parsed = artFromModel(parseLooseJson(reply.text));
      return parsed ? done(applyArtDraft(film, parsed)) : failed("ART_PARSE_FAILED");
    }
    if (target.step === "prompter") {
      const shot = film.shots.find((shot) => shot.id === target.targetId);
      if (!shot) return blocked("SHOT_NOT_FOUND");
      if (["promptZh", "promptEn"].every((field) => shot.userFields.includes(field)))
        return done(film, "USER_FIELDS_PRESERVED");
      const names = [
        ...new Set([...shot.characters, ...shotLines(shot).map((line) => line.speaker)]),
      ];
      const locked = withIdentityLocks(keyframePrompt(shot, film), film.characters, names);
      const reply = await request(
        "prompter",
        locked.prompt,
        "写成这一镜的中文和英文提示词。只输出 JSON keyframe.prompt_zh 与 keyframe.prompt_en。",
      );
      if (!current()) return stale();
      if (!reply.text) return replyFailure(reply);
      const parsed = prompterFromModel(parseLooseJson(reply.text));
      if (!parsed?.zh || !parsed.en) return failed("PROMPTER_PARSE_FAILED");
      return done(
        updateShot(film, shot.id, {
          promptZh: shot.userFields.includes("promptZh")
            ? shot.promptZh
            : withIdentityLocks(parsed.zh, film.characters, names).prompt,
          promptEn: shot.userFields.includes("promptEn") ? shot.promptEn : parsed.en,
        }),
      );
    }
    const scene = film.scenes.find((scene) => scene.id === target.targetId);
    if (!scene) return blocked("SCENE_NOT_FOUND");
    const shots = film.shots.filter((shot) => shot.sceneId === scene.id);
    const story = `${scene.title}\n${scene.where}\n${scene.text}`;
    if (target.step === "director") {
      const script =
        writerNumberedScript(scene, scene.text) ??
        `本地段号（不是原文来源段号）：\n${numberedScript(scene.text)}`;
      const context = `画风：${film.styleZh}\n场次 id：${scene.id}\n人物：${JSON.stringify(film.characters.map(({ name, identity }) => ({ name, identity })))}\n原文段落：\n${script}${writerSceneContext(scene)}`;
      const budget = directorBudget({
        current,
        control: host.signal ? { signal: host.signal, deadlineAt: Infinity } : undefined,
        progress: (text) => host.notify?.({ code: "DIRECTOR_PROGRESS", text, detail: text }),
      });
      let draft: ReturnType<typeof parseDirectorShots> = null;
      try {
        budget.progress("正在拆镜头。");
        const reply = await budget.run(() =>
          retryDirectorTimeout(
            (control) =>
              request(
                "director",
                context,
                "把这一场拆成镜头；合并相邻节拍，不能截断台词或结尾。只输出 JSON。",
                { ...control, deadlineAt: budget.control.deadlineAt },
              ),
            budget.progress,
            host.notify,
            {
              current: budget.current,
              signal: budget.control.signal,
              totalMs: budget.control.deadlineAt - Date.now(),
            },
          ),
        );
        if (!current()) return stale();
        if (!reply.text) return replyFailure(reply);
        const parsed = parseDirectorShots(reply.text, scene.id, scene.text, [scene]);
        if (!parsed?.length) return failed("DIRECTOR_PARSE_FAILED");
        draft = parsed;
        const repaired = await budget.run(() =>
          repairDirectorCoverage(
            scene,
            parsed,
            (context, instruction) => {
              budget.progress("正在检查并补齐镜头。");
              return budget.run(() => request("director", context, instruction, budget.control));
            },
            budget.current,
          ),
        );
        if (!current()) return stale();
        const next = applyDirectorPlan(film, repaired.shots, scene.id, film.unassignedBeats ?? []);
        return next.scenes.find((item) => item.id === scene.id)?.coverage?.ok
          ? done(next)
          : blocked("COVERAGE_INCOMPLETE", next);
      } catch (error) {
        if (!current()) return stale();
        const code = budget.reason() || (error instanceof Error ? error.message : "");
        if (code === "TEXT_TIMEOUT" && draft?.length) {
          return blocked(
            "TEXT_TIMEOUT",
            applyDirectorPlan(film, draft, scene.id, film.unassignedBeats ?? []),
          );
        }
        return failed(code === "TEXT_TIMEOUT" ? "TEXT_TIMEOUT" : "DIRECTOR_FAILED");
      } finally {
        budget.dispose();
      }
    }
    if (target.step === "action") {
      if (!isFightScene(story, (scene.tags ?? []).join(" ")))
        return done(film, "ACTION_NOT_REQUIRED");
      if (!shots.length) return blocked("SHOTS_REQUIRED");
      const context = `${story}\n${fightConstraints(story)}\n镜头：${JSON.stringify(shots.map((shot) => ({ id: shot.id, no: shot.no, size: shot.size, picture: shot.picture, action: shot.action, lines: shotLines(shot) })))}`;
      const reply = await request(
        "action",
        context,
        "按给出的镜头 id 写动作节点。只按 id 绑定，纯对白镜头不能加入打斗动作，无法归属的节点保留空 id。只输出 JSON。",
      );
      if (!current()) return stale();
      if (!reply.text) return replyFailure(reply);
      const parsed = actionFromModel(parseLooseJson(reply.text));
      if (!parsed?.length) return failed("ACTION_PARSE_FAILED");
      const pending = (film.unassignedBeats ?? [])
        .filter((beat) => beat.sceneId === scene.id)
        .map((beat) => ({ text: beat.text }));
      const assigned = assignActionBeats(film.shots, scene.id, [...pending, ...parsed], scene.text);
      const next = applyActionPlan(
        {
          ...film,
          shots: assigned.shots.map((shot) => {
            const original = film.shots.find((item) => item.id === shot.id);
            return original?.userFields.includes("action") ? original : shot;
          }),
          unassignedBeats: [
            ...(film.unassignedBeats ?? []).filter((beat) => beat.sceneId !== scene.id),
            ...assigned.unassignedBeats.filter(
              (beat, index, all) => all.findIndex((item) => item.text === beat.text) === index,
            ),
          ],
        },
        scene.id,
        parseLooseJson(reply.text),
      );
      return next.scenes.find((item) => item.id === scene.id)?.actionState?.unassigned.length ||
        next.unassignedBeats?.some((beat) => beat.sceneId === scene.id)
        ? blocked("ACTION_UNASSIGNED", next)
        : done(next);
    }
    const targets = shots.filter(
      (shot) =>
        (shot.characters.some((name) => name && !["人物", "空镜"].includes(name)) ||
          shotLines(shot).some((line) => line.speaker)) &&
        !(shot.userFields.includes("performance") && shot.userFields.includes("delivery")),
    );
    if (!shots.length) return blocked("SHOTS_REQUIRED");
    if (!targets.length) return done(film, "PERFORMANCE_NOT_REQUIRED");
    const reply = await request(
      "performance",
      `${story}\n镜头：${JSON.stringify(targets.map((shot) => ({ id: shot.id, characters: shot.characters, picture: shot.picture, lines: shotLines(shot) })))}`,
      "按给出的 id 为每一镜写表情、视线、手势、语气、语速与停顿。只输出 JSON 数组，每项必须使用给出的 id；who 写明人物，其他人的表演放 others 并写 name。",
    );
    if (!current()) return stale();
    if (!reply.text) return replyFailure(reply);
    const parsed = parseLooseJson(reply.text);
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? (parsed as { shots?: unknown }).shots
        : null;
    const planned = applyPerformancePlans(targets, parsed);
    const withState = {
      ...film,
      scenes: film.scenes.map((item) =>
        item.id === scene.id ? { ...item, performanceState: planned.state } : item,
      ),
    };
    if (planned.state.unassigned.length) return blocked("PERFORMANCE_UNASSIGNED", withState);
    if (!Array.isArray(rows) || targets.some((shot) => !planned.assignedIds.includes(shot.id)))
      return failed("PERFORMANCE_TARGETS_INCOMPLETE");
    const notes = assignPerformance(
      rows,
      targets,
      film.characters.map((person) => person.name),
    );
    if (notes.some((note) => !note.performance && !note.delivery))
      return failed("PERFORMANCE_PARSE_FAILED");
    const voiceReviews = notes
      .filter((note) => note.voiceRisk)
      .map((note) => ({ shotId: note.id, reason: note.voiceRisk! }));
    const next = {
      ...withState,
      scenes: withState.scenes.map((item) =>
        item.id === scene.id
          ? {
              ...item,
              performanceState: {
                ...planned.state,
                ...(voiceReviews.length ? { voiceReviews } : {}),
              },
            }
          : item,
      ),
      shots: film.shots.map((shot) => {
        const plannedShot = planned.shots.find((item) => item.id === shot.id);
        const note = notes.find((note) => note.id === shot.id);
        if (!note) return shot;
        return {
          ...shot,
          performancePlan: plannedShot?.performancePlan ?? shot.performancePlan,
          performance: shot.userFields.includes("performance")
            ? shot.performance
            : (plannedShot && performancePlanPrompt(plannedShot)) ||
              note.performance ||
              shot.performance,
          performanceSource:
            !shot.userFields.includes("performance") && note.performance
              ? "agent:performance"
              : shot.performanceSource,
          delivery: shot.userFields.includes("delivery")
            ? shot.delivery
            : note.delivery || shot.delivery,
        };
      }),
    };
    return voiceReviews.length ? blocked("PERFORMANCE_VOICE_REVIEW", next) : done(next);
  } catch {
    return current() ? failed(`${target.step.toUpperCase()}_REQUEST_FAILED`) : stale();
  }
}
