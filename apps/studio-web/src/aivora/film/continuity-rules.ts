import type { ContinuityNote } from "./contracts3j";
import type { FilmProject, FilmShot } from "./project";
import { inspectDirectorSources } from "./director-source-review";

const section = "文字与记录检查：";

/**
 * A shot without the notes applyContinuityChecks writes on every update. Those notes are
 * derived from the film and recomputed after any change, so comparing a shot for later edits
 * (an undo's compare-and-set) must not count them; notes a person wrote still count.
 */
export function withoutGeneratedContinuity<T extends { continuity?: unknown }>(shot: T): T {
  const old = shot.continuity;
  if (old === undefined) return shot;
  const notes = (Array.isArray(old) ? old : [old]).filter(
    (note) =>
      !(
        note &&
        typeof note === "object" &&
        String((note as { text?: unknown }).text ?? "").startsWith(section)
      ),
  );
  const rest = { ...shot };
  if (notes.length) (rest as { continuity?: unknown }).continuity = notes;
  else delete (rest as { continuity?: unknown }).continuity;
  return rest;
}
type CheckableShot = Omit<FilmShot, "continuity"> & {
  continuity?: ContinuityNote | ContinuityNote[];
};
export type ContinuityInput = Omit<FilmProject, "shots"> & { shots: CheckableShot[] };
export type ContinuityCheckedFilm = FilmProject;
const compact = (text: string) => text.replace(/\s+/g, "").replace(/[。.!！]+$/, "");
function description(shot: CheckableShot): string {
  return [shot.picture, shot.action, shot.performance, shot.blocking, shot.facing]
    .filter(Boolean)
    .join("。");
}
function prompt(shot: CheckableShot): string {
  return shot.promptZh?.trim() || description(shot);
}
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Only clauses naming exactly one known character are evidence of that character's state. */
function clauses(text: string, name: string, names: string[]): string[] {
  return text
    .split(/[。！？；，\n]/)
    .filter(
      (clause) =>
        clause.trim().startsWith(name) &&
        !/不|没|未|并非|[“”「」『』"]/.test(clause) &&
        !names.some((other) => other !== name && clause.includes(other)),
    );
}
function hand(text: string, prop: string): string | undefined {
  const item = escape(prop);
  const match = new RegExp(
    `([左右])手(?:中|里)?(?:握着|握|拿着|拿|持着|持|提着|提|攥着|攥|抓着|抓)(?:一把|一根|一支)?${item}|${item}(?:握|拿|持)?在([左右])手`,
  ).exec(text);
  return match?.[1] ?? match?.[2];
}
function uniqueEvidence(values: (string | undefined)[]): string | undefined {
  const present = new Set(values.filter((value): value is string => Boolean(value)));
  return present.size === 1 ? [...present][0] : undefined;
}
function localReference(value: string): string {
  if (!value.startsWith("aivora-media:")) return value;
  try {
    return new URL(value).searchParams.get("path") ?? value;
  } catch {
    return value;
  }
}

/** Text/metadata checks only. These notes never claim to have inspected generated images. */
export function continuityRisks(film: ContinuityInput): Record<string, ContinuityNote[]> {
  const output: Record<string, ContinuityNote[]> = {};
  const sourceReviews = new Map(
    film.scenes.flatMap((scene) =>
      inspectDirectorSources(scene, film.shots).map(
        ({ shotId, review }) => [shotId, review] as const,
      ),
    ),
  );
  const names = film.characters.map((person) => person.name).filter(Boolean);
  const props = [
    ...new Set(
      [...film.props.map((prop) => prop.name), "匕首", "刀", "铁棍", "手枪", "照片", "手机"].filter(
        Boolean,
      ),
    ),
  ];
  for (const [index, shot] of film.shots.entries()) {
    const notes: ContinuityNote[] = [];
    const add = (kind: ContinuityNote["kind"], text: string) => {
      if (!notes.some((note) => note.kind === kind && note.text === text))
        notes.push({ kind, text });
    };
    const text = prompt(shot);
    // Old projects without this parse-time review remain usable. The note concerns
    // attribution only; an ordered claim is not proof that the prose is faithful.
    const sourceReview = shot.sourceReview ? sourceReviews.get(shot.id) : undefined;
    if (sourceReview?.status === "needs_review") {
      add(
        "cut",
        sourceReview.issues.includes("source-out-of-order")
          ? "这一镜引用了前面已经拍过的原文，请核对情节顺序。"
          : "这一镜的原文出处还需核对，不能据此确认情节没有新增。",
      );
    }
    for (const name of new Set(shot.characters)) {
      const person = film.characters.find((person) => person.name === name);
      if (!person) continue;
      if (!person.identity.trim())
        add("missing_look", `${name}尚未填写固定外貌句，请先补全人物描述。`);
      else if (!compact(text).includes(compact(person.identity)))
        add("missing_look", `${name}的固定外貌句未出现在本镜中文描述中，请核对是否遗漏。`);
    }
    const previous = film.shots[index - 1];
    if (previous?.sceneId === shot.sceneId) {
      const before = prompt(previous);
      const after = text;
      for (const name of shot.characters.filter((name) => previous.characters.includes(name))) {
        const oldClauses = clauses(before, name, names);
        const newClauses = clauses(after, name, names);
        const currentAction = `${newClauses.join("。")}。${shot.action}`;
        for (const prop of props) {
          const oldHand = uniqueEvidence(oldClauses.map((clause) => hand(clause, prop)));
          const newHand = uniqueEvidence(newClauses.map((clause) => hand(clause, prop)));
          if (
            oldHand &&
            newHand &&
            oldHand !== newHand &&
            !/换手|转交|递到|交到|换到/.test(currentAction)
          )
            add(
              "prop",
              `${name}持${prop}的文字由${oldHand}手变为${newHand}手，未写换手过程，请核对道具衔接。`,
            );
        }
        const gaze = (values: string[]) =>
          uniqueEvidence(
            values.map(
              (clause) => /(?:看向|望向|视线朝向|视线朝)(?:画面|画)(左|右)/.exec(clause)?.[1],
            ),
          );
        const oldGaze = gaze(oldClauses);
        const newGaze = gaze(newClauses);
        if (
          oldGaze &&
          newGaze &&
          oldGaze !== newGaze &&
          !/转头|回头|转身|改看|移开视线/.test(currentAction)
        )
          add(
            "gaze",
            `${name}的文字视线从画${oldGaze}变为画${newGaze}，请核对是否需要转头或视线过渡。`,
          );
      }
      const side = (value: string) =>
        uniqueEvidence(
          [...value.matchAll(/(?:机位|摄影机)(?:在|位于)轴线([左右])侧/g)].map((match) => match[1]),
        );
      const oldSide = side(before);
      const newSide = side(after);
      if (
        oldSide &&
        newSide &&
        oldSide !== newSide &&
        !/中性镜头|过轴镜头|机位绕行|摄影机绕行/.test(after)
      )
        add(
          "axis",
          `机位文字从轴线${oldSide}侧改到${newSide}侧，未注明过轴镜头，请人工核对180度轴线。`,
        );
    }
    if (shot.continuityFromShotId) {
      if (
        !previous ||
        previous.id !== shot.continuityFromShotId ||
        previous.sceneId !== shot.sceneId
      )
        add("cut", "衔接标记未指向同场紧邻前镜，请重新确认前镜。");
      else if (shot.continuityFrame) {
        const frame = shot.continuityFrame;
        const selected = previous.takes.find((take) => take.id === previous.selectedTakeId);
        if (
          !selected ||
          selected.status !== "done" ||
          frame.sourceShotId !== previous.id ||
          frame.sourceTakeId !== selected.id ||
          localReference(frame.sourceVideoPath) !== localReference(selected.videoPath) ||
          frame.path !== shot.poster
        )
          add("cut", "已保存的衔接首帧与前镜当前选定版本或本镜画面不一致，请重新提取末帧。");
      }
    }
    output[shot.id] = notes;
  }
  return output;
}

/** Migrate legacy single notes to C13 arrays; preserve external notes, including B04 cut.
 * Rechecks replace only this module's labelled, evidence-limited notes. */
export function applyContinuityChecks(film: ContinuityInput): ContinuityCheckedFilm {
  const risks = continuityRisks(film);
  let changed = false;
  const shots = film.shots.map((shot): FilmShot => {
    const old = shot.continuity;
    const existing = Array.isArray(old) ? old : old ? [old] : [];
    const preserved = existing.filter((note) => !note.text.startsWith(section));
    const generated = (risks[shot.id] ?? []).map((note) => ({
      ...note,
      text: `${section}${note.text}`,
    }));
    const continuity = [...preserved, ...generated].filter(
      (note, index, all) =>
        all.findIndex((other) => other.kind === note.kind && other.text === note.text) === index,
    );
    if (
      (old === undefined && continuity.length === 0) ||
      (Array.isArray(old) && JSON.stringify(old) === JSON.stringify(continuity))
    )
      return shot as FilmShot; // The guard proves this is no longer a legacy single-note shape.
    changed = true;
    return { ...shot, continuity };
  });
  // Every unchanged shot passed the array/undefined guard above.
  return changed ? { ...film, shots } : (film as FilmProject);
}
