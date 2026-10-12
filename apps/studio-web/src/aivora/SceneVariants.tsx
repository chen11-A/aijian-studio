import { useState } from "react";
import { Button } from "./Common";
import { newCreativeId } from "./adapters/creativeLibrary";
import type { CreativeContent } from "./adapters/creativeLibrary";
import { removeSceneVariant, withCreativeEnvironment } from "./adapters/creativeEnvironment";
import type { SceneVariant } from "./adapters/creativeEnvironment";
import { EnvironmentReferences } from "./EnvironmentReferences";

export type EnvironmentEditorProps = {
  content: CreativeContent;
  sceneId: string | null;
  locked: boolean;
  edit: (update: (current: CreativeContent) => CreativeContent) => void;
  onNotice: (message: string) => void;
};
const fields: {
  key: keyof Pick<
    SceneVariant,
    "name" | "view" | "time_of_day" | "weather" | "state" | "continuity"
  >;
  label: string;
  short?: boolean;
}[] = [
  { key: "name", label: "状态名称", short: true },
  { key: "view", label: "状态视角", short: true },
  { key: "time_of_day", label: "状态时间", short: true },
  { key: "weather", label: "状态天气", short: true },
  { key: "state", label: "环境状态" },
  { key: "continuity", label: "状态连续性" },
];
function selectionKey(projectId: string, sceneId: string | null) {
  return `aivora.creative-library.scene-state.v1.${projectId}.${sceneId}`;
}
function initialSelection(projectId: string, sceneId: string | null) {
  try {
    return window.sessionStorage.getItem(selectionKey(projectId, sceneId)) ?? "";
  } catch {
    return "";
  }
}
export function SceneVariants(props: EnvironmentEditorProps) {
  const { content, sceneId, locked, edit, onNotice } = props;
  const [selectedId, setSelectedId] = useState(() => initialSelection(content.project_id, sceneId));
  function select(id: string) {
    setSelectedId(id);
    try {
      window.sessionStorage.setItem(selectionKey(content.project_id, sceneId), id);
    } catch {
      /* Optional cursor; immutable state/reference content lives in the library. */
    }
  }
  const variants = content.schema_version === "1.3.0" ? content.scene_variants : [];
  const own = variants.filter((item) => item.scene_id === sceneId);
  const selected = own.find((item) => item.variant_id === selectedId);
  const scene = content.scenes.find((item) => item.scene_id === sceneId);
  function add() {
    if (locked || !scene || variants.length >= 2000) return;
    const id = newCreativeId("scv");
    if (!id) {
      onNotice("无法生成可靠状态标识，未新增。");
      return;
    }
    edit((current) => {
      const next = withCreativeEnvironment(current);
      return {
        ...next,
        scene_variants: [
          ...next.scene_variants,
          {
            variant_id: id,
            ordinal: next.scene_variants.length + 1,
            scene_id: scene.scene_id,
            name: "",
            view: "",
            time_of_day: scene.time_of_day,
            weather: scene.weather,
            state: "",
            continuity: scene.continuity,
          },
        ],
      };
    });
    select(id);
  }
  return (
    <section className="character-detail-section" aria-label="场景状态版本">
      <header>
        <h3>同地点状态</h3>
        <Button disabled={locked || variants.length >= 2000} onClick={add}>
          新增场景状态
        </Button>
      </header>
      <p>状态随同一作品设定版本保存，旧版保留。状态与实际参考仍需明确选用，保存不表示制作批准。</p>
      <label>
        查看场景状态
        <select
          value={selectedId}
          disabled={locked}
          onChange={(event) => select(event.currentTarget.value)}
        >
          <option value="">地点基础参考</option>
          {selectedId && !selected && <option value={selectedId}>所选状态未读回</option>}
          {own.map((item) => (
            <option key={item.variant_id} value={item.variant_id}>
              {item.name || "未命名状态"} · {item.variant_id}
            </option>
          ))}
        </select>
      </label>
      {selectedId && !selected && <p role="alert">所选状态不存在于当前设定，未回退或关联参考。</p>}
      {selected && (
        <div className="character-detail-record">
          <code>{selected.variant_id}</code>
          <fieldset disabled={locked} className="manual-creative-fields">
            {fields.map(({ key, label, short }) => (
              <label key={key}>
                {label}
                {short ? (
                  <input
                    value={selected[key]}
                    required={key === "name"}
                    maxLength={key === "name" ? 120 : 240}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      edit((current) =>
                        current.schema_version === "1.3.0"
                          ? {
                              ...current,
                              scene_variants: current.scene_variants.map((item) =>
                                item.variant_id === selected.variant_id
                                  ? { ...item, [key]: value }
                                  : item,
                              ),
                            }
                          : current,
                      );
                    }}
                  />
                ) : (
                  <textarea
                    rows={3}
                    value={selected[key]}
                    maxLength={20000}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      edit((current) =>
                        current.schema_version === "1.3.0"
                          ? {
                              ...current,
                              scene_variants: current.scene_variants.map((item) =>
                                item.variant_id === selected.variant_id
                                  ? { ...item, [key]: value }
                                  : item,
                              ),
                            }
                          : current,
                      );
                    }}
                  />
                )}
              </label>
            ))}
          </fieldset>
          <Button
            disabled={locked}
            onClick={() => {
              const refs =
                content.schema_version === "1.3.0"
                  ? content.environment_references.filter(
                      (item) => item.variant_id === selected.variant_id,
                    ).length
                  : 0;
              if (
                !window.confirm(
                  `删除当前草稿状态“${selected.name || "未命名状态"}”及其${refs}个参考关联吗？保存后旧版本保留。`,
                )
              )
                return;
              edit((current) => removeSceneVariant(current, selected.variant_id));
              select("");
            }}
          >
            删除场景状态
          </Button>
        </div>
      )}
      {(!selectedId || selected) && (
        <EnvironmentReferences key={selectedId} {...props} variantId={selectedId || null} />
      )}
    </section>
  );
}
