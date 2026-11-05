import { chosenExport } from "../../film/operations";
import type { FilmProject } from "../../film/project";

export type ExportLead = {
  /** 导出成片 is the one primary button on this screen; the page's own steps back. */
  lead: boolean;
  /** At least one shot has a video the export would use. */
  ready: boolean;
  /** Why it is grayed, shown next to it. Empty when it is ready. */
  why: string;
};

/**
 * 4A-U09: how the 导出成片 button in the top bar looks. Plain most of the time. It is the one
 * primary button on 剪辑, and on every page once every shot has its video, except while the
 * person is working on one part of the cut (a selected range or a comparison), where that
 * part's button leads. With nothing to export yet it is grayed with the reason beside it; a
 * click still opens the dialog, which lists the shots that are missing scene by scene.
 */
export function exportLead(film: FilmProject | null, stage: string, focused: boolean): ExportLead {
  if (!film) return { lead: false, ready: false, why: "先新建或打开一部作品" };
  const plan = chosenExport(film);
  if (plan.paths.length === 0) return { lead: false, ready: false, why: "还没有视频可导出" };
  const allMade = plan.missing.length === 0;
  return { lead: !focused && (stage === "edit" || allMade), ready: true, why: "" };
}
