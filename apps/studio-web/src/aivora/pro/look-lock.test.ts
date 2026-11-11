import { expect, it } from "vitest";
import { sampleFilm, type FilmCharacter, type FilmProject, type FilmShot } from "../film/project";
import { saveStillReview, stillChecklist } from "./still-acceptance";
import { exportEntryBlock, firstLookBlock, lookBlock, lookReady } from "./look-lock";

function person(patch: Partial<FilmCharacter> = {}): FilmCharacter {
  return {
    id: "girl",
    name: "女孩",
    identity: "短发",
    voiceId: "",
    source: "user",
    userFields: [],
    portraits: [],
    ...patch,
  };
}

function shot(patch: Partial<FilmShot> = {}): FilmShot {
  return {
    id: "s1",
    sceneId: "01",
    no: 1,
    size: "中景",
    angle: "平视",
    move: "固定",
    seconds: 3,
    picture: "女孩站住",
    action: "",
    performance: "",
    characters: ["女孩"],
    line: "",
    sound: { mode: "silent", speech: [], beds: [] },
    source: "user",
    userFields: [],
    poster: "",
    posterPosition: "",
    takes: [],
    stills: [],
    selectedTakeId: "",
    ...patch,
  };
}

function film(characters: FilmCharacter[], rows: FilmShot[]): FilmProject {
  const base = sampleFilm();
  return { ...base, characters, shots: rows };
}

it("lets an empty shot and an off-screen person through, and blocks an unlocked on-screen person", () => {
  const girl = person({ lookLocked: false });
  const elder = person({ id: "elder", name: "老人", lookLocked: false });
  const empty = film([girl, elder], [shot({ characters: [], picture: "雨夜巷口" })]);
  expect(lookBlock(empty, empty.shots[0]!)).toBeNull();
  const absent = film(
    [girl, elder],
    [shot({ characters: ["女孩"], picture: "女孩站住。老人不入画。" })],
  );
  expect(lookBlock(absent, absent.shots[0]!)?.name).toBe("女孩");
  expect(firstLookBlock(absent, absent.shots)?.code).toBe("LOOK_NOT_LOCKED");
  const locked = film([person({ lookLocked: true }), elder], [shot()]);
  expect(lookBlock(locked, locked.shots[0]!)).toBeNull();
  const legacy = person({
    portraits: [{ view: "正面", prompt: "", url: "/portraits/girl.png" }],
  });
  expect(lookReady(legacy)).toBe(true);
  expect(lookReady(person())).toBe(true);
  expect(lookReady(person({ identity: "  ", lookLocked: undefined }))).toBe(false);
  expect(lookReady(person({ lookLocked: false, portraits: legacy.portraits }))).toBe(false);
});

it("refuses export of a chosen video whose still was not adopted", () => {
  const base = sampleFilm();
  const row = base.shots[0]!;
  row.poster = "/stills/frame.png";
  row.selectedTakeId = "take-1";
  row.takes = [
    {
      id: "take-1",
      shotId: row.id,
      index: 1,
      status: "done",
      stillUrl: "",
      videoPath: "/tmp/shot.mp4",
      videoUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ];
  expect(exportEntryBlock(base)?.code).toBe("STILL_NOT_ACCEPTED");
  const items = stillChecklist(base, row);
  const adopted = saveStillReview(
    base,
    row.id,
    Object.fromEntries(items.map((item) => [item.id, "match"])),
    "2026-11-11T00:00:00.000Z",
  ).film;
  expect(exportEntryBlock(adopted)).toBeNull();
});
