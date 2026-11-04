import type { FilmShot } from "./project";

export type DirectorSourceRef = {
  text: string;
  sourceParagraphIds?: string[];
  writerParagraphIds?: string[];
  writerSourceText?: string;
  userFields?: string[];
};
export type DirectorPosition = {
  name: string;
  position: string;
  depth: string;
  visible: string;
  scopeStatus: "matched" | "needs_review";
};
export type DirectorDialogueCue = {
  speaker: string;
  text: string;
  atSeconds: number | null;
  timingStatus: "specified" | "unspecified" | "needs_review";
};
export type DirectorSegment = {
  sourceShotId: string;
  seconds: number;
  purpose: string;
  emotion: string;
  positions: DirectorPosition[];
  dialogueCues: DirectorDialogueCue[];
  /** Scalar timing cannot be assigned to multiple lines by guessing. */
  unassignedLineAt?: number | null;
  sourceParagraphHints: string[];
  /** Membership validated at parse time, not semantic proof or permission for future costume changes. */
  verifiedSourceParagraphIds: string[];
  /** Declarations only: these are never resolved to actual uploaded images here. */
  referenceHints: { token: string; assetId: string }[];
};
export type ShotDirectorPlan = {
  segments: DirectorSegment[];
  sourceSnapshot: string;
  timingStatus: "current" | "needs_review";
};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const at = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Spatial/source baseline only. Later automatic acting and action enrichment is independent. */
function snapshot(shot: FilmShot): string {
  return JSON.stringify([
    shot.sceneId,
    shot.picture,
    shot.line,
    shot.lines,
    shot.speaker,
    shot.characters,
    shot.blocking,
    shot.facing,
  ]);
}
function current(shot: FilmShot): boolean {
  return Boolean(
    shot.directorPlan &&
    shot.directorPlan.sourceSnapshot === snapshot(shot) &&
    !shot.userFields.some((field) =>
      [
        "picture",
        "action",
        "line",
        "lines",
        "speaker",
        "characters",
        "blocking",
        "facing",
        "performance",
        "delivery",
        "promptZh",
      ].includes(field),
    ),
  );
}

function timingCurrent(shot: FilmShot): boolean {
  return (
    current(shot) &&
    shot.directorPlan!.timingStatus === "current" &&
    !shot.userFields.includes("seconds") &&
    shot.directorPlan!.segments.reduce((sum, segment) => sum + segment.seconds, 0) === shot.seconds
  );
}

export function parseDirectorPlan(
  record: Record<string, unknown>,
  shot: FilmShot,
  source?: DirectorSourceRef,
): ShotDirectorPlan | undefined {
  if (
    !["purpose", "emotion", "positions", "line_at", "source", "reference_images"].some(
      (key) => key in record,
    ) &&
    !list(record.lines ?? record.dialogue).some((row) => "line_at" in object(row))
  )
    return undefined;
  const rawLines = list(record.lines ?? record.dialogue);
  const accepted = shot.lines ?? [];
  const dialogueCues = accepted.map((line): DirectorDialogueCue => {
    const matches = rawLines
      .map(object)
      .filter(
        (row) =>
          text(row.text ?? row.line) === line.text &&
          (!text(row.speaker) || text(row.speaker) === line.speaker),
      );
    const raw =
      matches.length === 1
        ? matches[0]!.line_at
        : rawLines.length === 0 && accepted.length === 1
          ? record.line_at
          : undefined;
    const value = at(raw);
    const specified = value !== null && value >= 0 && value < shot.seconds;
    return {
      speaker: line.speaker,
      text: line.text,
      atSeconds: value,
      timingStatus:
        matches.length > 1
          ? "needs_review"
          : specified
            ? "specified"
            : raw == null
              ? "unspecified"
              : "needs_review",
    };
  });
  const hints = (Array.isArray(record.source) ? record.source : [record.source]).flatMap((value) =>
    typeof value === "string" && value.trim() ? [value.trim()] : [],
  );
  const trustedSource =
    source && source.writerSourceText === source.text && !source.userFields?.includes("text");
  const sourceIds = trustedSource ? (source.sourceParagraphIds ?? []) : [];
  const segment: DirectorSegment = {
    sourceShotId: text(record.id) || shot.id,
    seconds: shot.seconds,
    purpose: text(record.purpose),
    emotion: text(record.emotion),
    positions: list(record.positions).flatMap((raw) => {
      const row = object(raw);
      return text(row.name)
        ? [
            {
              name: text(row.name),
              position: text(row.position),
              depth: text(row.depth),
              visible: text(row.visible),
              scopeStatus: shot.characters.includes(text(row.name)) ? "matched" : "needs_review",
            },
          ]
        : [];
    }),
    dialogueCues,
    ...(record.line_at !== undefined && (accepted.length !== 1 || rawLines.length > 0)
      ? { unassignedLineAt: at(record.line_at) }
      : {}),
    sourceParagraphHints: hints,
    verifiedSourceParagraphIds: hints.filter(
      (id) => /^P\d{2,}$/.test(id) && sourceIds.includes(id),
    ),
    referenceHints: list(record.reference_images).flatMap((raw) => {
      const row = object(raw);
      return text(row.token) && text(row.asset_id)
        ? [{ token: text(row.token), assetId: text(row.asset_id) }]
        : [];
    }),
  };
  return {
    segments: [segment],
    sourceSnapshot: snapshot(shot),
    timingStatus: record.seconds === shot.seconds ? "current" : "needs_review",
  };
}

