import type { FilmProject, FilmShot } from "../../film/project";
import type { EditorSelection } from "./editor-context";
import { shape, list, safeText, reject, nullable, source } from "./direction-field-format";
import { artFieldValues } from "./art-field-values";
import { directorFieldValues } from "./director-field-values";
/** Full closed creative values only; source declarations never authorize evidence, paths or media. */
export function writerFieldValues(base: FilmProject, after: FilmProject, origin: EditorSelection) {
  const art = artFieldValues(base, after, origin);
  const ids = new Set([
    base.id,
    ...[base, after].flatMap((film) =>
      [
        ...film.scenes,
        ...film.shots,
        ...film.characters,
        ...film.locations,
        ...film.props,
        ...film.audioClips,
        ...film.shots.flatMap((shot) => shot.takes),
      ].map((row) => row.id),
    ),
  ]);
  const text = (value: unknown) => {
    if (typeof value !== "string" || value.length > 8192) reject();
    const numbered = /^\s*\[P\d{2,6}\][ \t]/u.test(value);
    safeText(numbered ? `原文段落：${value}` : value, origin);
    const result = value;
    if ([...ids].some((id) => id.length >= 4 && result.includes(id))) reject();
    return result;
  };
  const number = (value: unknown, min = 0, max = 100000) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
      reject();
    return String(value);
  };
  for (const film of [base, after])
    if (
      film.scenes.length > 256 ||
      new Set(film.scenes.map((scene) => scene.id)).size !== film.scenes.length ||
      new Set(film.scenes.map((scene) => scene.no)).size !== film.scenes.length
    )
      reject();
  const sceneLabel = (id: unknown) => {
    if (typeof id !== "string") reject();
    const old = base.scenes.find((scene) => scene.id === id),
      next = after.scenes.find((scene) => scene.id === id),
      scene = old ?? next;
    if (!scene) reject();
    return `${old ? "原" : "新增"}第 ${number(scene.no, 1, 10000)} 场 · ${text(scene.title)}`;
  };
  const shotLabel = (id: unknown) => {
    if (typeof id !== "string") reject();
    const old = base.shots.find((shot) => shot.id === id),
      next = after.shots.find((shot) => shot.id === id),
      shot = old ?? next;
    if (!shot) reject();
    return `${sceneLabel(shot.sceneId)} · ${old ? "原" : "新增"}第 ${number(shot.no, 1, 10000)} 镜`;
  };
  const paragraph = (value: unknown) => {
    if (typeof value !== "string" || !/^P\d{1,6}$/.test(value) || Number(value.slice(1)) < 1)
      reject();
    return `原文第 ${value.slice(1)} 段`;
  };
  const enumValue = (value: unknown, labels: Record<string, string>) => {
    if (typeof value !== "string" || !Object.hasOwn(labels, value)) reject();
    return labels[value]!;
  };
  const person = (value: unknown) => {
    const name = text(value);
    if (!name) return "未指定";
    if (
      name !== "旁白" &&
      ![...base.characters, ...after.characters].some((person) => person.name === name)
    )
      reject();
    return name;
  };
  const stringList = (value: unknown) => list(value, 256).map(text).join("、") || "无";
  const lockLabels: Record<string, string> = {
    title: "场名",
    where: "地点",
    text: "剧本正文",
    ambience: "环境声音",
    tags: "标签",
    source: "来源说明",
    identity: "固定外貌",
    gender: "性别",
    ageBand: "年龄段",
    voiceId: "声音",
    name: "名称",
    prompt: "环境描述",
    layout: "布局",
    costume: "服装",
    costumes: "服装规则",
  };
  const locks = (value: unknown) =>
    list(value, 64)
      .map((value) => {
        if (typeof value !== "string" || !Object.hasOwn(lockLabels, value)) reject();
        return lockLabels[value]!;
      })
      .join("、") || "无";
  const writerPerson = (value: unknown) => {
    const row = shape(value, ["name", "identity", "gender", "ageBand", "firstParagraph", "brief"]),
      lines = [`人物：${person(row.name)}`];
    for (const [field, label] of [
      ["identity", "外貌声明"],
      ["gender", "性别声明"],
      ["ageBand", "年龄段声明"],
      ["brief", "人物简述"],
    ] as const)
      if (Object.hasOwn(row, field)) lines.push(`${label}：${nullable(row[field], text)}`);
    if (Object.hasOwn(row, "firstParagraph"))
      lines.push(`首次出现段落声明：${nullable(row.firstParagraph, paragraph)}`);
    return lines.join("\n");
  };
  function projectPlan(value: unknown) {
    const row = shape(value, [
      "sourceText",
      "title",
      "logline",
      "hook",
      "cliffhanger",
      "declaredDialogueCount",
      "characters",
      "locations",
    ]);
    const lines = [`本轮输入原稿快照：\n${text(row.sourceText)}`];
    for (const [field, label] of [
      ["title", "标题声明（不是改作品名）"],
      ["logline", "故事简述"],
      ["hook", "开场钩子"],
      ["cliffhanger", "悬念"],
    ] as const)
      if (Object.hasOwn(row, field)) lines.push(`${label}：${nullable(row[field], text)}`);
    if (Object.hasOwn(row, "declaredDialogueCount"))
      lines.push(`台词数量声明：${nullable(row.declaredDialogueCount, number)}（不是语音证据）`);
    lines.push(`人物声明：\n${list(row.characters, 256).map(writerPerson).join("\n\n") || "无"}`);
    lines.push(
      `地点声明：\n${
        list(row.locations, 256)
          .map((raw) => {
            const place = shape(raw, ["name", "prompt"]);
            return `地点：${text(place.name)}${Object.hasOwn(place, "prompt") ? `\n环境描述：${nullable(place.prompt, text)}` : ""}`;
          })
          .join("\n\n") || "无"
      }`,
    );
    return lines.join("\n");
  }
  function scenePlan(value: unknown) {
    const row = shape(value, [
        "sourceSceneId",
        "sourceNo",
        "title",
        "place",
        "interior",
        "time",
        "weather",
        "characters",
        "mood",
        "keyEvent",
        "proposedText",
        "proposedDialogue",
        "beats",
        "estimatedSeconds",
      ]),
      lines: string[] = [];
    if (Object.hasOwn(row, "sourceSceneId"))
      lines.push(`申报对应：${nullable(row.sourceSceneId, sceneLabel)}（仅声明）`);
    if (Object.hasOwn(row, "sourceNo"))
      lines.push(`申报场号：${nullable(row.sourceNo, (v) => number(v, 1, 10000))}`);
    for (const [key, label] of [
      ["title", "场名声明"],
      ["place", "地点声明"],
      ["time", "时间"],
      ["weather", "天气"],
      ["mood", "情绪"],
      ["keyEvent", "关键事件"],
      ["proposedText", "建议正文"],
      ["proposedDialogue", "建议对白"],
    ] as const)
      if (Object.hasOwn(row, key)) lines.push(`${label}：${nullable(row[key], text)}`);
    if (Object.hasOwn(row, "interior"))
      lines.push(
        `内外景：${nullable(row.interior, (v) => {
          if (typeof v !== "boolean") reject();
          return v ? "内景" : "外景";
        })}`,
      );
    if (Object.hasOwn(row, "characters"))
      lines.push(
        `人物声明：${nullable(row.characters, (v) => list(v, 128).map(person).join("、") || "无")}`,
      );
    if (Object.hasOwn(row, "beats")) lines.push(`建议节拍：${nullable(row.beats, stringList)}`);
    if (Object.hasOwn(row, "estimatedSeconds"))
      lines.push(`预计秒数：${nullable(row.estimatedSeconds, number)}（非成片实测）`);
    return lines.join("\n") || "无场次声明";
  }
  function elements(value: unknown) {
    return (
      list(value, 512)
        .map((raw) => {
          const row = shape(raw, [
              "type",
              "text",
              "speaker",
              "kind",
              "line",
              "delivery",
              "source",
              "sourceParagraphIds",
              "verification",
            ]),
            lines = [`条目：${enumValue(row.type, { action: "动作声明", dialogue: "对白声明" })}`];
          for (const [key, label] of [
            ["text", "文本"],
            ["kind", "对白种类声明"],
            ["line", "台词"],
            ["delivery", "语气"],
          ] as const)
            if (Object.hasOwn(row, key)) lines.push(`${label}：${nullable(row[key], text)}`);
          if (Object.hasOwn(row, "speaker")) lines.push(`说话人：${nullable(row.speaker, person)}`);
          if (Object.hasOwn(row, "source"))
            lines.push(`来源声明：${nullable(row.source, paragraph)}`);
          lines.push(
            `原解析器对应段落：${list(row.sourceParagraphIds, 256).map(paragraph).join("、") || "无"}`,
          );
          lines.push(
            `状态：${enumValue(row.verification, { attributed: "已有原解析器归属（不增新证据）", needs_review: "待核对" })}`,
          );
          return lines.join("\n");
        })
        .join("\n\n") || "无编剧条目"
    );
  }
  const sceneLabels: Record<string, string> = {
    no: "场号",
    title: "场名",
    where: "地点",
    text: "剧本正文",
    ambience: "环境声音",
    source: "来源说明",
    userFields: "用户保护字段",
    tags: "标签",
    writerPlan: "本场编剧声明",
    elements: "动作与对白条目",
    sourceParagraphIds: "原解析器原文段落对应",
    writerSourceText: "编剧原文快照",
    writerParagraphIds: "重建原文段落顺序",
    paragraphCoverage: "原文段落覆盖",
    coverage: "导演文本覆盖",
    shotBudget: "导演镜头预算",
  };
  function sceneValue(field: string, value: unknown): string {
    if (value === undefined) return "未设置";
    if (value === null) return "明确留空";
    if (!Object.hasOwn(sceneLabels, field)) reject();
    if (field === "no") return number(value, 1, 10000);
    if (field === "writerPlan") return scenePlan(value);
    if (field === "elements") return elements(value);
    if (["sourceParagraphIds", "writerParagraphIds"].includes(field))
      return list(value, 512).map(paragraph).join("、") || "无";
    if (field === "paragraphCoverage") {
      const row = shape(value, [
        "ok",
        "missingParagraphs",
        "duplicateParagraphs",
        "invalidParagraphs",
        "crossSceneRisk",
      ]);
      if (typeof row.ok !== "boolean" || typeof row.crossSceneRisk !== "boolean") reject();
      return [
        `完整覆盖：${row.ok ? "符合原规则" : "待核对"}`,
        `跨场风险：${row.crossSceneRisk ? "有" : "无"}`,
        ...(
          [
            ["missingParagraphs", "缺失"],
            ["duplicateParagraphs", "重复"],
            ["invalidParagraphs", "无效"],
          ] as const
        ).map(
          ([key, label]) => `${label}：${list(row[key], 512).map(paragraph).join("、") || "无"}`,
        ),
      ].join("\n");
    }
    if (field === "coverage") {
      const row = shape(value, ["sceneId", "ok", "lastLine", "missingLines", "missingTail"]);
      if (typeof row.ok !== "boolean") reject();
      return `${sceneLabel(row.sceneId)} · ${row.ok ? "原文本检测无缺项" : "原文本检测有缺项"}\n末句：${text(row.lastLine)}\n缺台词：${list(row.missingLines, 256).map(text).join("\n") || "无"}\n缺结尾：${nullable(row.missingTail, text)}（不证明语音完整）`;
    }
    if (field === "shotBudget") {
      const row = shape(value, ["sceneId", "limit", "count", "ok", "blockedPairs"]);
      if (row.limit !== 16 || typeof row.ok !== "boolean") reject();
      const reasons: Record<string, string> = {
        SCENE_MISMATCH: "跨场",
        HAS_MEDIA: "已有媒体",
        HAS_SELECTED_TAKE: "已有选版",
        HAS_CONTINUITY_FRAME: "已有衔接帧",
        USER_LOCKED: "用户保护",
        INVALID_DURATION: "时长无效",
        DURATION_OVER_15S: "预计合并时长超过15秒",
        SOUND_SOURCE_MISMATCH: "声音来源不同",
        MUSIC_MOOD_MISMATCH: "配乐情绪不同",
        STYLE_MISMATCH: "画风不同",
        FRAMING_MISMATCH: "景别不同",
        SPEAKER_MISMATCH: "说话人不同",
      };
      return `${sceneLabel(row.sceneId)} · ${number(row.count)}/16 镜；${row.ok ? "符合原预算" : "需核对"}\n${list(
        row.blockedPairs,
        512,
      )
        .map((raw) => {
          const pair = shape(raw, ["shotIds", "reasons"]);
          return `${list(pair.shotIds, 2).map(shotLabel).join(" / ")}：${list(pair.reasons, 16)
            .map((reason) => enumValue(reason, reasons))
            .join("、")}`;
        })
        .join("\n")}`;
    }
    if (field === "userFields") return locks(value);
    if (field === "tags") return stringList(value);
    if (field === "source")
      return value === "agent:writer"
        ? "编剧建议"
        : value === "offline:writer"
          ? "软件规则编剧"
          : value === "sample"
            ? "示例"
            : source(value);
    return text(value);
  }
  const assetLabels: Record<string, string> = {
    name: "名称",
    identity: "固定外貌",
    gender: "性别",
    ageBand: "年龄段",
    voiceId: "声音",
    voiceCode: "选声待核项",
    voiceDefault: "默认选声依据",
    source: "来源说明",
    userFields: "用户保护字段",
    portraits: "定妆照",
    writerPlan: "人物编剧声明",
    prompt: "环境描述",
    ambience: "环境声音",
    layout: "布局",
    referenceImage: "参考图",
    referenceLayout: "参考布局",
    referenceSceneSignature: "参考来源标记",
    referenceStyleRevision: "参考图画风状态",
    artFields: "后续建议参考内容",
    sceneId: "场次对应",
  };
  function assetValue(
    collection: "characters" | "locations",
    field: string,
    value: unknown,
  ): string {
    if (value === undefined) return "未设置";
    if (value === null) return "明确留空";
    if (!Object.hasOwn(assetLabels, field)) reject();
    if (field === "name") return text(value);
    if (field === "source")
      return value === "script" ? "剧本提取" : value === "sample" ? "示例" : source(value);
    if (field === "writerPlan" && collection === "characters") return writerPerson(value);
    if (field === "userFields") return locks(value);
    if (field === "sceneId") return value === "" ? "未指定" : sceneLabel(value);
    if (field === "portraits") {
      if (list(value, 4).length) reject();
      return "无";
    }
    if (["referenceImage", "referenceSceneSignature"].includes(field)) {
      if (value !== "") reject();
      return "无";
    }
    if (field === "referenceLayout") return text(value);
    return art.value(collection, field, value);
  }
  function shotContents(shot: FilmShot, previous?: FilmShot) {
    const scope = { ...origin, page: "board" as const, sceneId: shot.sceneId, shotId: shot.id },
      values = directorFieldValues(base, after, scope);
    const optional: Record<string, string> = {
      poster: "画面素材",
      selectedTakeId: "所选版本",
      takes: "视频版本",
      stills: "画面版本",
      continuityFrame: "衔接帧",
      reviewedVideoPrompt: "已确认画面说明",
      splitSource: "拆镜来源",
    };
    return Object.keys(shot)
      .filter((key) => key !== "id" && key !== "sceneId")
      .map(
        (key) =>
          `${values.labels[key] ?? optional[key] ?? reject()}：${values.value(key, (shot as unknown as Record<string, unknown>)[key], shot, previous)}`,
      )
      .join("\n");
  }
  return {
    text,
    number,
    sceneLabel,
    shotLabel,
    sceneLabels,
    sceneValue,
    assetLabels,
    assetValue,
    projectPlan,
    shotContents,
  };
}
