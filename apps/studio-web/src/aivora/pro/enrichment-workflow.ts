import { directorBudget } from "./director-budget";
import type { FilmProject, FilmShot } from "../film/project";
import { assignActionBeats, fightConstraints, isFightScene } from "../film/operations";
import { actionFromModel, assignPerformance, parseLooseJson } from "../film/phase2";
import { shotLines } from "../film/director-continuity";
import { repairDirectorCoverage } from "./director-workflow";
import type { AgentReply, AgentRequestControl } from "./workflow";

export async function enrichDirectorPlan(
  base: FilmProject,
  sceneId: string,
  shots: FilmShot[],
  options: {
    valid: () => boolean;
    control?: AgentRequestControl;
    progress?: (message: string) => void;
    request: (
      role: "director" | "performance" | "action",
      context: string,
      instruction: string,
      control?: AgentRequestControl,
    ) => Promise<AgentReply>;
    warning: (text: string) => void;
    unassigned: (sceneId: string, beats: NonNullable<FilmProject["unassignedBeats"]>) => void;
  },
): Promise<FilmShot[]> {
  const budget = directorBudget({
    current: options.valid,
    control: options.control,
    progress: options.progress,
  });
  const request = (
    role: "director" | "performance" | "action",
    context: string,
    instruction: string,
  ) => budget.run(() => options.request(role, context, instruction, budget.control));
  async function fillPerformance(
    base: FilmProject,
    shots: FilmShot[],
    valid: () => boolean = () => true,
  ): Promise<FilmShot[]> {
    const sceneIds = [...new Set(shots.map((item) => item.sceneId))];
    let filled = shots;
    for (const sceneId of sceneIds) {
      const group = filled.filter((item) => item.sceneId === sceneId);
      const targets = group.filter((shot) => {
        const people = shot.characters.filter((name) => name && name !== "人物" && name !== "空镜");
        return people.length > 0 || Boolean(shot.speaker?.trim());
      });
      if (targets.length === 0) continue;
      const sceneRow = base.scenes.find((item) => item.id === sceneId);
      const names = [
        ...new Set(
          targets.flatMap((shot) => shot.characters.filter(Boolean).concat(shot.speaker ?? "")),
        ),
      ].filter((name) => name && name !== "人物" && name !== "空镜");
      const context = [
        `场次：${sceneRow?.title ?? ""} ${sceneRow?.where ?? ""}`.trim(),
        `剧本：${sceneRow?.text ?? ""}`,
        `镜头：${JSON.stringify(targets.map((shot) => ({ id: shot.id, picture: shot.picture, line: shot.line, speaker: shot.speaker })))}`,
      ].join("\n");
      try {
        const reply = await request(
          "performance",
          context,
          "按给出的 id 为每一镜写表情、视线、手势，以及语气、语速、停顿和情绪。只输出 JSON 数组，每项的 id 必须用我给的 id。",
        );
        if (!valid()) return shots;
        const parsed = reply.text ? parseLooseJson(reply.text) : null;
        if (!parsed) throw new Error(reply.detail || "表演指导没有返回可用内容。");
        const notes = assignPerformance(parsed, targets, names);
        filled = filled.map((shot) => {
          const note = notes.find((item) => item.id === shot.id);
          if (!note || (!note.performance && !note.delivery)) return shot;
          const visual = note.performance;
          return {
            ...shot,
            performance: visual || shot.performance,
            performanceSource: visual ? "agent:performance" : shot.performanceSource,
            delivery: note.delivery || shot.delivery,
          };
        });
      } catch {
        if (valid()) options.warning("表演补充未完成，可重新请表演指导补充。");
      }
    }
    return filled;
  }

  async function fillFight(
    base: FilmProject,
    shots: FilmShot[],
    valid: () => boolean = () => true,
  ): Promise<FilmShot[]> {
    let next = shots;
    const sceneIds = [...new Set(shots.map((item) => item.sceneId))];
    for (const sceneId of sceneIds) {
      const sceneRow = base.scenes.find((item) => item.id === sceneId);
      const story = `${sceneRow?.title ?? ""}\n${sceneRow?.where ?? ""}\n${sceneRow?.text ?? ""}`;
      if (!sceneRow || !isFightScene(story, (sceneRow.tags ?? []).join(" "))) continue;
      try {
        const reply = await request(
          "action",
          `${story}\n${fightConstraints(story)}\n镜头：${JSON.stringify(shots.filter((shot) => shot.sceneId === sceneId).map((shot) => ({ id: shot.id, no: shot.no, size: shot.size, picture: shot.picture, action: shot.action, line: shot.line, lines: shotLines(shot) })))}`,
          "按给出的镜头 id 写拍，每一拍只属于一个镜头。不要把打斗动作放进打斗开始之前的镜头。只输出 JSON。",
        );
        if (!valid()) return shots;
        const parsed = reply.text ? actionFromModel(parseLooseJson(reply.text)) : null;
        if (!parsed) throw new Error(reply.detail || "动作指导没有返回可用内容。");
        const assigned = assignActionBeats(next, sceneId, parsed, sceneRow.text, sceneRow);
        next = assigned.shots;
        options.unassigned(sceneId, assigned.unassignedBeats);
      } catch {
        if (valid()) options.warning("动作补充未完成，可重新请动作指导补充。");
      }
    }
    return next;
  }

  const target = base.scenes.find((scene) => scene.id === sceneId);
  try {
    if (!target || !budget.current()) return shots;
    budget.progress("正在核对这一场的结尾。");
    const repaired = await repairDirectorCoverage(
      target,
      shots,
      (context, instruction) => request("director", context, instruction),
      budget.current,
    );
    if (!budget.current()) return shots;
    budget.progress("正在补充这一场的表演。");
    const performed = await fillPerformance(base, repaired.shots, budget.current);
    if (!budget.current()) return repaired.shots;
    budget.progress("正在补充这一场的动作。");
    return await fillFight(base, performed, budget.current);
  } finally {
    budget.dispose();
  }
}
