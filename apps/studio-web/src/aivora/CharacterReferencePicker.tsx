import { useState } from "react";
import { Button } from "./Common";
import type { MediaAsset, AssetVersion } from "./adapters/assetLibrary";
import type { components } from "@aijian/contracts";
import { Select } from "./Select";

export function CharacterReferencePicker({
  assets,
  costumes,
  locked,
  onAdd,
}: {
  assets: MediaAsset[];
  costumes: components["schemas"]["ProjectCostumeV1"][];
  locked: boolean;
  onAdd: (asset: MediaAsset, version: AssetVersion, costumeId: string | null) => void;
}) {
  const [assetId, setAssetId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [costumeId, setCostumeId] = useState("");
  const asset = assets.find((item) => item.id === assetId);
  const version = asset?.versions.find((item) => item.id === versionId);
  return (
    <fieldset className="manual-creative-fields" disabled={locked}>
      <label>
        参考素材
        <Select
          value={assetId}
          onChange={(event) => {
            setAssetId(event.currentTarget.value);
            setVersionId("");
          }}
        >
          <option value="">明确选择已登记素材</option>
          {assets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.latest_version.filename}
            </option>
          ))}
        </Select>
      </label>
      <label>
        参考素材版本
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
      <label>
        参考归属
        <Select value={costumeId} onChange={(event) => setCostumeId(event.currentTarget.value)}>
          <option value="">角色身份参考</option>
          {costumes.map((item) => (
            <option key={item.costume_id} value={item.costume_id}>
              {item.name || "未命名服装"}
            </option>
          ))}
        </Select>
      </label>
      <Button
        disabled={
          locked ||
          !asset ||
          !version ||
          !["image", "video"].includes(version.kind) ||
          ["MISSING", "CORRUPT"].includes(version.availability) ||
          (costumeId !== "" && !costumes.some((item) => item.costume_id === costumeId))
        }
        onClick={() => {
          if (asset && version) {
            onAdd(asset, version, costumeId || null);
            setVersionId("");
          }
        }}
      >
        关联选中参考
      </Button>
    </fieldset>
  );
}
