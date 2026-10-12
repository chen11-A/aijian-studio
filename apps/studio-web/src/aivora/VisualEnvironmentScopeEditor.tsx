import type { VisualContent } from "@aijian/contracts/visual-bible";
import type { CreativeVersion } from "./adapters/creativeLibrary";

export function VisualEnvironmentScopeEditor({
  content,
  library,
  locked,
  edit,
}: {
  content: VisualContent;
  library: CreativeVersion["content"];
  locked: boolean;
  edit: (update: (v: VisualContent) => VisualContent) => void;
}) {
  if (library.schema_version !== "1.3.0")
    return <p>此精确设定版本没有独立环境状态合同。旧视觉批准保持原范围。</p>;
  const scope = content.schema_version === "1.1.0" ? content.environment_scope : null;
  return (
    <fieldset disabled={locked} aria-label="明确环境审查范围">
      <legend>世界与地点状态人工审查范围</legend>
      {!scope ? (
        <>
          <p>此版本的旧 G5 只覆盖基础视觉。扩展范围需要另存新候选，再检查、送审和批准。</p>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "把当前候选扩展为独立环境审查版本？原批准保持原范围，新范围需要另存并重新人工审签。",
                )
              )
                edit((v) =>
                  v.schema_version === "1.0.0"
                    ? {
                        ...v,
                        schema_version: "1.1.0",
                        environment_scope: {
                          world_included: true,
                          scene_variant_ids: [],
                          environment_reference_ids: [],
                        },
                      }
                    : v,
                );
            }}
          >
            明确扩展候选环境范围
          </button>
        </>
      ) : (
        <>
          <p>完整世界文本纳入本次审查。空状态和参考清单只声明空范围；不会批准库中的其他状态。</p>
          <dl>
            {Object.entries(library.world).map(([k, v]) => (
              <div key={k}>
                <dt>
                  {
                    {
                      premise: "世界前提",
                      rules: "世界规则",
                      era: "时代",
                      visual_style: "视觉风格",
                      palette: "色彩",
                      materials: "材质",
                    }[k]
                  }
                </dt>
                <dd>{v || "本版为空"}</dd>
              </div>
            ))}
          </dl>
          {library.scene_variants
            .filter((s) => content.scenes.some((c) => c.scene_id === s.scene_id))
            .map((state) => (
              <article key={state.variant_id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`审查状态：${state.name}`}
                    checked={scope.scene_variant_ids.includes(state.variant_id)}
                    onChange={(e) => {
                      const selected = e.currentTarget.checked;
                      const related = library.environment_references
                        .filter((r) => r.variant_id === state.variant_id)
                        .map((r) => r.reference_id);
                      if (
                        !selected &&
                        scope.environment_reference_ids.some((id) => related.includes(id)) &&
                        !window.confirm("移除此状态及其候选审查参考？历史批准保留。")
                      )
                        return;
                      edit((v) =>
                        v.schema_version === "1.1.0"
                          ? {
                              ...v,
                              environment_scope: {
                                ...v.environment_scope,
                                scene_variant_ids: selected
                                  ? [...v.environment_scope.scene_variant_ids, state.variant_id]
                                  : v.environment_scope.scene_variant_ids.filter(
                                      (id) => id !== state.variant_id,
                                    ),
                                environment_reference_ids: selected
                                  ? v.environment_scope.environment_reference_ids
                                  : v.environment_scope.environment_reference_ids.filter(
                                      (id) => !related.includes(id),
                                    ),
                              },
                            }
                          : v,
                      );
                    }}
                  />
                  {state.name} · {state.variant_id}
                </label>
                <p>
                  {state.view} · {state.time_of_day} · {state.weather}
                </p>
                <p>{state.state}</p>
                <p>连续性：{state.continuity}</p>
                {scope.scene_variant_ids.includes(state.variant_id) &&
                  !library.environment_references.some(
                    (r) =>
                      r.variant_id === state.variant_id &&
                      scope.environment_reference_ids.includes(r.reference_id),
                  ) && <p>此状态缺少明确选中的状态专属真实参考，不能送审。</p>}
              </article>
            ))}
          {library.environment_references
            .filter(
              (r) => r.scene_id === null || content.scenes.some((s) => s.scene_id === r.scene_id),
            )
            .map((ref) => (
              <label key={ref.reference_id}>
                <input
                  type="checkbox"
                  aria-label={`审查环境参考：${ref.label}`}
                  disabled={
                    locked ||
                    (ref.variant_id !== null && !scope.scene_variant_ids.includes(ref.variant_id))
                  }
                  checked={scope.environment_reference_ids.includes(ref.reference_id)}
                  onChange={(e) => {
                    const chosen = e.currentTarget.checked;
                    edit((v) =>
                      v.schema_version === "1.1.0"
                        ? {
                            ...v,
                            environment_scope: {
                              ...v.environment_scope,
                              environment_reference_ids: chosen
                                ? [
                                    ...v.environment_scope.environment_reference_ids,
                                    ref.reference_id,
                                  ]
                                : v.environment_scope.environment_reference_ids.filter(
                                    (id) => id !== ref.reference_id,
                                  ),
                            },
                          }
                        : v,
                    );
                  }}
                />
                {ref.label} · {ref.scene_id === null ? "世界" : ref.variant_id ? "状态" : "地点"} ·{" "}
                {ref.asset_id} / {ref.asset_version_id} / {ref.asset_sha256}
              </label>
            ))}
        </>
      )}
    </fieldset>
  );
}
