import type { FilmProject } from "../../film/project";
import { VOICE_LABELS } from "../../film/operations";
import type { EditorSelection } from "./editor-context";
import { reject, shape, list, safeText, nullable } from "./direction-field-format";
const bounded = (v: string) => {
  if (v.length > 32768) reject();
  return v;
};
const id = (v: unknown) => {
  if (typeof v !== "string" || !v || v.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v))
    reject();
  return v;
};
type Collection = "characters" | "locations" | "props" | "scenes" | "costumes";
export function artFieldValues(base: FilmProject, preview: FilmProject, scope: EditorSelection) {
  const maps: Record<Collection, Map<string, string>> = {
    characters: new Map(),
    locations: new Map(),
    props: new Map(),
    scenes: new Map(),
    costumes: new Map(),
  };
  const privateIds = new Set<string>();
  for (const film of [base, preview])
    for (const rows of [
      film.characters,
      film.locations,
      film.props,
      film.scenes,
      film.shots,
      film.shots.flatMap((shot) => shot.takes),
      film.audioClips,
      film.costumes ?? [],
    ])
      for (const row of rows) privateIds.add(row.id);
  const text = (v: unknown) => {
    const value = safeText(v, scope);
    if ([...privateIds].some((id) => id.length >= 4 && value.includes(id))) reject();
    return value;
  };
  const add = (kind: Collection, key: string, label: string) => {
    const previous = maps[kind].get(key);
    if (previous !== undefined && previous !== label) return;
    maps[kind].set(key, label);
  };
  for (const film of [base, preview]) {
    for (const kind of ["characters", "locations", "props"] as const) {
      const rows = film[kind];
      if (
        rows.length > 512 ||
        new Set(rows.map((row) => row.id)).size !== rows.length ||
        new Set(rows.map((row) => row.name)).size !== rows.length
      )
        reject();
      for (const row of rows) add(kind, id(row.id), text(row.name));
    }
    if (
      film.scenes.length > 512 ||
      new Set(film.scenes.map((row) => row.id)).size !== film.scenes.length
    )
      reject();
    for (const scene of film.scenes) {
      if (!Number.isInteger(scene.no) || scene.no < 1) reject();
      add("scenes", id(scene.id), `第 ${scene.no} 场 · ${text(scene.title)}`);
    }
    if (
      (film.costumes ?? []).length > 256 ||
      new Set((film.costumes ?? []).map((rule) => rule.id)).size !== (film.costumes ?? []).length
    )
      reject();
    for (const rule of film.costumes ?? [])
      add("costumes", id(rule.id), `${text(rule.name)} · ${text(rule.title)}`);
  }
  const ref = (kind: Collection, value: unknown) => {
    const label = maps[kind].get(id(value));
    if (label === undefined) reject();
    return label;
  };
  const locks: Record<string, string> = {
    name: "名称",
    identity: "固定外貌",
    gender: "性别",
    ageBand: "年龄段",
    voiceId: "声音",
    costume: "服装",
    costumes: "服装规则",
    description: "服装描述",
    ranges: "原文范围",
    artDescription: "美术参考",
    prompt: "场景描述",
    ambience: "环境声音",
    layout: "场景布局",
    note: "道具描述",
  };
  function protectedFields(v: unknown) {
    return (
      list(v, 64)
        .map((value) => {
          if (typeof value !== "string" || !Object.hasOwn(locks, value)) reject();
          return locks[value]!;
        })
        .join("、") || "无"
    );
  }
  function paragraph(v: unknown) {
    if (typeof v !== "string" || !/^P[1-9]\d{0,5}$/.test(v)) reject();
    return `原文第 ${Number(v.slice(1))} 段`;
  }
  function costumes(v: unknown) {
    return bounded(
      list(v, 256)
        .map((raw) => {
          const row = shape(raw, [
            "id",
            "name",
            "title",
            "description",
            "ranges",
            "artDescription",
            "userFields",
          ]);
          ref("costumes", row.id);
          if (![...maps.characters.values()].includes(text(row.name))) reject();
          const lines = [
            `人物：${text(row.name)}`,
            `服装名：${text(row.title)}`,
            `描述：${text(row.description)}`,
            `范围：${
              list(row.ranges, 128)
                .map((raw) => {
                  const range = shape(raw, ["sceneId", "from", "to"]);
                  return `${ref("scenes", range.sceneId)} · ${paragraph(range.from)} 至 ${paragraph(range.to)}`;
                })
                .join("；") || "未设置"
            }`,
          ];
          if (Object.hasOwn(row, "artDescription"))
            lines.push(`美术参考：${nullable(row.artDescription, text)}`);
          if (Object.hasOwn(row, "userFields"))
            lines.push(`编辑保护：${nullable(row.userFields, protectedFields)}`);
          return lines.join("\n");
        })
        .join("\n\n") || "无服装规则",
    );
  }
  const aliases = {
    characters: new Map(maps.characters),
    locations: new Map(maps.locations),
    props: new Map(maps.props),
  };
  const assets = new Map<string, string>();
  const byName = (kind: "characters" | "locations" | "props", name: unknown) => {
    const label = text(name);
    if (![...maps[kind].values()].includes(label)) reject();
    return label;
  };
  const declare = (map: Map<string, string>, key: unknown, label: string) => {
    const symbol = id(key),
      old = map.get(symbol);
    if (old !== undefined && old !== label) reject();
    map.set(symbol, label);
  };
  const designs = [
    base.artDesign,
    base.artDesignBaseline,
    preview.artDesign,
    preview.artDesignBaseline,
  ];
  for (const design of designs) {
    if (!design) continue;
    for (const [key, kind, alias] of [
      ["identities", "characters", "char_id"],
      ["locations", "locations", "loc_id"],
      ["props", "props", "prop_id"],
    ] as const)
      for (const raw of design[key] ?? []) {
        const row = raw as Record<string, unknown>,
          name = byName(kind, row.name);
        if (row[alias] !== undefined) declare(aliases[kind], row[alias], name);
        if (row.asset_id !== undefined)
          declare(assets, row.asset_id, `${name}的素材声明（未证实已有文件）`);
      }
    for (const raw of design.portraits ?? []) {
      const row = raw as Record<string, unknown>,
        name = byName("characters", row.name);
      if (row.asset_id !== undefined)
        declare(
          assets,
          row.asset_id,
          `${name} · ${row.view === undefined ? "未指定视角" : text(row.view)}参考声明（未证实已有文件）`,
        );
    }
  }
  const declaredRef = (map: Map<string, string>, value: unknown) => {
    const label = map.get(id(value));
    if (label === undefined) reject();
    return label;
  };
  function design(v: unknown) {
    const row = shape(v, [
      "style_status",
      "preset",
      "era",
      "palette",
      "lighting",
      "lens",
      "grain",
      "contrast",
      "texture",
      "aspect",
      "prompt_block_en",
      "avoid",
      "asset_ids",
      "identities",
      "portraits",
      "locations",
      "props",
    ]);
    const names: Record<string, string> = {
      style_status: "画风声明状态",
      preset: "画风分类",
      era: "年代",
      lighting: "灯光",
      lens: "镜头风格",
      grain: "颗粒",
      contrast: "对比",
      texture: "质感",
      aspect: "画幅声明",
      prompt_block_en: "英文画风说明",
    };
    const lines = Object.entries(names)
      .filter(([key]) => Object.hasOwn(row, key))
      .map(([key, label]) => `${label}：${nullable(row[key], text)}`);
    if (Object.hasOwn(row, "palette"))
      lines.push(
        `色板：${nullable(
          row.palette,
          (v) =>
            list(v, 64)
              .map((raw) => {
                const color = shape(raw, ["name", "hex"]);
                return [
                  color.name === undefined ? "未命名" : text(color.name),
                  color.hex === undefined ? "未指定色值" : text(color.hex),
                ].join(" · ");
              })
              .join("；") || "无",
        )}`,
      );
    if (Object.hasOwn(row, "avoid"))
      lines.push(`避免：${nullable(row.avoid, (v) => list(v, 128).map(text).join("；") || "无")}`);
    if (Object.hasOwn(row, "asset_ids"))
      lines.push(
        `素材声明：${nullable(
          row.asset_ids,
          (v) =>
            list(v, 256)
              .map((value) => declaredRef(assets, value))
              .join("；") || "无",
        )}`,
      );
    for (const [key, kind, alias, title] of [
      ["identities", "characters", "char_id", "人物声明"],
      ["locations", "locations", "loc_id", "场景声明"],
      ["props", "props", "prop_id", "道具声明"],
    ] as const)
      if (Object.hasOwn(row, key))
        lines.push(
          `${title}：${nullable(
            row[key],
            (v) =>
              list(v, 256)
                .map((raw) => {
                  const item = shape(
                    raw,
                    key === "identities"
                      ? ["name", "char_id", "role", "status"]
                      : key === "locations"
                        ? ["name", "loc_id", "asset_id", "status"]
                        : ["name", "prop_id", "asset_id", "prompt", "status"],
                  );
                  const name = byName(kind, item.name),
                    values = [name];
                  if (Object.hasOwn(item, alias))
                    values.push(
                      `对应：${nullable(item[alias], (v) => declaredRef(aliases[kind], v))}`,
                    );
                  if (Object.hasOwn(item, "asset_id"))
                    values.push(`素材：${nullable(item.asset_id, (v) => declaredRef(assets, v))}`);
                  for (const [field, label] of [
                    ["role", "角色声明"],
                    ["status", "状态声明"],
                    ["prompt", "描述"],
                  ] as const)
                    if (Object.hasOwn(item, field))
                      values.push(`${label}：${nullable(item[field], text)}`);
                  return values.join("；");
                })
                .join("\n") || "无",
          )}`,
        );
    if (Object.hasOwn(row, "portraits"))
      lines.push(
        `参考图声明：${nullable(
          row.portraits,
          (v) =>
            list(v, 256)
              .map((raw) => {
                const item = shape(raw, ["name", "asset_id", "view", "costume_id", "prompt"]),
                  values = [byName("characters", item.name)];
                if (Object.hasOwn(item, "asset_id"))
                  values.push(`素材：${nullable(item.asset_id, (v) => declaredRef(assets, v))}`);
                if (Object.hasOwn(item, "view")) values.push(`视角：${nullable(item.view, text)}`);
                if (Object.hasOwn(item, "costume_id"))
                  values.push(`服装：${nullable(item.costume_id, (v) => ref("costumes", v))}`);
                if (Object.hasOwn(item, "prompt"))
                  values.push(`描述：${nullable(item.prompt, text)}`);
                return values.join("；");
              })
              .join("\n") || "无",
        )}`,
      );
    return bounded(lines.join("\n") || "无美术声明");
  }
  function styleState(v: unknown) {
    if (v === -1) return "参考图画风待核对";
    if (v === base.styleRevision || v === (base.styleRevision ?? 0)) return "与请求时画风关联";
    if (v === preview.styleRevision) return "与建议画风关联";
    reject();
  }
  function baseline(v: unknown, keys: readonly string[]) {
    const row = shape(v, keys);
    return (
      Object.entries(row)
        .map(
          ([key, value]) =>
            `${({ prompt: "场景描述", ambience: "环境声音", layout: "场景布局", note: "道具描述" } as Record<string, string>)[key]}：${nullable(value, text)}`,
        )
        .join("\n") || "无参考内容"
    );
  }
  function value(collection: string, field: string, v: unknown): string {
    if (collection === "project") {
      if (field === "styleZh") return text(v);
      if (field === "costumes") return costumes(v);
      if (field === "artDesign" || field === "artDesignBaseline") return design(v);
      reject();
    }
    if (collection === "characters") {
      if (field === "identity") return text(v);
      if (field === "gender") {
        if (!["男", "女", ""].includes(String(v))) reject();
        return v === "" ? "未指定" : String(v);
      }
      if (field === "ageBand") {
        if (!["儿童", "少年", "青年", "中年", "老年", ""].includes(String(v))) reject();
        return v === "" ? "未指定" : String(v);
      }
      if (field === "voiceId") {
        if (v === "") return "未选声音";
        if (typeof v !== "string" || !Object.hasOwn(VOICE_LABELS, v)) reject();
        return VOICE_LABELS[v]!;
      }
      if (field === "voiceCode") {
        if (v === "") return "无待核提示";
        if (v === "VOICE_TRAITS_REQUIRED") return "人物选声信息待补充";
        reject();
      }
      if (field === "voiceDefault") {
        const row = shape(v, ["basis", "evidenceSource", "evidence"]);
        if (
          row.basis !== "adult-default" ||
          !["source", "character-reply", "casting-default"].includes(String(row.evidenceSource))
        )
          reject();
        return `成人默认选声（不是年龄事实）\n依据：${({ source: "原文", "character-reply": "人物回复", "casting-default": "选声默认" } as Record<string, string>)[String(row.evidenceSource)]}\n说明：${text(row.evidence)}`;
      }
      reject();
    }
    if (collection === "locations" || collection === "props") {
      if (["name", "prompt", "ambience", "layout", "note"].includes(field)) return text(v);
      if (field === "userFields") return protectedFields(v);
      if (field === "referenceStyleRevision" && collection === "locations") return styleState(v);
      if (field === "artFields")
        return baseline(
          v,
          collection === "locations" ? ["prompt", "ambience", "layout"] : ["note"],
        );
    }
    reject();
  }
  function addition(kind: "locations" | "props", raw: unknown, sceneIds: readonly string[] = []) {
    const keys =
      kind === "locations"
        ? [
            "id",
            "name",
            "prompt",
            "ambience",
            "sceneId",
            "layout",
            "referenceLayout",
            "referenceImage",
            "referenceSceneSignature",
            "referenceStyleRevision",
            "userFields",
            "artFields",
          ]
        : ["id", "name", "note", "userFields", "artFields"];
    const row = shape(raw, keys),
      name = ref(kind, row.id);
    if (text(row.name) !== name) reject();
    const lines = [`名称：${name}`];
    for (const key of Object.keys(row)) {
      if (["id", "name"].includes(key)) continue;
      if (key === "sceneId") {
        lines.push(`关联场次：${nullable(row[key], (v) => ref("scenes", v))}`);
        continue;
      }
      if (key === "referenceImage" || key === "referenceSceneSignature") {
        if (row[key] !== undefined && row[key] !== "") reject();
        lines.push(key === "referenceImage" ? "未提供参考图" : "未提供参考来源标记");
        continue;
      }
      if (key === "referenceLayout") {
        lines.push(`参考布局：${nullable(row[key], text)}`);
        continue;
      }
      const label: Record<string, string> = {
        prompt: "场景描述",
        ambience: "环境声音",
        layout: "场景布局",
        note: "道具描述",
        referenceStyleRevision: "参考图画风状态",
        userFields: "用户编辑保护",
        artFields: "后续建议参考内容",
      };
      if (!Object.hasOwn(label, key)) reject();
      lines.push(`${label[key]}：${nullable(row[key], (v) => value(kind, key, v))}`);
    }
    if (kind === "locations")
      lines.push(`当前场景引用：${sceneIds.map((id) => ref("scenes", id)).join("；") || "暂无"}`);
    return bounded(lines.join("\n"));
  }
  function risks(v: unknown) {
    return bounded(
      list(v, 512)
        .map((raw) => {
          const row = shape(raw, ["costumeId", "sceneId", "code"]),
            codes: Record<string, string> = {
              COSTUME_SOURCE_UNVERIFIED: "服装原文来源未核验",
              COSTUME_RANGE_INVALID: "服装范围待核对",
              COSTUME_WITHIN_SCENE_CHANGE: "同场服装变化待拆分核对",
              COSTUME_CONFLICT: "服装规则有冲突",
            };
          if (typeof row.code !== "string" || !Object.hasOwn(codes, row.code)) reject();
          return `${ref("costumes", row.costumeId)} · ${row.sceneId === "" ? "未对应场次" : ref("scenes", row.sceneId)}：${codes[row.code]}`;
        })
        .join("\n") || "无待核风险",
    );
  }
  return { value, addition, risks, text, ref };
}
