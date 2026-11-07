import type { FilmProject, FilmShot } from "../../film/project";
import type { EditorSelection } from "./editor-context";
import { shape, list, safeText, reject, nullable, source } from "./direction-field-format";
import { formatActionFieldValue } from "./action-field-rows";
import { formatPerformanceFieldValue } from "./performance-field-rows";
/** Closed formatting only. No returned label, declaration or source claim is evidence or authority. */
export function directorFieldValues(
  base: FilmProject,
  after: FilmProject,
  origin: EditorSelection,
) {
  const scene = base.scenes.filter((row) => row.id === origin.sceneId);
  if (scene.length !== 1) reject();
  const privateIds = new Set([
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
    const result = safeText(value, origin);
    if ([...privateIds].some((id) => id.length >= 4 && result.includes(id))) reject();
    return result;
  };
  const numeric = (value: unknown, min = 0, max = 36000) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
      reject();
    return String(value);
  };
  const enumeration = (value: unknown, labels: Record<string, string>) => {
    if (typeof value !== "string" || !Object.hasOwn(labels, value)) reject();
    return labels[value]!;
  };
  const sceneLabel = `第 ${numeric(scene[0]!.no, 1, 10000)} 场 · ${text(scene[0]!.title)}`;
  for (const film of [base, after]) {
    const rows = film.shots.filter((row) => row.sceneId === origin.sceneId);
    if (new Set(rows.map((row) => row.no)).size !== rows.length) reject();
  }
  const shotLabel = (id: unknown) => {
    if (typeof id !== "string") reject();
    const old = base.shots.filter((row) => row.id === id),
      next = after.shots.filter((row) => row.id === id);
    if (old.length > 1 || next.length > 1 || (!old.length && !next.length)) reject();
    const row = old[0] ?? next[0]!;
    if (row.sceneId !== origin.sceneId) reject();
    return `${old.length ? "原" : "新增"}第 ${numeric(row.no, 1, 10000)} 镜`;
  };
  const person = (value: unknown) => {
    const name = text(value);
    if (
      name !== "" &&
      name !== "旁白" &&
      base.characters.filter((row) => row.name === name).length !== 1
    )
      reject();
    return name || "未指定";
  };
  const paragraph = (value: unknown) => {
    if (typeof value !== "string" || !/^P[1-9]\d{0,5}$/.test(value)) reject();
    return `原文第 ${Number(value.slice(1))} 段`;
  };
  const lines = (value: unknown) =>
    list(value, 128)
      .map((item) => {
        const row = shape(item, ["speaker", "text"]);
        return `${person(row.speaker)}：${text(row.text)}`;
      })
      .join("\n") || "无台词";
  const flags = (value: unknown) =>
    enumeration(value, {
      current: "与当前创作输入一致",
      needs_review: "需核对",
      matched: "已对应声明",
      specified: "已指定建议时间",
      unspecified: "未指定时间",
      ordered: "声明顺序一致（不证明原文事实）",
    });
  function directorPlan(value: unknown) {
    const plan = shape(value, ["segments", "sourceSnapshot", "timingStatus"]);
    if (typeof plan.sourceSnapshot !== "string" || plan.sourceSnapshot.length > 32768) reject();
    const snapshot: unknown = JSON.parse(plan.sourceSnapshot);
    if (!Array.isArray(snapshot) || snapshot.length !== 8 || snapshot[0] !== origin.sceneId)
      reject();
    const pieces = [
      `计划状态：${flags(plan.timingStatus)}`,
      `捕获的画面：${text(snapshot[1])}`,
      `捕获的台词：${text(snapshot[2])}`,
      `捕获的分行：${nullable(snapshot[3], lines)}`,
      `捕获的说话人：${nullable(snapshot[4], person)}`,
      `捕获的人物：${list(snapshot[5], 64).map(person).join("、") || "无"}`,
      `捕获的站位：${nullable(snapshot[6], text)}`,
      `捕获的朝向：${nullable(snapshot[7], text)}`,
    ];
    for (const [index, raw] of list(plan.segments, 128).entries()) {
      const segment = shape(raw, [
        "sceneDeclaration",
        "sourceNo",
        "declaredSeconds",
        "sourceShotId",
        "seconds",
        "purpose",
        "emotion",
        "positions",
        "dialogueCues",
        "unassignedLineAt",
        "sourceParagraphHints",
        "verifiedSourceParagraphIds",
        "referenceHints",
      ]);
      const declaredNo = segment.sourceNo;
      let sourceLabel: string;
      if (typeof segment.sourceShotId !== "string" || segment.sourceShotId.length > 160) reject();
      if ([...base.shots, ...after.shots].some((row) => row.id === segment.sourceShotId))
        sourceLabel = shotLabel(segment.sourceShotId);
      else {
        if (!declaredNo) reject();
        sourceLabel = `导演申报第 ${numeric(declaredNo, 1, 10000)} 镜（未作为现存镜头身份）`;
      }
      pieces.push(
        `段落 ${index + 1}：${sourceLabel}；${numeric(segment.seconds)} 秒（创作建议）；目的：${text(segment.purpose)}；情绪：${text(segment.emotion)}`,
      );
      if (Object.hasOwn(segment, "sourceNo"))
        pieces.push(`申报镜号：${nullable(declaredNo, (v) => numeric(v, 1, 10000))}`);
      if (Object.hasOwn(segment, "declaredSeconds"))
        pieces.push(`申报时长：${nullable(segment.declaredSeconds, numeric)} 秒`);
      if (segment.sceneDeclaration !== undefined) {
        const declaration = shape(segment.sceneDeclaration, [
          "sourceSceneId",
          "resolvedSceneId",
          "title",
          "declaredTotalSeconds",
          "rhythm",
          "matchStatus",
        ]);
        if (
          declaration.resolvedSceneId !== origin.sceneId ||
          (declaration.sourceSceneId !== undefined && declaration.sourceSceneId !== origin.sceneId)
        )
          reject();
        pieces.push(`场景声明：${sceneLabel}；${flags(declaration.matchStatus)}`);
        for (const [key, label] of [
          ["title", "声明标题"],
          ["rhythm", "节奏"],
        ] as const)
          if (Object.hasOwn(declaration, key))
            pieces.push(`${label}：${nullable(declaration[key], text)}`);
        if (Object.hasOwn(declaration, "declaredTotalSeconds"))
          pieces.push(`声明总时长：${nullable(declaration.declaredTotalSeconds, numeric)} 秒`);
      }
      for (const raw of list(segment.positions, 64)) {
        const position = shape(raw, ["name", "position", "depth", "visible", "scopeStatus"]);
        pieces.push(
          `站位：${person(position.name)}；${text(position.position)}；${text(position.depth)}；${text(position.visible)}；${flags(position.scopeStatus)}`,
        );
      }
      for (const raw of list(segment.dialogueCues, 128)) {
        const cue = shape(raw, ["speaker", "text", "atSeconds", "timingStatus"]);
        pieces.push(
          `台词：${person(cue.speaker)}；${text(cue.text)}；时间：${nullable(cue.atSeconds, numeric)}（创作建议，非语音对齐）；${flags(cue.timingStatus)}`,
        );
      }
      if (Object.hasOwn(segment, "unassignedLineAt"))
        pieces.push(`未分配台词时间：${nullable(segment.unassignedLineAt, numeric)}（创作建议）`);
      pieces.push(
        `申报原文段：${list(segment.sourceParagraphHints, 128).map(paragraph).join("、") || "无"}`,
      );
      pieces.push(
        `原解析器已核段落成员：${list(segment.verifiedSourceParagraphIds, 128).map(paragraph).join("、") || "无"}（不是新事实证据）`,
      );
      // Arbitrary asset tokens cannot be represented as actual available files.
      if (list(segment.referenceHints, 64).length) reject();
      pieces.push("参考素材声明：无");
    }
    return pieces.join("\n");
  }
  const labels: Record<string, string> = {
    continuity: "连续性说明与文字检查",
    splitSource: "拆镜来源",
    reviewedVideoPrompt: "已确认视频说明",
    continuityFrame: "衔接帧",
    poster: "画面素材",
    selectedTakeId: "选用版本",
    takes: "视频版本",
    stills: "画面版本",
    posterPosition: "画面定位",
    no: "镜号",
    size: "景别",
    angle: "角度",
    move: "镜头运动",
    seconds: "预计秒数",
    picture: "画面",
    action: "主动作",
    actionBeats: "动作要点",
    performance: "表演",
    performanceSource: "表演来源",
    styleNote: "单镜画风说明",
    characters: "画面人物",
    line: "台词",
    lines: "分行台词",
    speaker: "说话人",
    delivery: "配音语气",
    sound: "声音计划",
    tag: "镜头标签",
    blocking: "站位",
    facing: "朝向",
    directorFramePrompt: "导演首帧计划",
    directorVideoPrompt: "导演视频计划",
    promptZh: "中文画面说明",
    promptEn: "英文画面说明",
    source: "建议来源",
    userFields: "用户保护字段",
    directorPlan: "导演完整计划",
    sourceReview: "原文声明核对",
    actionPlan: "动作计划",
    performancePlan: "表演计划",
    continuityFromShotId: "衔接来源镜头",
    regenerationRequired: "画风待核标记",
  };
  const emptyMedia = new Set([
    "poster",
    "selectedTakeId",
    "takes",
    "stills",
    "continuityFrame",
    "reviewedVideoPrompt",
    "splitSource",
  ]);
  function value(field: string, value: unknown, shot: FilmShot, before?: FilmShot): string {
    const scope = { ...origin, page: "board" as const, shotId: shot.id };
    if (value === undefined) return "未设置";
    if (value === null) return "明确留空";
    if (emptyMedia.has(field)) {
      if (value === "" || (Array.isArray(value) && value.length === 0)) return "无";
      return reject();
    }
    if (field === "id") return shotLabel(value);
    if (field === "sceneId") {
      if (value !== origin.sceneId) reject();
      return sceneLabel;
    }
    if (!Object.hasOwn(labels, field)) reject();
    if (["action", "actionBeats", "actionPlan", "sound"].includes(field))
      return formatActionFieldValue(field, value, scope, before?.actionPlan, true);
    if (["performance", "performancePlan", "performanceSource", "delivery"].includes(field))
      return formatPerformanceFieldValue(field, value, scope);
    if (field === "continuity")
      return (
        list(value, 128)
          .map((raw) => {
            const note = shape(raw, ["kind", "text"]);
            return `${enumeration(note.kind, { missing_look: "外貌待核", prop: "道具待核", gaze: "视线待核", axis: "轴线待核", cut: "剪接说明" })}：${text(note.text)}`;
          })
          .join("\n") || "无"
      );
    if (field === "directorPlan") return directorPlan(value);
    if (field === "sourceReview") {
      const row = shape(value, ["evidence", "status", "hints", "issues"]);
      if (row.evidence !== "declared-paragraph-order") reject();
      const issues = list(row.issues, 8).map((v) =>
        enumeration(v, {
          "source-unavailable": "原文范围未核验",
          "source-missing": "缺少原文段声明",
          "source-unknown": "包含未知原文段声明",
          "source-out-of-order": "原文段声明顺序需核对",
        }),
      );
      return `按申报段落顺序核对（非事实证明）；${flags(row.status)}；${list(row.hints, 128).map(paragraph).join("、") || "无原文段声明"}；${issues.join("、") || "无待核项"}`;
    }
    if (field === "source")
      return value === "sample"
        ? "示例"
        : value === "offline:director"
          ? "软件规则拆镜"
          : source(value);
    if (field === "characters") return list(value, 64).map(person).join("、") || "无";
    if (field === "speaker") return person(value);
    if (field === "lines") return lines(value);
    if (field === "no") return numeric(value, 1, 10000);
    if (field === "seconds") return `${numeric(value, 0.001, 36000)} 秒（预计，非实际媒体时长）`;
    if (field === "userFields")
      return (
        list(value, 64)
          .map((key) => {
            if (typeof key !== "string" || !Object.hasOwn(labels, key)) reject();
            return labels[key]!;
          })
          .join("、") || "无"
      );
    if (field === "continuityFromShotId") return value === "" ? "无" : shotLabel(value);
    if (field === "regenerationRequired") {
      const row = shape(value, ["code", "styleRevision"]);
      if (row.code !== "STYLE_CHANGED") reject();
      return `画风需核对 · 第 ${numeric(row.styleRevision, 0, 1000000)} 版（不会自动生成）`;
    }
    return text(value);
  }
  return { value, labels, sceneLabel, shotLabel, text, numeric, person };
}
