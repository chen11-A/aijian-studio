import type { FilmProject, FilmShot } from "../../film/project";
import { shotLines } from "../../film/director-continuity";
import { shotActionText } from "../../film/shot-actions";
import { filmPipelineCheckpoint } from "../film-pipeline-controller";
export type TrialReason = {
  code:
    | "SCENE_FIRST"
    | "DIALOGUE_FIRST"
    | "MULTI_SPEAKER"
    | "RECORD_CHECK"
    | "SCENE_COVERAGE"
    | "SCENE_UNASSIGNED";
  text: string;
};
export type TrialCandidate = {
  id: string;
  sceneId: string;
  label: string;
  picture: string;
  dialogue: string[];
  version: string;
  reasons: TrialReason[];
  sceneMissingLines: string[];
  sceneMissingTail: string | null;
};
export type TrialReview = {
  projectId: string;
  key: string;
  candidates: TrialCandidate[];
  notices: string[];
  omitted: number;
};
function versionRecord(shot: FilmShot) {
  const matches = shot.selectedTakeId ? shot.takes.filter((t) => t.id === shot.selectedTakeId) : [];
  const record = matches.length === 1 ? matches[0]! : null;
  const state =
    record?.status === "done"
      ? "完成记录"
      : record?.status === "queued" || record?.status === "running"
        ? "处理中记录"
        : record
          ? "未完成记录"
          : "未记录选用版本";
  return {
    label: record
      ? `第 ${record.index} 版 · ${state}（文件与内容未核验）`
      : matches.length > 1
        ? "显式选版记录不唯一，请先核对"
        : shot.selectedTakeId
          ? "显式选版未对应到现有记录，请先核对"
          : "显式选版字段为空；本页不推断默认版本",
    identity: {
      selectedId: shot.selectedTakeId,
      matches: matches.length,
      record: record ? { id: record.id, index: record.index, status: record.status } : null,
    },
  };
}
/** Deterministic text/record navigation candidates, never a quality score or generation permission. */
export function buildTrialReview(film: FilmProject): TrialReview {
  const checkpoint = filmPipelineCheckpoint(film);
  const candidates: TrialCandidate[] = [];
  const risks = checkpoint.risks.filter((r) => r.code !== "VIDEO_SUBMISSIONS_ESTIMATE");
  const notices = risks.map((r) => r.text);
  const facts: unknown[] = [];
  for (const scene of film.scenes) {
    if (!scene.id || film.scenes.filter((s) => s.id === scene.id).length !== 1) continue;
    const shots = film.shots
      .filter((s) => s.sceneId === scene.id)
      .slice()
      .sort((a, b) => a.no - b.no);
    const usable = shots.filter(
      (s) => Boolean(s.id) && film.shots.filter((other) => other.id === s.id).length === 1,
    );
    const first = shots[0] && usable.includes(shots[0]) ? shots[0] : undefined;
    const dialogueStart = shots.find((s) => shotLines(s).length > 0);
    const firstDialogue =
      dialogueStart && usable.includes(dialogueStart) ? dialogueStart : undefined;
    const coverage = checkpoint.coverage.find((c) => c.sceneId === scene.id);
    const unassigned = film.unassignedBeats?.filter((b) => b.sceneId === scene.id).length ?? 0;
    for (const shot of usable) {
      const lines = shotLines(shot),
        speakers = new Set(lines.map((l) => l.speaker).filter(Boolean));
      const reasons: TrialReason[] = [];
      if (shot === first)
        reasons.push({
          code: "SCENE_FIRST",
          text: "按本场分镜顺序取首镜，便于回看本场；不是风险排名，也不代表覆盖全部风险。",
        });
      if (shot === firstDialogue)
        reasons.push({
          code: "DIALOGUE_FIRST",
          text: `本场首个有对白记录的镜头，共 ${lines.length} 条，便于先核完整句；未核逐句声音时码。`,
        });
      if (speakers.size > 1)
        reasons.push({
          code: "MULTI_SPEAKER",
          text: `这镜记录了 ${speakers.size} 位说话人，需要分别核对白顺序和声音。`,
        });
      if (shot.continuity?.length)
        reasons.push({
          code: "RECORD_CHECK",
          text: `这镜有 ${shot.continuity.length} 项文字与记录待核项；不是已看过画面的结论。`,
        });
      if (shot === first && coverage && !coverage.ok)
        reasons.push({
          code: "SCENE_COVERAGE",
          text: `本场原文检测有缺项：${coverage.missingLines.length} 条台词${coverage.missingTail ? "，结尾也待核对" : ""}。这是场级线索，不表示缺项就在此镜。`,
        });
      if (shot === first && unassigned)
        reasons.push({
          code: "SCENE_UNASSIGNED",
          text: `本场有 ${unassigned} 个动作尚未归属镜头；列此镜便于回看，不把未归属动作编进此镜。`,
        });
      const version = versionRecord(shot);
      facts.push({
        id: shot.id,
        sceneId: shot.sceneId,
        no: shot.no,
        picture: shot.picture,
        action: shotActionText(shot),
        performance: shot.performance,
        blocking: shot.blocking,
        ambience: shot.sound?.ambience,
        effects: (shot.sound?.sfx ?? []).map((cue) => cue.text),
        lines,
        ...(reasons.length ? { version: version.identity } : {}),
        reasons,
      });
      if (!reasons.length) continue;
      candidates.push({
        id: shot.id,
        sceneId: scene.id,
        label: `第 ${scene.no} 场 · ${scene.title} / 镜头 ${shot.no}`,
        picture: shot.picture,
        dialogue: lines.map((l) => `${l.speaker || "说话人未指定"}：${l.text}`),
        version: version.label,
        reasons,
        sceneMissingLines: coverage?.missingLines ?? [],
        sceneMissingTail: coverage?.missingTail ?? null,
      });
    }
  }
  const omitted = film.shots.filter(
    (s) =>
      !s.id ||
      !s.sceneId ||
      film.shots.filter((other) => other.id === s.id).length !== 1 ||
      film.scenes.filter((scene) => scene.id === s.sceneId).length !== 1,
  ).length;
  if (omitted)
    notices.push(`${omitted} 个镜头的场次或身份记录无法唯一对应，本次未列入，请先核对分镜。`);
  const key = JSON.stringify({
    projectId: film.id,
    scenes: film.scenes.map((s) => ({
      id: s.id,
      no: s.no,
      title: s.title,
      text: s.text,
      paragraphCoverage: s.paragraphCoverage?.ok,
    })),
    facts,
    risks,
    coverage: checkpoint.coverage,
    omitted,
  });
  return {
    projectId: film.id,
    key,
    candidates,
    notices,
    omitted,
  };
}
