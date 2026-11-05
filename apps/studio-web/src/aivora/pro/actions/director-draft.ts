import { directorBudget } from "../director-budget";
import type { AgentRequestControl } from "../workflow";
import { NOTICE_TEXT } from "../../film/notices";
import { offlineShots } from "../../film/project";
import { sceneNeedsSource } from "../../film/operations";
import type { FilmProject, FilmShot } from "../../film/project";
import type { SceneCoverage, UiNotice } from "../../film/contracts3j";
import { coverageNotice } from "../../film/coverage-notice";
import { detectDirectorCoverage, directorPlanStatus } from "../../film/director-continuity";
import { directorRequestInput, requestDirectorDraft, type DirectorRequestHost } from "./director";

export type DirectorDraftResult =
  | { status: "stale" }
  | {
      status: "complete";
      shots: FilmShot[] | null;
      notice: string;
      retry?: { role: "director"; context: string; instruction: string };
      coverage: SceneCoverage | null;
      coverageNotice?: UiNotice;
      target: number;
      event?: "shots" | "offline" | "rejected" | "partial";
    };

/** Result policy only: caller retains request ownership, draft storage and confirmation. */
export async function planDirectorDraft(
  base: FilmProject,
  sceneId: string,
  asked: string,
  host: DirectorRequestHost & {
    connected: boolean;
    enrich: (
      base: FilmProject,
      sceneId: string,
      shots: FilmShot[],
      current: () => boolean,
      control?: AgentRequestControl,
    ) => Promise<FilmShot[]>;
    warnings: () => string[];
  },
): Promise<DirectorDraftResult> {
  if (!host.current()) return { status: "stale" };
  const scene = base.scenes.find((item) => item.id === sceneId);
  if (!scene)
    return {
      status: "complete",
      shots: null,
      notice: "先写好这一场，再请导演。",
      coverage: null,
      target: 16,
    };
  const story = [scene.text.trim() || base.title, asked.trim()].filter(Boolean).join("\n");
  const input = directorRequestInput(base, sceneId, story, scene.text);
  const budget = directorBudget({
    current: host.current,
    control: host.control,
    progress: host.progress,
  });
  const progress = budget.progress;
  progress(`正在写「${scene.title}」的镜头。`);
  let shots: FilmShot[] | null = null;
  let notice: string;
  let retry: Extract<DirectorDraftResult, { status: "complete" }>["retry"];
  let event: Extract<DirectorDraftResult, { status: "complete" }>["event"];
  try {
    if (!host.connected) {
      shots = offlineShots(story, sceneId);
      notice = "没有登录，已用离线拆镜。点「写入分镜」才会写入。";
      event = "offline";
    } else {
      const first = await budget.run(() =>
        requestDirectorDraft(input, {
          ...host,
          current: budget.current,
          control: budget.control,
          progress,
          notify: (message) => {
            if (budget.current()) host.notify?.(message);
          },
        }),
      );
      if (!host.current()) return { status: "stale" };
      if (!first.shots) {
        retry = {
          role: "director",
          context: input.context,
          instruction:
            '只返回 JSON，不要解释。格式：{"shots":[{"picture":"","size":"全景","seconds":5}]}',
        };
        notice = `${first.detail || "导演这次没有给出能用的镜头。"} 没有写入镜头。`;
        event = "rejected";
      } else {
        progress(`已写 ${first.shots.length} 镜，正在写表演。`);
        shots = first.shots;
        shots = await budget.run(() =>
          host.enrich(base, sceneId, first.shots!, budget.current, budget.control),
        );
        notice = sceneNeedsSource(scene.text)
          ? "这一场几乎没有台词和动作，镜头可能对不上原文。导演拆好了。点「写入分镜」才会写入。"
          : "导演拆好了。点「写入分镜」才会写入。";
        event = "shots";
      }
    }
  } catch {
    notice =
      budget.reason() === "TEXT_TIMEOUT"
        ? `${NOTICE_TEXT.TEXT_TIMEOUT}${shots ? " 已保留导演初稿，补充尚未完成。" : ""}`
        : "模型没有返回。没有写入镜头。";
    if (shots) event = "partial";
    if (budget.reason() === "TEXT_TIMEOUT" && host.current())
      host.notify?.({ code: "TEXT_TIMEOUT", text: NOTICE_TEXT.TEXT_TIMEOUT });
  } finally {
    budget.dispose();
  }
  if (!host.current() || ["REQUEST_STALE", "TEXT_CANCELLED"].includes(budget.reason()))
    return { status: "stale" };
  const warnings = host.warnings();
  if (warnings.length) notice += ` ${[...new Set(warnings)].join(" ")}`;
  const coverage = shots ? detectDirectorCoverage(scene, shots) : null;
  const target = shots ? directorPlanStatus(scene, shots).target : 16;
  const coverageMessage = coverage && !coverage.ok ? coverageNotice(coverage) : undefined;
  if (coverageMessage) notice += ` ${coverageMessage.text} ${coverageMessage.detail}`;
  else if (shots && shots.length > target)
    notice += ` 为保留全部台词和结尾，保留 ${shots.length} 镜，超过建议 ${target} 镜。`;
  return {
    status: "complete",
    shots,
    notice,
    retry,
    coverage,
    coverageNotice: coverageMessage,
    target,
    event,
  };
}
