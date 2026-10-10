import { useState } from "react";
import type { OfficialDirectorContent } from "@aijian/contracts/official-director";

const framing = {
  EXTREME_WIDE: "大远景",
  WIDE: "远景",
  MEDIUM: "中景",
  CLOSE_UP: "近景",
  EXTREME_CLOSE_UP: "特写",
};
const coverage = {
  ACTION: "动作",
  DIALOGUE: "对白",
  ESTABLISHING: "建立场景",
  REACTION: "反应",
  TRANSITION: "转场",
};

/** Typed provider plan is immutable here. Editable fields exist only after explicit adoption. */
export function OfficialDirectorPlanPreview({ content }: { content: OfficialDirectorContent }) {
  const [selection, setSelection] = useState<string | null>(null);
  const shot = content.shots.find((item) => item.shot_id === selection) ?? content.shots[0];
  return (
    <div className="storyboard-layout official-director-plan" aria-label="AI 导演镜头计划只读预览">
      <aside className="storyboard-shot-list">
        <header>
          <h3>提案镜头</h3>
          <span>
            {content.shots.length} 个 · {content.timebase.frame_rate.num}/
            {content.timebase.frame_rate.den} fps
          </span>
        </header>
        <ol>
          {content.shots.map((item) => (
            <li key={item.shot_id}>
              <button
                type="button"
                aria-pressed={item.shot_id === shot?.shot_id}
                onClick={() => setSelection(item.shot_id)}
              >
                <span>{String(item.ordinal).padStart(2, "0")}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.duration_frames} 帧 ·{" "}
                    {item.coverage.map((value) => coverage[value]).join("、")}
                  </small>
                </div>
              </button>
            </li>
          ))}
        </ol>
      </aside>
      <section className="storyboard-detail-scroll" aria-label="所选 AI 镜头详情">
        {shot && (
          <>
            <h3>
              镜头 {shot.ordinal} · {shot.title}
            </h3>
            <p>
              {framing[shot.framing]} · {shot.duration_frames} 帧 · {content.timebase.timecode_mode}
            </p>
            <dl>
              {(
                [
                  ["叙事目的", shot.narrative_purpose],
                  ["覆盖用途", shot.coverage.map((value) => coverage[value]).join("、")],
                  ["构图与安全区意图", shot.composition],
                  ["表演意图", shot.performance],
                  ["主体运动", shot.movement.subject],
                  ["环境运动", shot.movement.environment],
                  ["相机运动", shot.movement.camera],
                  ["连续性 Before", shot.start_state],
                  ["连续性 After", shot.end_state],
                  ["节奏", shot.rhythm],
                  ["声音与对白意图", shot.sound_intent],
                  [
                    "手柄与安全切区",
                    `入 ${shot.handle_in_frames} 帧 / 出 ${shot.handle_out_frames} 帧 · [${shot.safe_cut_window.start_frame}, ${shot.safe_cut_window.end_frame})`,
                  ],
                  ["原剧本场景", shot.script_scene_id],
                  ["覆盖的原剧本块", shot.script_block_ids.join("、")],
                  ["原对白块", shot.dialogue_block_ids.join("、") || "无"],
                  ["稳定镜头身份", shot.shot_id],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p>视觉约束：{content.visual_constraints.join("；") || "未声明"}</p>
          </>
        )}
      </section>
    </div>
  );
}
