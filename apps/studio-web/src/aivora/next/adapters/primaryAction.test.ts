import { describe, expect, it } from "vitest";
import type { FilmProject, FilmShot } from "../../film/project";
import { exportLead } from "./primaryAction";

const shot = (id: string, video: boolean): FilmShot =>
  ({
    id,
    no: 1,
    selectedTakeId: video ? `${id}-take` : "",
    takes: video ? [{ id: `${id}-take`, status: "done", videoPath: `/tmp/${id}.mp4` }] : [],
  }) as unknown as FilmShot;

const film = (...made: boolean[]): FilmProject =>
  ({ shots: made.map((video, index) => shot(`s${index}`, video)) }) as unknown as FilmProject;

describe("exportLead", () => {
  it("is grayed with a reason while there is nothing to export", () => {
    expect(exportLead(null, "script", false)).toEqual({
      lead: false,
      ready: false,
      why: "先新建或打开一部作品",
    });
    expect(exportLead(film(false, false), "edit", false)).toEqual({
      lead: false,
      ready: false,
      why: "还没有视频可导出",
    });
  });

  it("leads on 剪辑, and everywhere once every shot has its video", () => {
    expect(exportLead(film(true, false), "board", false).lead).toBe(false);
    expect(exportLead(film(true, false), "edit", false).lead).toBe(true);
    expect(exportLead(film(true, true), "script", false).lead).toBe(true);
    expect(exportLead(film(true, true), "shot", false)).toEqual({
      lead: true,
      ready: true,
      why: "",
    });
  });

  it("steps back while a range or a comparison is being worked on", () => {
    expect(exportLead(film(true, true), "edit", true).lead).toBe(false);
  });
});
