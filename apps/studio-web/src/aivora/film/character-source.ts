import type { CharacterGender } from "./cast-traits";

/** Explicit name-bound evidence only; adult appearance does not establish an age band. */
export function sourceCharacterEvidence(
  source: string,
  name: string,
): {
  ageText: string;
  gender: CharacterGender;
} {
  const empty = { ageText: "", gender: "" as CharacterGender };
  if (!name.trim() || !source.trim()) return empty;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const age = "[一二三四五六七八九十百0-9]{1,3}\\s*岁";
  const direct =
    source.match(new RegExp(`${escaped}[，,（(\\s]*(?:今年|已经|才)?(${age})`))?.[1] ??
    source.match(new RegExp(`(${age})的?(?:父亲|爸爸|母亲|妈妈)?${escaped}`))?.[1] ??
    "";
  for (const paragraph of source.split(/\n+/u)) {
    const linked = paragraph
      .trim()
      .match(
        new RegExp(`^${escaped}([^。！？\n]{0,120})[。！？]\\s*([她他])(?:今年|已经|才)?(${age})`),
      );
    if (
      linked &&
      !/父亲|母亲|男人|女人|男孩|女孩|看着|望着|对着|遇到|陪着|跟着|搂着|告诉|问|[“「"]/u.test(
        linked[1]!,
      )
    )
      return { ageText: direct || linked[3]!, gender: linked[2] === "她" ? "女" : "男" };
  }
  const group = source.match(
    new RegExp(
      `(男人|女人)[^。！？\n]{0,60}[。！？]\\s*(?:领头的|其中一个|为首的)(?:叫|名叫|是)${escaped}`,
    ),
  );
  return { ageText: direct, gender: group ? (group[1] === "男人" ? "男" : "女") : "" };
}
