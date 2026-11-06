import type { FilmProject, FilmShot } from "../../film/project";
import { parseLooseJson, qcFromModel } from "../../film/phase2";
import { captureReviewInput, applyTextReview } from "../../film/review-report";
import type { AgentReply } from "../workflow";

export type TextReviewResult =
  | { status: "stale" }
  | { status: "blocked" }
  | { status: "rejected"; notice: string }
  | { status: "ready"; film: FilmProject; lines: string[] };

/** Text evidence only. The host owns the active turn, presentation and persistence. */
export async function reviewShotText(
  base: FilmProject,
  shot: FilmShot | undefined,
  host: {
    request: (agent: "qc", context: string, instruction: string) => Promise<AgentReply>;
    valid: () => boolean;
    current: () => FilmProject | null;
    apply: (film: FilmProject) => void;
  },
): Promise<TextReviewResult> {
  if (!shot) return { status: "rejected", notice: "先拆出镜头，再请审片。" };
  const context = JSON.stringify({
    shot_id: shot.id,
    picture: shot.picture,
    takes: shot.takes.map((take) => ({ take_id: take.id, status: take.status })),
  });
  const input = captureReviewInput(base, [shot.id], context);
  const reply = await host.request(
    "qc",
    context,
    "只审文字。没有提供任何帧图，你看不到画面。只输出 JSON，含 verdict、issues；若附 shots/takes 只能引用上下文已有 ID，seen_frames 必须为 false。建议不代表自动选版或修改。",
  );
  if (!host.valid()) return { status: "stale" };
  const value = reply.text ? parseLooseJson(reply.text) : null;
  const parsed = reply.text ? qcFromModel(value) : null;
  if (!parsed)
    return {
      status: "rejected",
      notice: `${reply.detail || "审片没有按格式返回。"} 还不能看画面，版本仍由你选。`,
    };
  const live = host.current();
  if (!live) return { status: "stale" };
  const reviewed = applyTextReview(live, input, value);
  if (reviewed.status !== "done") return { status: "blocked" };
  host.apply(reviewed.film);
  return { status: "ready", film: reviewed.film, lines: parsed.lines };
}
