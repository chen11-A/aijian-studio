import type { CreativeVersion } from "./adapters/creativeLibrary";
import { useEffect, useState } from "react";
import { visualReadData } from "@aijian/contracts/visual-bible";
import { visualBrowserHash } from "./visualWorkspace";
import {
  withStoryboardShots,
  type StoryboardContent,
  type StoryboardShot,
} from "./adapters/episodeStoryboard";
import type { components } from "@aijian/contracts";
import { Select } from "./Select";

type Binding = components["schemas"]["EpisodeStoryboardCharacterBindingV1"];
export function StoryboardCharacterBindings({
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
  edit: (update: (content: StoryboardContent) => StoryboardContent) => void;
}) {
  const bindings = "character_bindings" in shot ? shot.character_bindings : [];
  const visualPin = "visual_bible_pin" in content ? content.visual_bible_pin : null;
  const visualKey = `${content.project_id}/${visualPin?.version_id ?? ""}/${visualPin?.content_hash ?? ""}`;
  const [approved, setApproved] = useState<{ key: string; ids: string[] }>();
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!visualPin) return;
      try {
        const result = await window.aijian?.getVisualBibleVersion?.(
          content.project_id,
          visualPin.version_id,
        );
        if (
          result?.kind === "FOUND" &&
          visualReadData(result.data, content.project_id) &&
          result.data.version.id === visualPin.version_id &&
          result.data.version.content_hash === visualPin.content_hash &&
          result.data.version.content.creative_library_version_id ===
            content.creative_library_version_id &&
          (await visualBrowserHash(result.data.version.content)) === visualPin.content_hash &&
          active
        )
          setApproved({ key: visualKey, ids: result.data.version.content.character_reference_ids });
      } catch {
        /* Unavailable approved scope leaves all existing choices intact. */
      }
    })();
    return () => {
      active = false;
    };
  }, [
    content.project_id,
    content.creative_library_version_id,
    visualPin?.version_id,
    visualPin?.content_hash,
    visualKey,
  ]);
  const approvedIds = approved?.key === visualKey ? approved.ids : null;
  const scopeUnavailable = !!visualPin && approvedIds === null;
  const verifiedLibrary =
    library?.project_id === content.project_id &&
    library.version_id === content.creative_library_version_id
      ? library
      : null;
  const details = verifiedLibrary?.content;
  const costumes = details && details.schema_version !== "1.0.0" ? details.costumes : [];
  const references =
    details?.schema_version === "1.2.0" || details?.schema_version === "1.3.0"
      ? details.references.filter((r) => !visualPin || approvedIds?.includes(r.reference_id))
      : [];
  function update(binding: Binding) {
    if (locked || !verifiedLibrary || scopeUnavailable) return;
    edit((current) => {
      if (
        current.project_id !== content.project_id ||
        current.episode_id !== content.episode_id ||
        current.creative_library_version_id !== verifiedLibrary.version_id
      )
        return current;
      return withStoryboardShots(
        current,
        current.shots.map((item) => {
          if (item.shot_id !== shot.shot_id || !item.character_ids.includes(binding.character_id))
            return item;
          const old = "character_bindings" in item ? item.character_bindings : [];
          const next = [
            ...old.filter((entry) => entry.character_id !== binding.character_id),
            binding,
          ];
          return { ...item, character_bindings: next };
        }),
      );
    });
  }
  return (
    <fieldset
      disabled={locked || !verifiedLibrary || scopeUnavailable}
      className="storyboard-characters"
      aria-label="镜头造型与参考草稿选用"
    >
      <legend>镜头造型与参考草稿选用</legend>
      <p>
        {visualPin
          ? "此分镜固定G5批准版本；选用必须属于其角色和服装参考范围，保存时重新核对。视觉批准不授权媒体生成或费用。"
          : "仅选用当前固定设定版本中的记录，随本集分镜保存。不表示身份锁定、G5批准或真实媒体生成。"}
      </p>
      {!verifiedLibrary && <p>固定版本尚未核对，现有选用保留。</p>}
      {scopeUnavailable && <p>固定G5参考范围尚未可靠读回；现有服装和参考选用保留，暂不能调整。</p>}
      {shot.character_ids.map((id) => {
        const name = details?.characters.find((item) => item.character_id === id)?.name ?? id;
        const binding = bindings.find((item) => item.character_id === id) ?? {
          character_id: id,
          costume_id: null,
          reference_ids: [],
        };
        const eligible = references.filter(
          (item) =>
            item.character_id === id &&
            (item.costume_id === null || item.costume_id === binding.costume_id),
        );
        return (
          <div key={id}>
            <label>
              {name} · 本镜服装
              <Select
                value={binding.costume_id ?? ""}
                aria-label={`${name}本镜服装`}
                onChange={(event) => {
                  const costumeId = event.currentTarget.value || null;
                  const retained = binding.reference_ids.filter((refId) =>
                    references.some(
                      (item) =>
                        item.reference_id === refId &&
                        (item.costume_id === null || item.costume_id === costumeId),
                    ),
                  );
                  const removed = binding.reference_ids.length - retained.length;
                  if (
                    removed &&
                    !window.confirm(
                      `更换本镜服装会移除当前草稿的 ${removed} 个不兼容参考选用；历史版本保留。`,
                    )
                  )
                    return;
                  update({ ...binding, costume_id: costumeId, reference_ids: retained });
                }}
              >
                <option value="">不选用服装记录</option>
                {costumes
                  .filter((item) => item.character_id === id)
                  .map((item) => (
                    <option key={item.costume_id} value={item.costume_id}>
                      {item.name}
                    </option>
                  ))}
              </Select>
            </label>
            {eligible.map((reference) => (
              <label key={reference.reference_id}>
                <input
                  type="checkbox"
                  aria-label={`${name}参考：${reference.label}`}
                  checked={binding.reference_ids.includes(reference.reference_id)}
                  onChange={(event) =>
                    update({
                      ...binding,
                      reference_ids: event.currentTarget.checked
                        ? [...binding.reference_ids, reference.reference_id]
                        : binding.reference_ids.filter((refId) => refId !== reference.reference_id),
                    })
                  }
                />
                {reference.label} · {reference.asset_version_id.slice(-8)} ·{" "}
                {reference.asset_sha256.slice(0, 12)}
              </label>
            ))}
            {!eligible.length && verifiedLibrary && (
              <small>此角色/服装在固定版本中没有可选参考。</small>
            )}
            {!verifiedLibrary &&
              binding.reference_ids.map((refId) => <code key={refId}>{refId}</code>)}
          </div>
        );
      })}
    </fieldset>
  );
}
