import { useState } from "react";
import { Button } from "./Common";
import { CharacterReferencePreview } from "./CharacterReferencePreview";
import { useCharacterReferenceAssets } from "./useCharacterReferenceAssets";
import { newCreativeId } from "./adapters/creativeLibrary";
import { withCreativeEnvironment } from "./adapters/creativeEnvironment";
import type { EnvironmentEditorProps } from "./SceneVariants";
import { Select } from "./Select";

export function EnvironmentReferences({
  content,
  sceneId,
  variantId,
  locked,
  edit,
  onNotice,
}: EnvironmentEditorProps & { variantId: string | null }) {
  const { state, refresh, gateway } = useCharacterReferenceAssets(content.project_id);
  const [assetId, setAssetId] = useState("");
  const [versionId, setVersionId] = useState("");
  const refs = content.schema_version === "1.3.0" ? content.environment_references : [];
  const own = refs.filter((item) => item.scene_id === sceneId && item.variant_id === variantId);
  const assets = state.kind === "READY" ? state.assets : null;
  const asset = assets?.find((item) => item.id === assetId);
  const version = asset?.versions.find((item) => item.id === versionId);
  const ready =
    !locked &&
    !!asset &&
    !!version &&
    ["image", "video"].includes(version.kind) &&
    version.availability === "VERIFIED" &&
    refs.length < 2000;
  function add() {
    if (!ready || !asset || !version || asset.project_id !== content.project_id) return;
    const id = newCreativeId("erf");
    if (!id) {
      onNotice("无法生成可靠环境参考标识，未关联。");
      return;
    }
    edit((current) => {
      const next = withCreativeEnvironment(current);
      if (
        sceneId !== null &&
        (!next.scenes.some((item) => item.scene_id === sceneId) ||
          (variantId !== null &&
            !next.scene_variants.some(
              (item) => item.scene_id === sceneId && item.variant_id === variantId,
            )))
      )
        return current;
      return {
        ...next,
        environment_references: [
          ...next.environment_references,
          {
            reference_id: id,
            ordinal: next.environment_references.length + 1,
            scene_id: sceneId,
            variant_id: variantId,
            asset_id: asset.id,
            asset_version_id: version.id,
            asset_sha256: version.sha256,
            label: "",
          },
        ],
      };
    });
    setVersionId("");
  }
  return (
    <section
      className="character-detail-section"
      aria-label={sceneId === null ? "世界真实参考" : "场景真实参考"}
    >
      <header>
        <h3>{sceneId === null ? "世界真实参考" : variantId ? "状态真实参考" : "地点真实参考"}</h3>
        <Button disabled={state.kind === "LOADING"} onClick={() => void refresh()}>
          刷新登记素材
        </Button>
      </header>
      <p>
        明确关联作品素材的精确版本，保存时重新校验原件。关联不替代权利核对、上传授权或制作批准，也不会开始生成。
      </p>
      {state.kind !== "READY" && (
        <p role="status">
          {state.kind === "LOADING"
            ? "正在读取登记素材…"
            : "素材状态未知或回执未核对；已有参考保留，不能新增关联。"}
        </p>
      )}
      {assets?.length === 0 && <p role="status">作品素材库为空，请先导入真实素材。</p>}
      <fieldset disabled={locked || !assets} className="manual-creative-fields">
        <label>
          环境参考素材
          <Select
            value={assetId}
            onChange={(event) => {
              setAssetId(event.currentTarget.value);
              setVersionId("");
            }}
          >
            <option value="">明确选择已登记素材</option>
            {assets
              ?.filter((item) => item.versions.some((v) => ["image", "video"].includes(v.kind)))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.latest_version.filename}
                </option>
              ))}
          </Select>
        </label>
        <label>
          环境参考版本
          <Select value={versionId} onChange={(event) => setVersionId(event.currentTarget.value)}>
            <option value="">明确选择素材版本</option>
            {asset?.versions
              .filter((item) => ["image", "video"].includes(item.kind))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  v{item.ordinal} · {item.filename} · {item.sha256.slice(0, 12)}
                </option>
              ))}
          </Select>
        </label>
        <Button disabled={!ready} onClick={add}>
          关联环境参考
        </Button>
      </fieldset>
      {own.map((item) => {
        const asset = assets?.find((a) => a.id === item.asset_id);
        const original = asset?.versions.find(
          (v) => v.id === item.asset_version_id && v.sha256 === item.asset_sha256,
        );
        const warning = !assets
          ? "素材状态未知，历史关联保留"
          : !original
            ? "精确版本或hash不符，历史关联保留"
            : original.availability !== "VERIFIED"
              ? "原件缺失、变更或尚未核验，历史关联保留"
              : null;
        return (
          <div key={item.reference_id} className="character-detail-record">
            <label>
              环境参考说明
              <input
                value={item.label}
                maxLength={120}
                required
                disabled={locked}
                onChange={(event) => {
                  const label = event.currentTarget.value;
                  edit((current) =>
                    current.schema_version === "1.3.0"
                      ? {
                          ...current,
                          environment_references: current.environment_references.map((ref) =>
                            ref.reference_id === item.reference_id ? { ...ref, label } : ref,
                          ),
                        }
                      : current,
                  );
                }}
              />
            </label>
            <p>{original?.filename ?? "历史环境参考"}</p>
            <code>
              {item.reference_id}
              <br />
              {item.asset_id}
              <br />
              {item.asset_version_id}
              <br />
              {item.asset_sha256}
            </code>
            <p className="manual-creative-muted">
              {warning ??
                `原件身份已核对；权利状态：${original?.rights_status}，关联不授权使用或上传。`}
            </p>
            {original && !warning && (
              <CharacterReferencePreview
                projectId={content.project_id}
                assetId={item.asset_id}
                version={original}
                gateway={gateway}
              />
            )}
            <Button
              disabled={locked}
              onClick={() =>
                edit((current) =>
                  current.schema_version === "1.3.0"
                    ? {
                        ...current,
                        environment_references: current.environment_references
                          .filter((ref) => ref.reference_id !== item.reference_id)
                          .map((ref, i) => ({ ...ref, ordinal: i + 1 })),
                      }
                    : current,
                )
              }
            >
              移除环境参考
            </Button>
          </div>
        );
      })}
    </section>
  );
}
