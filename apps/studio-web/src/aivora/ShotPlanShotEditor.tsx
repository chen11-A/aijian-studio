import type { ShotPlanPreparation, ShotPlanShot } from "@aijian/contracts/shot-plan";

const framingNames = {
  EXTREME_WIDE: "大远景",
  WIDE: "远景",
  MEDIUM: "中景",
  CLOSE_UP: "近景",
  EXTREME_CLOSE_UP: "特写",
} as const;
const coverageNames = {
  ACTION: "关键动作",
  DIALOGUE: "对白",
  ESTABLISHING: "建立场景",
  REACTION: "反应",
  TRANSITION: "转场",
} as const;
type IntentionField =
  | "narrative_purpose"
  | "composition"
  | "performance"
  | "start_state"
  | "end_state"
  | "rhythm"
  | "sound_intent";
const intentionFields: [IntentionField, string][] = [
  ["narrative_purpose", "叙事目的"],
  ["composition", "构图"],
  ["performance", "表演意图"],
  ["start_state", "起始状态"],
  ["end_state", "结束状态"],
  ["rhythm", "节奏"],
  ["sound_intent", "声音意图（未生成音频）"],
];

export function ShotPlanShotEditor({
  shot,
  preparation,
  disabled,
  update,
}: {
  shot: ShotPlanShot;
  preparation: ShotPlanPreparation | null;
  disabled: boolean;
  update: (patch: Partial<ShotPlanShot>) => void;
}) {
  const scenes =
    preparation?.script_content.scenes.filter((scene) => scene.blocks.length > 0) ?? [];
  const scene = scenes.find((item) => item.scene_id === shot.script_scene_id);
  function chooseBlocks(ids: string[]) {
    const blocks = scene?.blocks.filter((block) => ids.includes(block.block_id)) ?? [];
    const kinds = [...new Set(blocks.map((block) => block.kind))];
    update({
      script_block_ids: ids,
      dialogue_block_ids: blocks
        .filter((block) => block.kind === "DIALOGUE")
        .map((block) => block.block_id),
      coverage: [...new Set([...shot.coverage, ...kinds])],
    });
  }
  return (
    <fieldset className="storyboard-fields" disabled={disabled}>
      <legend className="shot-plan-legend">镜头 {shot.ordinal} · 人工编排</legend>
      <label>
        镜头标题
        <input
          value={shot.title}
          maxLength={240}
          onChange={(event) => update({ title: event.target.value })}
        />
      </label>
      {preparation ? (
        <>
          <label>
            剧本场景
            <select
              value={shot.script_scene_id}
              onChange={(event) => {
                const next = scenes.find((item) => item.scene_id === event.target.value);
                if (!next) return;
                update({
                  script_scene_id: next.scene_id,
                  script_block_ids: next.blocks.map((block) => block.block_id),
                  dialogue_block_ids: next.blocks
                    .filter((block) => block.kind === "DIALOGUE")
                    .map((block) => block.block_id),
                  coverage: [...new Set(next.blocks.map((block) => block.kind))],
                });
              }}
            >
              {scenes.map((item) => (
                <option key={item.scene_id} value={item.scene_id}>
                  {item.ordinal}. {item.heading}
                </option>
              ))}
            </select>
          </label>
          <div className="shot-plan-block-choices" role="group" aria-label="镜头引用的剧本块">
            <p>选择本镜覆盖的动作和对白，原文与稳定引用会一起保留。</p>
            {scene?.blocks.map((block) => (
              <label key={block.block_id}>
                <input
                  type="checkbox"
                  checked={shot.script_block_ids.includes(block.block_id)}
                  onChange={(event) =>
                    chooseBlocks(
                      event.target.checked
                        ? [...shot.script_block_ids, block.block_id]
                        : shot.script_block_ids.filter((id) => id !== block.block_id),
                    )
                  }
                />
                <span>
                  {block.kind === "DIALOGUE" ? `${block.speaker}：` : "动作："}
                  {block.text}
                </span>
              </label>
            ))}
          </div>
        </>
      ) : (
        <div className="shot-plan-block-choices" role="group" aria-label="历史镜头稳定引用">
          <p>当前剧本输入已更新或未载入，未将新版原文冒充历史引用。</p>
          <p>历史场景：{shot.script_scene_id}</p>
          <p>历史剧本块标识：</p>
          <ul>
            {shot.script_block_ids.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
          <p>历史对白块标识：{shot.dialogue_block_ids.join("、") || "无"}</p>
        </div>
      )}
      <div className="shot-plan-inline-fields">
        <label>
          景别
          <select
            value={shot.framing}
            onChange={(event) => {
              const framing = event.target.value;
              if (Object.hasOwn(framingNames, framing))
                update({ framing: framing as ShotPlanShot["framing"] });
            }}
          >
            {Object.entries(framingNames).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          时长（整数帧）
          <input
            type="number"
            min={1}
            max={864000}
            step={1}
            value={shot.duration_frames}
            onChange={(event) => {
              const duration = Number(event.target.value);
              if (Number.isSafeInteger(duration) && duration > 0)
                update({
                  duration_frames: duration,
                  safe_cut_window: {
                    ...shot.safe_cut_window,
                    end_frame: duration - shot.handle_out_frames,
                  },
                });
            }}
          />
        </label>
      </div>
      <div className="shot-plan-coverage" role="group" aria-label="镜头覆盖用途">
        {Object.entries(coverageNames).map(([value, name]) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={shot.coverage.includes(value as ShotPlanShot["coverage"][number])}
              onChange={(event) => {
                const coverage = value as ShotPlanShot["coverage"][number];
                update({
                  coverage: event.target.checked
                    ? [...shot.coverage, coverage]
                    : shot.coverage.filter((item) => item !== coverage),
                });
              }}
            />
            {name}
          </label>
        ))}
      </div>
      {intentionFields.map(([field, name]) => (
        <label key={field}>
          {name}
          <textarea
            rows={2}
            maxLength={4000}
            value={shot[field]}
            onChange={(event) => update({ [field]: event.target.value })}
          />
        </label>
      ))}
      <details>
        <summary>运动意图、手柄与安全切区</summary>
        <div className="storyboard-fields shot-plan-advanced">
          {(["subject", "environment", "camera"] as const).map((field) => (
            <label key={field}>
              {{ subject: "主体运动", environment: "环境运动", camera: "相机运动" }[field]}
              <textarea
                rows={2}
                maxLength={field === "camera" ? 160 : 4000}
                value={shot.movement[field]}
                onChange={(event) =>
                  update({ movement: { ...shot.movement, [field]: event.target.value } })
                }
              />
            </label>
          ))}
          <div className="shot-plan-inline-fields">
            {(["handle_in_frames", "handle_out_frames"] as const).map((field) => (
              <label key={field}>
                {field === "handle_in_frames" ? "入手柄（帧）" : "出手柄（帧）"}
                <input
                  type="number"
                  min={0}
                  max={864000}
                  step={1}
                  value={shot[field]}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isSafeInteger(value) && value >= 0) update({ [field]: value });
                  }}
                />
              </label>
            ))}
            {(["start_frame", "end_frame"] as const).map((field) => (
              <label key={field}>
                {field === "start_frame" ? "安全切区起点（含）" : "安全切区终点（不含）"}
                <input
                  type="number"
                  min={0}
                  max={864000}
                  step={1}
                  value={shot.safe_cut_window[field]}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isSafeInteger(value) && value >= 0)
                      update({ safe_cut_window: { ...shot.safe_cut_window, [field]: value } });
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      </details>
    </fieldset>
  );
}
