import { Button } from "./Common";
import { OfficialDirectorInputProof } from "./OfficialDirectorInputProof";
import type { useOfficialDirectorProposals } from "./useOfficialDirectorProposals";

export function OfficialDirectorGenerationForm({
  state,
  connected,
}: {
  state: ReturnType<typeof useOfficialDirectorProposals>;
  connected: boolean;
}) {
  const validOptions =
    !!state.intent.trim() &&
    [...state.intent].length <= 4000 &&
    (state.count === null ||
      (Number.isSafeInteger(state.count) && state.count >= 1 && state.count <= 1000));
  return (
    <>
      <div className="official-director-toolbar">
        <Button disabled={!connected || state.busy} onClick={() => void state.reload()}>
          只读核对记录与输入
        </Button>
        <Button disabled={!connected || state.busy} onClick={() => void state.loadModels()}>
          读取官方可用模型
        </Button>
        <label>
          官方模型
          <select
            value={state.model}
            disabled={state.busy || !state.models.length}
            onChange={(event) => state.setModel(event.target.value)}
          >
            <option value="">先读取当前账号模型</option>
            {state.models.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
        <Button
          primary
          disabled={state.locked || !state.preparation || !state.model || !validOptions}
          onClick={() => void state.generate()}
        >
          审阅输入并生成一次
        </Button>
      </div>
      <details className="official-director-options">
        <summary>生成选项与当前输入</summary>
        <div className="official-director-option-fields">
          <label>
            目标镜头数（留空由模型规划）
            <input
              type="number"
              min={1}
              max={1000}
              step={1}
              value={state.count ?? ""}
              disabled={state.busy}
              onChange={(event) =>
                state.setCount(event.target.value === "" ? null : Number(event.target.value))
              }
            />
          </label>
          <label>
            节奏
            <select
              value={state.pacing}
              disabled={state.busy}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "BALANCED" || value === "FAST" || value === "SLOW")
                  state.setPacing(value);
              }}
            >
              <option value="BALANCED">均衡</option>
              <option value="FAST">紧凑</option>
              <option value="SLOW">舒缓</option>
            </select>
          </label>
          <label className="official-director-intent">
            导演意图
            <textarea
              rows={2}
              maxLength={4000}
              value={state.intent}
              disabled={state.busy}
              onChange={(event) => state.setIntent(event.target.value)}
            />
          </label>
        </div>
        <p>
          发送已确认剧本、精确制作意图及这些选项。桌面确认窗会展示完整发送内容、模型和套餐使用；结果不会自动采纳。
        </p>
        {state.preparation && <OfficialDirectorInputProof input={state.preparation} />}
      </details>
    </>
  );
}
