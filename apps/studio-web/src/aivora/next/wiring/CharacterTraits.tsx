import type { FilmCharacter } from "../../film/project";

const GENDERS = ["", "男", "女"] as const;
const AGES = ["", "儿童", "少年", "青年", "中年", "老年"] as const;

export type TraitPatch = Pick<FilmCharacter, "gender" | "ageBand">;
export function CharacterTraits({
  character,
  onChange,
}: {
  character: FilmCharacter;
  onChange: (patch: TraitPatch) => void;
}) {
  return (
    <div className="field">
      <label>
        性别
        <select
          className="input"
          aria-label="人物性别"
          value={character.gender ?? ""}
          onChange={(event) =>
            onChange({
              gender: GENDERS.find((value) => value === event.target.value) ?? "",
              ageBand: character.ageBand,
            })
          }
        >
          {GENDERS.map((value) => (
            <option key={value} value={value}>
              {value || "未写"}
            </option>
          ))}
        </select>
      </label>
      <label>
        年龄段
        <select
          className="input"
          aria-label="人物年龄段"
          value={character.ageBand ?? ""}
          onChange={(event) =>
            onChange({
              gender: character.gender,
              ageBand: AGES.find((value) => value === event.target.value) ?? "",
            })
          }
        >
          {AGES.map((value) => (
            <option key={value} value={value}>
              {value || "未写"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
