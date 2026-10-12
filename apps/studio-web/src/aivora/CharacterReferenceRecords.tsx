import { Button } from "./Common";
import { CharacterReferencePreview } from "./CharacterReferencePreview";
import type { CharacterDetailsProps } from "./CharacterDetails";
import type { AssetLibraryGateway, MediaAsset } from "./adapters/assetLibrary";

export function CharacterReferenceRecords({
  content,
  characterId,
  edit,
  locked,
  assets,
  gateway,
}: CharacterDetailsProps & {
  assets: MediaAsset[] | null;
  gateway: AssetLibraryGateway | undefined;
}) {
  if (content.schema_version !== "1.2.0" && content.schema_version !== "1.3.0") return null;
  return (
    <>
      {content.references
        .filter((item) => item.character_id === characterId)
        .map((item) => {
          const asset = assets?.find((asset) => asset.id === item.asset_id);
          const version = asset?.versions.find(
            (version) =>
              version.id === item.asset_version_id && version.sha256 === item.asset_sha256,
          );
          const warning = !assets
            ? "素材状态未知，关联保留"
            : !version
              ? "登记版本或hash不一致，关联保留"
              : version.availability === "MISSING"
                ? "原文件丢失，关联保留"
                : version.availability === "CORRUPT"
                  ? "原文件已变更，关联保留"
                  : null;
          return (
            <div key={item.reference_id} className="character-detail-record">
              <label>
                参考说明
                <input
                  value={item.label}
                  required
                  maxLength={120}
                  disabled={locked}
                  onChange={(event) => {
                    const label = event.currentTarget.value;
                    edit((current) =>
                      current.schema_version === "1.2.0" || current.schema_version === "1.3.0"
                        ? {
                            ...current,
                            references: current.references.map((reference) =>
                              reference.reference_id === item.reference_id
                                ? { ...reference, label }
                                : reference,
                            ),
                          }
                        : current,
                    );
                  }}
                />
              </label>
              <p>
                {version?.filename ?? "历史参考关联"} · {item.costume_id ? "服装参考" : "身份参考"}
              </p>
              <code>
                {item.asset_id}
                <br />
                {item.asset_version_id}
                <br />
                {item.asset_sha256}
              </code>
              <p className="manual-creative-muted">
                {warning ??
                  (version?.rights_status === "CLEARED"
                    ? "已有素材权利记录；仍需按真实调用范围另行授权"
                    : version?.rights_status === "RESTRICTED"
                      ? "素材权利受限，不得据关联授权外部使用"
                      : "未核对权利；此关联不批准使用或上传")}
              </p>
              {version && !warning && (
                <CharacterReferencePreview
                  key={`${item.asset_version_id}:${item.asset_sha256}`}
                  projectId={content.project_id}
                  assetId={item.asset_id}
                  version={version}
                  gateway={gateway}
                />
              )}
              <Button
                disabled={locked}
                onClick={() =>
                  edit((current) =>
                    current.schema_version === "1.2.0" || current.schema_version === "1.3.0"
                      ? {
                          ...current,
                          references: current.references
                            .filter((reference) => reference.reference_id !== item.reference_id)
                            .map((reference, i) => ({ ...reference, ordinal: i + 1 })),
                        }
                      : current,
                  )
                }
              >
                移除参考关联
              </Button>
            </div>
          );
        })}
    </>
  );
}
