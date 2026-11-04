import { Button } from "./Common";
import { newCreativeId } from "./adapters/creativeLibrary";
import { withCreativeDetails, removeCreativeCostume } from "./adapters/creativeCharacterDetails";
import type { CharacterDetailsProps } from "./CharacterDetails";

export function CharacterCostumes({
  content,
  characterId,
  edit,
  onNotice,
  locked,
}: CharacterDetailsProps) {
  const costumes = content.schema_version !== "1.0.0" ? content.costumes : [];
  function add() {
    if (locked || costumes.length >= 2000) return;
    const id = newCreativeId("cst");
    if (!id) {
      onNotice("无法生成可靠服装标识，未新增。");
      return;
    }
    edit((current) => {
      const details = withCreativeDetails(current);
      return {
        ...details,
        costumes: [
          ...details.costumes,
          {
            costume_id: id,
            ordinal: details.costumes.length + 1,
            character_id: characterId,
            name: "",
            description: "",
          },
        ],
      };
    });
  }
  function update(id: string, field: "name" | "description", value: string) {
    edit((current) => {
      const details = withCreativeDetails(current);
      return {
        ...details,
        costumes: details.costumes.map((item) =>
          item.costume_id === id ? { ...item, [field]: value } : item,
        ),
      };
    });
  }
  const selected = costumes.filter((item) => item.character_id === characterId);
  function remove(id: string) {
    if (locked) return;
    const count =
      content.schema_version === "1.2.0" || content.schema_version === "1.3.0"
        ? content.references.filter((item) => item.costume_id === id).length
        : 0;
    if (
      count &&
      !window.confirm(`删除此服装会同时从当前草稿移除 ${count} 个参考关联；历史版本保留。`)
    )
      return;
    edit((current) => removeCreativeCostume(current, id));
  }
  return (
    <section aria-label="服装版本" className="character-detail-section">
      <h3>服装版本</h3>
      <Button disabled={locked || costumes.length >= 2000} onClick={add}>
        新增服装版本
      </Button>
      {!selected.length && (
        <p className="manual-creative-muted">
          尚无服装。填写后随作品草稿保存；此记录表示服装设定，不表示生成或锁定完成。
        </p>
      )}
      {selected.map((item) => (
        <div key={item.costume_id} className="character-detail-record">
          <label>
            服装名称
            <input
              value={item.name}
              maxLength={120}
              required
              onChange={(event) => update(item.costume_id, "name", event.currentTarget.value)}
            />
          </label>
          <label>
            服装说明
            <textarea
              value={item.description}
              maxLength={20000}
              rows={4}
              onChange={(event) =>
                update(item.costume_id, "description", event.currentTarget.value)
              }
            />
          </label>
          <Button
            disabled={locked}
            onClick={() => remove(item.costume_id)}
            aria-label={`删除服装：${item.name || "未命名服装"}`}
          >
            删除服装
          </Button>
        </div>
      ))}
    </section>
  );
}
