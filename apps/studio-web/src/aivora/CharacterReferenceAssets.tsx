import { Button } from "./Common";
import { newCreativeId } from "./adapters/creativeLibrary";
import { withCreativeReferences } from "./adapters/creativeCharacterDetails";
import { useCharacterReferenceAssets } from "./useCharacterReferenceAssets";
import { CharacterReferencePicker } from "./CharacterReferencePicker";
import { CharacterReferenceRecords } from "./CharacterReferenceRecords";
import type { CharacterDetailsProps } from "./CharacterDetails";
import type { MediaAsset, AssetVersion } from "./adapters/assetLibrary";

export function CharacterReferenceAssets({
  content,
  characterId,
  locked,
  edit,
  onNotice,
}: CharacterDetailsProps) {
  const { state, refresh, gateway } = useCharacterReferenceAssets(content.project_id);
  const references =
    content.schema_version === "1.2.0" || content.schema_version === "1.3.0"
      ? content.references
      : [];
  const visualAssets =
    state.kind === "READY"
      ? state.assets.filter((asset) =>
          asset.versions.some((version) => ["image", "video"].includes(version.kind)),
        )
      : [];
  const costumes =
    content.schema_version === "1.0.0"
      ? []
      : content.costumes.filter((item) => item.character_id === characterId);
  function add(asset: MediaAsset, version: AssetVersion, costumeId: string | null) {
    if (locked || references.length >= 2000 || asset.project_id !== content.project_id) return;
    const id = newCreativeId("crf");
    if (!id) {
      onNotice("无法生成可靠参考标识，未关联。");
      return;
    }
    edit((current) => {
      const details = withCreativeReferences(current);
      const old = details.references;
      return {
        ...details,
        references: [
          ...old,
          {
            reference_id: id,
            ordinal: old.length + 1,
            character_id: characterId,
            costume_id: costumeId,
            asset_id: asset.id,
            asset_version_id: version.id,
            asset_sha256: version.sha256,
            label: "",
          },
        ],
      };
    });
  }
  const message =
    state.kind === "LOADING"
      ? "正在读取登记素材…"
      : state.kind === "REMOTE_UNKNOWN"
        ? "素材读取结果待核对，现有参考保留"
        : state.kind === "INVALID_RESPONSE"
          ? "素材回执不一致，现有参考保留"
          : state.kind === "UNAVAILABLE"
            ? "桌面素材接口暂不可用，现有参考保留"
            : state.kind === "DEFINITE_SERVER_ERROR"
              ? `素材读取被拒绝（${state.code}），现有参考保留`
              : state.kind !== "READY"
                ? "素材读取尚未完成，现有参考保留"
                : !state.assets.length
                  ? "作品素材库为空"
                  : !visualAssets.length
                    ? "素材库尚无图片或视频参考"
                    : "";
  return (
    <section className="character-detail-section" aria-label="真实参考素材">
      <header>
        <h3>真实参考素材</h3>
        <Button disabled={state.kind === "LOADING"} onClick={() => void refresh()}>
          刷新登记素材
        </Button>
      </header>
      <p className="manual-creative-muted">
        选择已导入作品素材库的明确版本。关联随草稿保存；保存时重新校验原文件。关联不表示身份锁定、权利批准或上传授权。
      </p>
      {message && <p role="status">{message}</p>}
      <CharacterReferencePicker
        key={`${content.project_id}:${characterId}`}
        assets={visualAssets}
        costumes={costumes}
        locked={locked || state.kind !== "READY" || references.length >= 2000}
        onAdd={add}
      />
      <CharacterReferenceRecords
        content={content}
        characterId={characterId}
        locked={locked}
        edit={edit}
        onNotice={onNotice}
        assets={state.kind === "READY" ? state.assets : null}
        gateway={gateway}
      />
    </section>
  );
}
