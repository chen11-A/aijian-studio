import type { FilmCharacter } from "../../film/project";
import { normalizeGender, normalizeAgeBand } from "../../film/cast-traits";

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
            onChange({ gender: normalizeGender(event.target.value), ageBand: character.ageBand })
          }
        >
          {["", "男", "女"].map((value) => (
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
            onChange({ gender: character.gender, ageBand: normalizeAgeBand(event.target.value) })
          }
        >
          {["", "儿童", "少年", "青年", "中年", "老年"].map((value) => (
            <option key={value} value={value}>
              {value || "未写"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
