import { describe, expect, it } from "vitest";
import { sampleFilm, type FilmShot } from "../../film/project";
import { continuityNotes } from "./continuity";

const shot = sampleFilm().shots[0]!;
const withNotes = (continuity: unknown) => ({ ...shot, continuity }) as unknown as FilmShot;

describe("continuityNotes", () => {
  it("reads one note (3j-r1) or a list (gpt/work-4a) and names each kind plainly", () => {
    expect(continuityNotes(withNotes({ kind: "prop", text: "刀上一镜在左手。" }))).toEqual([
      { kind: "prop", title: "道具前后对不上", text: "刀上一镜在左手。" },
    ]);
    expect(
      continuityNotes(
        withNotes([
          { kind: "missing_look", text: "林晚的外貌没写进去。" },
          { kind: "axis", text: "沈砚跑到了画左。" },
          { kind: "gaze", text: "  " },
        ]),
      ).map((note) => note.title),
    ).toEqual(["外貌没写进这一镜", "人物左右换了边"]);
  });

  it("is empty without notes and never shows an unknown kind's id", () => {
    expect(continuityNotes(shot)).toEqual([]);
    expect(continuityNotes(withNotes([{ kind: "new_rule", text: "看一下。" }]))[0]?.title).toBe(
      "场记提醒",
    );
  });
});
