import { Button } from "./Common";
import { newCreativeId } from "./adapters/creativeLibrary";
import { withCreativeDetails } from "./adapters/creativeCharacterDetails";
import type { CharacterDetailsProps } from "./CharacterDetails";
import { Select } from "./Select";

export function CharacterRelationships({
  content,
  characterId,
  edit,
  onNotice,
  locked,
}: CharacterDetailsProps) {
  const relationships = content.schema_version !== "1.0.0" ? content.relationships : [];
  const selected = relationships.filter(
    (item) => item.from_character_id === characterId || item.to_character_id === characterId,
  );
  const name = (id: string) =>
    content.characters.find((item) => item.character_id === id)?.name || "未命名角色";
  function add(targetId: string) {
    if (
      locked ||
      relationships.length >= 2000 ||
      targetId === characterId ||
      !content.characters.some((item) => item.character_id === targetId)
    )
      return;
    const id = newCreativeId("rel");
    if (!id) {
      onNotice("无法生成可靠关系标识，未新增。");
      return;
    }
    edit((current) => {
      const details = withCreativeDetails(current);
      return {
        ...details,
        relationships: [
          ...details.relationships,
          {
            relationship_id: id,
            ordinal: details.relationships.length + 1,
            from_character_id: characterId,
            to_character_id: targetId,
            label: "",
            description: "",
          },
        ],
      };
    });
  }
  function update(id: string, field: "label" | "description", value: string) {
    edit((current) => {
      const details = withCreativeDetails(current);
      return {
        ...details,
        relationships: details.relationships.map((item) =>
          item.relationship_id === id ? { ...item, [field]: value } : item,
        ),
      };
    });
  }
  return (
    <section aria-label="角色关系" className="character-detail-section">
      <h3>角色关系</h3>
      <label>
        添加关系对象
        <Select
          value=""
          disabled={locked || relationships.length >= 2000}
          onChange={(event) => add(event.currentTarget.value)}
        >
          <option value="">选择另一位角色</option>
          {content.characters
            .filter((item) => item.character_id !== characterId)
            .map((item) => (
              <option key={item.character_id} value={item.character_id}>
                {item.name || "未命名角色"}
              </option>
            ))}
        </Select>
      </label>
      {!selected.length && (
        <p className="manual-creative-muted">尚无关系；先创建其他角色，再明确选择关系对象。</p>
      )}
      {selected.map((item) => (
        <div key={item.relationship_id} className="character-detail-record">
          <strong>
            {name(item.from_character_id)} → {name(item.to_character_id)}
          </strong>
          <label>
            关系名称
            <input
              value={item.label}
              maxLength={120}
              required
              onChange={(event) => update(item.relationship_id, "label", event.currentTarget.value)}
            />
          </label>
          <label>
            关系说明
            <textarea
              value={item.description}
              maxLength={20000}
              rows={3}
              onChange={(event) =>
                update(item.relationship_id, "description", event.currentTarget.value)
              }
            />
          </label>
          <Button
            disabled={locked}
            onClick={() =>
              edit((current) => {
                const details = withCreativeDetails(current);
                return {
                  ...details,
                  relationships: details.relationships
                    .filter((relation) => relation.relationship_id !== item.relationship_id)
                    .map((relation, i) => ({ ...relation, ordinal: i + 1 })),
                };
              })
            }
            aria-label={`删除关系：${name(item.from_character_id)}到${name(item.to_character_id)}`}
          >
            删除关系
          </Button>
        </div>
      ))}
    </section>
  );
}
