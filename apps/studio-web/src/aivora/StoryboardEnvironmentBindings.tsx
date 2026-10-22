import type { CreativeVersion } from "./adapters/creativeLibrary";
import {
  sameStoryboardJson,
  withStoryboardEnvironment,
  type StoryboardContent,
  type StoryboardShot,
} from "./adapters/episodeStoryboard";
import {
  shotEnvironment,
  environmentReferencesForState,
  type EnvironmentBinding,
} from "./adapters/storyboardEnvironment";
import { useCharacterReferenceAssets } from "./useCharacterReferenceAssets";
import { CharacterReferencePreview } from "./CharacterReferencePreview";
import { useStoryboardEnvironmentApproval } from "./useStoryboardEnvironmentApproval";
import { Select } from "./Select";

export function StoryboardEnvironmentBindings({
  content,
  shot,
  library,
  locked,
  edit,
}: {
  content: StoryboardContent;
  shot: StoryboardShot;
  library: CreativeVersion | null;
  locked: boolean;
  edit: (update: (value: StoryboardContent) => StoryboardContent) => void;
}) {
  const { state, gateway, refresh } = useCharacterReferenceAssets(content.project_id);
  const pinned =
    library?.project_id === content.project_id &&
    library.version_id === content.creative_library_version_id
      ? library
      : null;
  const details = pinned?.content.schema_version === "1.3.0" ? pinned.content : null;
  const binding = shotEnvironment(shot),
    g5 = "visual_bible_pin" in content && content.visual_bible_pin !== null;
  const approval = useStoryboardEnvironmentApproval(content, pinned);
  const references = pinned
    ? environmentReferencesForState(pinned, shot.location_id, binding.variant_id).filter(
        (r) => !g5 || !!approval.scope?.environment_reference_ids.includes(r.reference_id),
      )
    : [];
  const disabled = locked || !details || (g5 && !approval.scope);
  const allowedStates =
    details?.scene_variants.filter(
      (item) =>
        item.scene_id === shot.location_id &&
        (!g5 || !!approval.scope?.scene_variant_ids.includes(item.variant_id)),
    ) ?? [];
  function update(next: EnvironmentBinding) {
    if (disabled || !pinned) return;
    edit((current) => {
      const target = current.shots.find((item) => item.shot_id === shot.shot_id);
      if (
        current.project_id !== content.project_id ||
        current.episode_id !== content.episode_id ||
        current.creative_library_version_id !== pinned.version_id ||
        !target ||
        target.location_id !== shot.location_id ||
        !sameStoryboardJson(shotEnvironment(target), binding) ||
        !sameStoryboardJson(
          "visual_bible_pin" in current ? current.visual_bible_pin : null,
          "visual_bible_pin" in content ? content.visual_bible_pin : null,
        ) ||
        (g5 &&
          (!approval.scope ||
            (next.variant_id !== null &&
              !approval.scope.scene_variant_ids.includes(next.variant_id)) ||
            next.reference_ids.some(
              (id) => !approval.scope!.environment_reference_ids.includes(id),
            )))
      )
        return current;
      return withStoryboardEnvironment(current, shot.shot_id, next);
    });
  }
  function stateChoice(variantId: string | null) {
    if (!pinned || disabled) return;
    const allowed = new Set(
      environmentReferencesForState(pinned, shot.location_id, variantId).map(
        (ref) => ref.reference_id,
      ),
    );
    const reference_ids = binding.reference_ids.filter((id) => allowed.has(id)),
      removed = binding.reference_ids.length - reference_ids.length;
    if (
      removed &&
      !window.confirm(`更换状态会移除当前镜头草稿的 ${removed} 个不兼容环境参考；历史版本保留。`)
    )
      return;
    update({ variant_id: variantId, reference_ids });
  }
  return (
    <>
      <button
        type="button"
        disabled={locked || state.kind === "LOADING"}
        onClick={() => void refresh()}
      >
        核对环境参考原件
      </button>
      {g5 && (
        <button type="button" disabled={locked} onClick={approval.refresh}>
          核对环境批准范围
        </button>
      )}
      <fieldset
        disabled={disabled}
        aria-label="镜头环境状态与参考草稿选用"
        className="storyboard-characters"
      >
        <legend>镜头环境状态与参考草稿选用</legend>
        <p>
          固定共享设定中的地点状态、世界/地点/状态参考，随同一分镜版本保存；保存和新装配消费时重新核对原件。手工选用不表示G5批准或媒体已生成。
        </p>
        {!details && <p>固定设定版本尚未核对或没有环境状态合同，原选用保留。</p>}
        {g5 && !approval.scope && (
          <p>
            当前G5范围未批准独立环境选用；请保留原批准，或显式解除G5后编辑手工草稿，不能自动扩展批准范围。
          </p>
        )}
        {g5 && approval.scope && (
          <p>独立环境批准已核对；只显示此精确批准的状态与适用参考。新保存会再次核对批准及原件。</p>
        )}
        <label>
          本镜地点状态
          <Select
            aria-label="本镜地点状态"
            disabled={disabled || !shot.location_id}
            value={binding.variant_id ?? ""}
            onChange={(event) => stateChoice(event.currentTarget.value || null)}
          >
            <option value="">不选用独立状态</option>
            {binding.variant_id &&
              !allowedStates.some((s) => s.variant_id === binding.variant_id) && (
                <option value={binding.variant_id} disabled>
                  原状态 {binding.variant_id}（范围尚未核对）
                </option>
              )}
            {allowedStates.map((item) => (
              <option key={item.variant_id} value={item.variant_id}>
                {item.name} · {item.view} · {item.time_of_day} · {item.weather}
              </option>
            ))}
          </Select>
        </label>
        {binding.variant_id &&
          !allowedStates.some(
            (item) => item.variant_id === binding.variant_id && item.scene_id === shot.location_id,
          ) && <p>现有状态标识 {binding.variant_id} 尚未在固定版本中核对，未回退到首项。</p>}
        {references.map((ref) => {
          const chosen = binding.reference_ids.includes(ref.reference_id);
          const asset =
            state.kind === "READY" ? state.assets.find((item) => item.id === ref.asset_id) : null;
          const version = asset?.versions.find((item) => item.id === ref.asset_version_id);
          const usable =
            !!version &&
            version.sha256 === ref.asset_sha256 &&
            ["image", "video"].includes(version.kind) &&
            version.availability === "VERIFIED" &&
            version.rights_status !== "RESTRICTED";
          return (
            <div key={ref.reference_id}>
              <label>
                <input
                  type="checkbox"
                  aria-label={`环境参考：${ref.label}`}
                  checked={chosen}
                  disabled={disabled || (!chosen && !usable)}
                  onChange={(event) =>
                    update({
                      ...binding,
                      reference_ids: event.currentTarget.checked
                        ? [...binding.reference_ids, ref.reference_id]
                        : binding.reference_ids.filter((id) => id !== ref.reference_id),
                    })
                  }
                />
                {ref.label} · {ref.scene_id === null ? "世界" : ref.variant_id ? "状态" : "地点"} ·{" "}
                {ref.asset_version_id} · {ref.asset_sha256.slice(0, 12)}
              </label>
              {!usable && <p>精确原件尚未可靠核对或已失效；现有选用保留，不替换新版。</p>}
              {usable && version && (
                <CharacterReferencePreview
                  projectId={content.project_id}
                  assetId={ref.asset_id}
                  version={version}
                  gateway={gateway}
                />
              )}
            </div>
          );
        })}
        {binding.reference_ids
          .filter((id) => !references.some((ref) => ref.reference_id === id))
          .map((id) => (
            <p key={id}>原环境参考 {id} 尚未在固定状态范围中核对，原选用保留。</p>
          ))}
        {!references.length && details && <p>此世界/地点/状态范围没有已保存环境参考。</p>}
      </fieldset>
    </>
  );
}
