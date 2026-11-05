export type CharacterGender = "男" | "女" | "";
export type CharacterAgeBand = "儿童" | "少年" | "青年" | "中年" | "老年" | "";

export function normalizeGender(value: unknown): CharacterGender {
  if (typeof value !== "string") return "";
  if (/^(男|男性|male|man)$/i.test(value.trim())) return "男";
  if (/^(女|女性|female|woman)$/i.test(value.trim())) return "女";
  return "";
}

export function normalizeAgeBand(value: unknown): CharacterAgeBand {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (/^(儿童|幼年|幼童|child|children)$/i.test(text)) return "儿童";
  if (/^(少年|teen|teenager|adolescent)$/i.test(text)) return "少年";
  if (/^(青年|年轻|young|young_adult)$/i.test(text)) return "青年";
  if (/^(中年|middle_aged|middle-aged)$/i.test(text)) return "中年";
  if (/^(老年|elder|elderly|senior)$/i.test(text)) return "老年";
  return "";
}
