import type { FilmProject, FilmShot } from "../../film/project";
import type { EditorSelection } from "./editor-context";
export type ReferenceErrorCode =
  "ASSISTANT_REFERENCE_UNKNOWN" | "ASSISTANT_REFERENCE_AMBIGUOUS" | "ASSISTANT_REFERENCE_SYNTAX";
export type ReferenceTarget =
  | { kind: "character"; id: string }
  | { kind: "shot"; id: string }
  | { kind: "location"; id: string };
export type ReferenceScope = "project" | "scene" | "shot";
export type ReferenceCapture = {
  projectId: string;
  selection: EditorSelection;
  taskScope: ReferenceScope;
  targets: ReferenceTarget[];
  fingerprint: string;
  labels: string[];
  context: string;
};
export type ReferenceCandidate = { token: string; label: string; disabled: boolean };
const boundary = (c: string | undefined) =>
  !c || /[\s，。！？、；：,.!?;:()[\]{}<>「」“”"'‘’]/u.test(c);
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, v]) => [key, canonical(v)]),
        )
      : value;
const stable = (value: unknown) => JSON.stringify(canonical(value));
export function referenceTaskScope(role: string): ReferenceScope {
  return role === "writer" || role === "art" || role === "cast"
    ? "project"
    : role === "director"
      ? "scene"
      : "shot";
}
const personText = (p: FilmProject["characters"][number]) => ({
  kind: "character",
  name: p.name,
  identity: p.identity,
  gender: p.gender ?? "",
  ageBand: p.ageBand ?? "",
});
const locationText = (p: FilmProject["locations"][number]) => ({
  kind: "location",
  name: p.name,
  prompt: p.prompt,
  ambience: p.ambience,
  layout: p.layout ?? "",
});
const namedTargets = (film: FilmProject, name: string): ReferenceTarget[] => [
  ...film.characters
    .filter((p) => p.name === name)
    .map((p) => ({ kind: "character" as const, id: p.id })),
  ...film.locations
    .filter((p) => p.name === name)
    .map((p) => ({ kind: "location" as const, id: p.id })),
];
const shotText = (s: FilmShot) => ({
  kind: "shot",
  no: s.no,
  size: s.size,
  picture: s.picture,
  action: s.action,
  actionBeats: [...(s.actionBeats ?? [])],
  performance: s.performance,
  characters: [...s.characters],
  line: s.line,
  speaker: s.speaker ?? "",
  lines: (s.lines ?? []).map((line) => ({ speaker: line.speaker, text: line.text })),
});
function resolveTargets(film: FilmProject, targets: readonly ReferenceTarget[], sceneId?: string) {
  const rows: {
    target: ReferenceTarget;
    text:
      ReturnType<typeof personText> | ReturnType<typeof locationText> | ReturnType<typeof shotText>;
  }[] = [];
  for (const target of targets) {
    if (target.kind === "character") {
      const found = film.characters.filter((p) => p.id === target.id);
      if (found.length !== 1 || namedTargets(film, found[0]!.name).length !== 1) return null;
      rows.push({ target, text: personText(found[0]!) });
    } else if (target.kind === "location") {
      const found = film.locations.filter((p) => p.id === target.id);
      if (found.length !== 1 || namedTargets(film, found[0]!.name).length !== 1) return null;
      rows.push({ target, text: locationText(found[0]!) });
    } else {
      const found = film.shots.filter((s) => s.id === target.id);
      if (
        found.length !== 1 ||
        found[0]!.sceneId !== sceneId ||
        film.shots.filter((s) => s.sceneId === found[0]!.sceneId && s.no === found[0]!.no)
          .length !== 1
      )
        return null;
      rows.push({ target, text: shotText(found[0]!) });
    }
  }
  return rows;
}
/** Exact project names and this scene's shot numbers. Quoted names allow spaces and reserved words. */
export function captureAssistantReferences(
  film: FilmProject,
  selection: EditorSelection,
  text: string,
  role: string,
): { ok: true; capture: ReferenceCapture } | { ok: false; code: ReferenceErrorCode } {
  const error = (code: ReferenceErrorCode) => ({ ok: false as const, code });
  if (film.id !== selection.projectId) return error("ASSISTANT_REFERENCE_UNKNOWN");
  const targets: ReferenceTarget[] = [],
    labels: string[] = [];
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== "@" || (at > 0 && /[A-Za-z0-9_.+-]/u.test(text[at - 1]!))) continue;
    let name = "",
      no: number | null = null,
      end = at + 1;
    if (text[end] === '"') {
      let escaped = false,
        closed = false;
      for (let i = end + 1; i < text.length; i++) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (text[i] === "\\") {
          escaped = true;
          continue;
        }
        if (text[i] === '"') {
          end = i + 1;
          closed = true;
          break;
        }
      }
      if (!closed) return error("ASSISTANT_REFERENCE_SYNTAX");
      try {
        name = JSON.parse(text.slice(at + 1, end));
      } catch {
        return error("ASSISTANT_REFERENCE_SYNTAX");
      }
      if (!boundary(text[end])) return error("ASSISTANT_REFERENCE_SYNTAX");
    } else {
      const shot = /^镜头[ \t]*([0-9]+)/u.exec(text.slice(end));
      if (shot) {
        end += shot[0].length;
        no = Number(shot[1]);
        if (!Number.isSafeInteger(no) || no <= 0 || !boundary(text[end]))
          return error("ASSISTANT_REFERENCE_UNKNOWN");
      } else {
        while (end < text.length && !boundary(text[end])) end++;
        name = text.slice(at + 1, end);
        if (!name) return error("ASSISTANT_REFERENCE_SYNTAX");
      }
    }
    if (
      no !== null &&
      (!selection.sceneId || film.scenes.filter((s) => s.id === selection.sceneId).length !== 1)
    )
      return error("ASSISTANT_REFERENCE_UNKNOWN");
    const found =
      no === null
        ? namedTargets(film, name)
        : film.shots
            .filter((s) => s.sceneId === selection.sceneId && s.no === no)
            .map((s) => ({ kind: "shot" as const, id: s.id }));
    if (!found.length) return error("ASSISTANT_REFERENCE_UNKNOWN");
    if (found.length !== 1) return error("ASSISTANT_REFERENCE_AMBIGUOUS");
    const target = found[0]!;
    if (!targets.some((r) => r.kind === target.kind && r.id === target.id)) {
      targets.push(target);
      labels.push(no === null ? name : `镜头 ${no}`);
    }
    at = end - 1;
  }
  const resolved = resolveTargets(film, targets, selection.sceneId);
  if (!resolved) return error("ASSISTANT_REFERENCE_AMBIGUOUS");
  const taskScope = referenceTaskScope(role);
  const scopeText =
    taskScope === "project"
      ? "全项目；引用仅作参考，不缩小写入范围"
      : taskScope === "scene"
        ? "当前场；引用不替换当前场次"
        : "当前选中镜头；引用不切换编辑目标";
  return {
    ok: true,
    capture: {
      projectId: film.id,
      selection: structuredClone(selection),
      taskScope,
      targets,
      labels,
      fingerprint: stable(resolved),
      context: JSON.stringify({
        userRequest: text,
        taskScope,
        modificationScope: scopeText,
        references: resolved.map((r) => r.text),
      }),
    },
  };
}
/** Forward request/confirmation guard only. Applied-card undo must retain its original after-state lock. */
export function assistantReferencesCurrent(
  capture: ReferenceCapture,
  film: FilmProject | null,
  selection: EditorSelection,
): boolean {
  if (!film || film.id !== capture.projectId || stable(selection) !== stable(capture.selection))
    return false;
  const rows = resolveTargets(film, capture.targets, capture.selection.sceneId);
  return !!rows && stable(rows) === capture.fingerprint;
}
export function referenceCandidates(
  film: FilmProject,
  shots: readonly FilmShot[],
): ReferenceCandidate[] {
  const names = [
    ...new Set(
      [...film.characters.map((p) => p.name), ...film.locations.map((p) => p.name)].filter(Boolean),
    ),
  ];
  return [
    ...names.map((name) => {
      const token =
        /[\s，。！？、；：,.!?;:()[\]{}<>「」“”"'‘’@]/u.test(name) || /^镜头[ \t]*\d/u.test(name)
          ? `@${JSON.stringify(name)}`
          : `@${name}`;
      const disabled = namedTargets(film, name).length !== 1;
      return { token, label: disabled ? `${token}（重名，暂不能引用）` : token, disabled };
    }),
    ...[...new Set(shots.map((s) => s.no))].map((no) => {
      const disabled = shots.filter((s) => s.no === no).length !== 1;
      return {
        token: `@镜头 ${no}`,
        label: disabled ? `@镜头 ${no}（镜号重复）` : `@镜头 ${no}`,
        disabled,
      };
    }),
  ];
}
