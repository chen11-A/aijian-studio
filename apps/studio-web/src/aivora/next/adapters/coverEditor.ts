import type { CoverEditorProps } from "../CoverEditor";
import { mediaUrl } from "./media";
import { exportedShots } from "./names";
import { readProject } from "./read";
import { unreadable, type Adapted } from "./result";

export type CoverEditorData = Pick<CoverEditorProps, "title" | "subtitle" | "backgroundUrl">;

export type CoverEditorOptions = {
  /** Turns a saved still path into an address an <img> can load. Defaults to mediaUrl. */
  mediaUrl?: (path: string) => string;
};

/** The name blankFilm gives a new work. It is not a title anyone chose. */
const UNTITLED = "未命名作品";

/**
 * CoverEditor props. The title is the work's name, the subtitle the episode's. The background
 * is the still of the first shot the export uses, or else the first shot picture there is.
 * project.json has no cover settings, so the 「AI 生成」 switch starts as CoverEditor's default.
 */
export function coverEditorData(
  value: unknown,
  options: CoverEditorOptions = {},
): Adapted<CoverEditorData> {
  const read = readProject(value);
  if (!read.ok) return unreadable(read.reason);
  const project = read.project;
  const toUrl = options.mediaUrl ?? mediaUrl;
  const name = (project.seriesTitle || project.title).trim();
  const stills = [
    ...exportedShots(project).map(({ take }) => take.stillUrl),
    ...project.shots.flatMap((shot) => [shot.poster, ...shot.stills]),
  ];
  const backgroundUrl = stills.map(toUrl).find(Boolean);
  return {
    ok: true,
    props: {
      title: name === UNTITLED ? "" : name,
      ...(project.episodeTitle ? { subtitle: project.episodeTitle } : {}),
      ...(backgroundUrl ? { backgroundUrl } : {}),
    },
    missing: project.missing,
  };
}
