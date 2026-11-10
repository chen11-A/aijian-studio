import type {
  FilmProject,
  FilmShot,
  FilmStill,
  StillAcceptance,
  StillVerdict,
} from "../film/project";

export type StillCheckItem = {
  id: string;
  text: string;
};

/** The picture a person can adopt. A take path is not a still. */
export function currentStillUrl(shot: FilmShot): string {
  if (shot.poster) return shot.poster;
  const still = shot.stills.find((item) => item.url);
  if (still) return still.url;
  const take = shot.takes.find((item) => item.id === shot.selectedTakeId) ?? shot.takes[0];
  return take?.stillUrl || "";
}

function lookPoints(identity: string, gender: string, ageBand: string): string[] {
  const bits = identity
    .split(/[，。；、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const extra = [gender ? `性别：${gender}` : "", ageBand ? `年龄段：${ageBand}` : ""].filter(
    Boolean,
  );
  const points = [...new Set([...bits, ...extra])];
  if (!points.length) return ["外貌要点还没写"];
  return points.slice(0, 4);
}

/** R13 / §4.4. Empty cast is the establishing list. Animals stay in 应出现 by name. */
export function stillChecklist(film: FilmProject, shot: FilmShot): StillCheckItem[] {
  const scene = film.scenes.find((item) => item.id === shot.sceneId);
  const location = `地点：${scene?.where.trim() || "未写"}`;
  if (shot.characters.length === 0) {
    return [
      { id: "no-people", text: "画面里没有人物" },
      { id: "location", text: location },
    ];
  }
  const cast = film.characters.filter((item) => shot.characters.includes(item.name));
  const names = cast.length ? cast.map((item) => item.name) : shot.characters;
  const excluded = film.characters
    .map((item) => item.name)
    .filter((name) => !shot.characters.includes(name));
  const items: StillCheckItem[] = [
    { id: "appear", text: `应出现：${names.join("、")}` },
    {
      id: "excluded",
      text: excluded.length ? `不应出现：${excluded.join("、")}` : "不应出现：没有其他已知角色",
    },
  ];
  for (const character of cast) {
    lookPoints(character.identity, character.gender ?? "", character.ageBand ?? "").forEach(
      (point, index) => {
        items.push({
          id: `look:${character.id}:${index}`,
          text: `外貌：${character.name} · ${point}`,
        });
      },
    );
  }
  for (const prop of film.props) {
    items.push({
      id: `prop:${prop.id}`,
      text: `道具 ${prop.name}：${prop.note.trim() || "未写状态"}`,
    });
  }
  items.push({ id: "location", text: location });
  return items;
}

function stillFor(shot: FilmShot, url: string): FilmStill | undefined {
  return shot.stills.find((item) => item.url === url);
}

export function stillAccepted(film: FilmProject, shot: FilmShot): boolean {
  const url = currentStillUrl(shot);
  if (!url) return false;
  const saved = stillFor(shot, url)?.acceptance;
  if (!saved?.adopted || saved.stillUrl !== url) return false;
  const items = stillChecklist(film, shot);
  if (saved.checklist.length !== items.length) return false;
  return items.every((item) =>
    saved.checklist.some((row) => row.id === item.id && row.verdict === "match"),
  );
}

export function videoGate(film: FilmProject, shot: FilmShot): { enabled: boolean; reason: string } {
  if (!currentStillUrl(shot) || stillAccepted(film, shot)) return { enabled: true, reason: "" };
  return { enabled: false, reason: `镜头 ${shot.no} 的画面还没核对` };
}

export function firstUnacceptedStill(film: FilmProject): FilmShot | null {
  return film.shots.find((shot) => currentStillUrl(shot) && !stillAccepted(film, shot)) ?? null;
}

export function savedVerdicts(film: FilmProject, shot: FilmShot): Record<string, StillVerdict> {
  const url = currentStillUrl(shot);
  const saved = url ? stillFor(shot, url)?.acceptance : undefined;
  const items = stillChecklist(film, shot);
  if (!saved || saved.checklist.length !== items.length) return {};
  if (!items.every((item) => saved.checklist.some((row) => row.id === item.id))) return {};
  return Object.fromEntries(saved.checklist.map((row) => [row.id, row.verdict]));
}

/** Writes the human review onto the current still. A mismatch is kept and is not adoption. */
export function saveStillReview(
  film: FilmProject,
  shotId: string,
  verdicts: Record<string, StillVerdict>,
  at: string,
): { film: FilmProject; adopted: boolean; error: string } {
  const shot = film.shots.find((item) => item.id === shotId);
  if (!shot) return { film, adopted: false, error: "没有这一镜" };
  const url = currentStillUrl(shot);
  if (!url) return { film, adopted: false, error: "还没有画面" };
  const items = stillChecklist(film, shot);
  if (items.some((item) => verdicts[item.id] !== "match" && verdicts[item.id] !== "mismatch"))
    return { film, adopted: false, error: "还没逐项核对" };
  const adopted = items.every((item) => verdicts[item.id] === "match");
  const acceptance: StillAcceptance = {
    by: "user",
    at,
    stillUrl: url,
    adopted,
    checklist: items.map((item) => ({ id: item.id, verdict: verdicts[item.id]! })),
  };
  const stills = shot.stills.some((item) => item.url === url)
    ? shot.stills.map((item) => (item.url === url ? { ...item, acceptance } : item))
    : [...shot.stills, { id: `still-${shot.id}`, prompt: "", url, acceptance }];
  return {
    adopted,
    error: adopted ? "" : "有一项不符合，不能采用",
    film: {
      ...film,
      shots: film.shots.map((item) => (item.id === shot.id ? { ...item, stills } : item)),
    },
  };
}