export function mergeDirectorPlans(
  left: FilmShot,
  right: FilmShot,
  merged: FilmShot,
): ShotDirectorPlan | undefined {
  if (!left.directorPlan && !right.directorPlan) return undefined;
  const segment = (shot: FilmShot): DirectorSegment[] =>
    shot.directorPlan?.segments ?? [
      {
        sourceShotId: shot.id,
        seconds: shot.seconds,
        purpose: "",
        emotion: "",
        positions: [],
        dialogueCues: [],
        sourceParagraphHints: [],
        verifiedSourceParagraphIds: [],
        referenceHints: [],
      },
    ];
  return {
    segments: [...segment(left), ...segment(right)],
    sourceSnapshot:
      (!left.directorPlan || current(left)) && (!right.directorPlan || current(right))
        ? snapshot(merged)
        : "",
    timingStatus:
      (!left.directorPlan || timingCurrent(left)) &&
      (!right.directorPlan || timingCurrent(right)) &&
      merged.seconds === left.seconds + right.seconds
        ? "current"
        : "needs_review",
  };
}

/** Typed notes enter generation, while source/image hints stay evidence only. */
export function directorPlanPrompt(shot: FilmShot, mode: "frame" | "video"): string {
  if (!current(shot)) return "";
  const plan = shot.directorPlan!;
  let offset = 0;
  return (mode === "frame" ? plan.segments.slice(0, 1) : plan.segments)
    .map((segment, index) => {
      const notes = [
        segment.purpose ? `镜头意图：${segment.purpose}` : "",
        segment.emotion ? `情绪：${segment.emotion}` : "",
        ...segment.positions
          .filter(
            (position) =>
              position.scopeStatus === "matched" && shot.characters.includes(position.name),
          )
          .map(
            (p) =>
              `人物位置：${[p.name, p.position, p.depth, p.visible].filter(Boolean).join("，")}`,
          ),
      ];
      if (mode === "video" && timingCurrent(shot)) {
        for (const cue of segment.dialogueCues) {
          if (cue.timingStatus === "specified")
            notes.push(
              `对白动作节奏参考：约${Number((offset + cue.atSeconds!).toFixed(3))}秒，${cue.speaker ? `${cue.speaker}：` : ""}「${cue.text}」（仅画面指导，不是配音排程）`,
            );
        }
      }
      offset += segment.seconds;
      const body = notes.filter(Boolean).join("。");
      return body ? `${plan.segments.length > 1 ? `第${index + 1}段：` : ""}${body}` : "";
    })
    .filter(Boolean)
    .join("\n");
}
