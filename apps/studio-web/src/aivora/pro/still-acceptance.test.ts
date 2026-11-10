import { describe, expect, it } from "vitest";
import { blankFilm, type FilmCharacter, type FilmShot } from "../film/project";
import {
  firstUnacceptedStill,
  saveStillReview,
  stillAccepted,
  stillChecklist,
  videoGate,
} from "./still-acceptance";

function character(id: string, name: string, identity: string): FilmCharacter {
  return {
    id,
    name,
    identity,
    gender: "女",
    ageBand: "青年",
    voiceId: "",
    source: "test",
    userFields: [],
    portraits: [],
  };
}

function shot(partial: Partial<FilmShot> & Pick<FilmShot, "id" | "no" | "characters">): FilmShot {
  return {
    sceneId: "scene-1",
    size: "中景",
    angle: "平视",
    move: "固定",
    seconds: 3,
    picture: "",
    action: "",
    performance: "",
    line: "",
    sound: { source: "native", ambience: "", sfx: [], musicMood: "" },
    source: "test",
    userFields: [],
    poster: "",
    posterPosition: "",
    takes: [],
    stills: [],
    selectedTakeId: "",
    ...partial,
  };
}

function filmWith(next: FilmShot, extras?: { excluded?: boolean; prop?: boolean }) {
  const film = blankFilm();
  film.scenes[0] = { ...film.scenes[0]!, id: "scene-1", where: "旧书店" };
  film.characters = [character("girl", "女孩", "黑长发，蓝外套")];
  if (extras?.excluded) film.characters.push(character("elder", "老人", "白发，灰衣"));
  if (next.characters.includes("猫")) film.characters.push(character("cat", "猫", "橘色短毛"));
  if (extras?.prop) film.props = [{ id: "scarf", name: "围巾", note: "红格" }];
  film.shots = [next];
  return film;
}

describe("still checklist", () => {
  it("lists cast including an animal, excluded people, looks, a prop, and the place", () => {
    const film = filmWith(
      shot({ id: "s2", no: 2, characters: ["女孩", "猫"], poster: "/still.png" }),
      { excluded: true, prop: true },
    );
    expect(stillChecklist(film, film.shots[0]!).map((item) => item.text)).toEqual([
      "应出现：女孩、猫",
      "不应出现：老人",
      "外貌：女孩 · 黑长发",
      "外貌：女孩 · 蓝外套",
      "外貌：女孩 · 性别：女",
      "外貌：女孩 · 年龄段：青年",
      "外貌：猫 · 橘色短毛",
      "外貌：猫 · 性别：女",
      "外貌：猫 · 年龄段：青年",
      "道具 围巾：红格",
      "地点：旧书店",
      "画面：未写",
    ]);
  });

  it("uses the establishing list when the shot has no cast", () => {
    const film = filmWith(shot({ id: "s1", no: 1, characters: [], poster: "/empty.png" }));
    expect(stillChecklist(film, film.shots[0]!).map((item) => item.text)).toEqual([
      "画面里没有人物",
      "地点：旧书店",
      "画面：未写",
    ]);
  });

  it("refuses adoption until every item matches, then keeps the review on that still", () => {
    const film = filmWith(shot({ id: "s1", no: 1, characters: [], poster: "/empty.png" }));
    const blocked = saveStillReview(
      film,
      "s1",
      { "no-people": "match", location: "mismatch", picture: "match" },
      "2026-11-10T00:00:00.000Z",
    );
    expect(blocked.adopted).toBe(false);
    expect(blocked.error).toBe("有一项不符合，不能采用");
    expect(stillAccepted(blocked.film, blocked.film.shots[0]!)).toBe(false);
    expect(videoGate(blocked.film, blocked.film.shots[0]!)).toEqual({
      enabled: false,
      reason: "镜头 1 的画面还没核对",
    });
    const adopted = saveStillReview(
      blocked.film,
      "s1",
      { "no-people": "match", location: "match", picture: "match" },
      "2026-11-10T00:00:01.000Z",
    );
    expect(adopted.adopted).toBe(true);
    expect(stillAccepted(adopted.film, adopted.film.shots[0]!)).toBe(true);
    expect(adopted.film.shots[0]!.stills[0]!.acceptance).toMatchObject({
      by: "user",
      stillUrl: "/empty.png",
      adopted: true,
    });
    const moved = {
      ...adopted.film,
      shots: [{ ...adopted.film.shots[0]!, poster: "/other.png" }],
    };
    expect(stillAccepted(moved, moved.shots[0]!)).toBe(false);
    expect(firstUnacceptedStill(moved)?.id).toBe("s1");
    expect(adopted.film.shots[0]!.stills[0]!.id).not.toBe("still-s1");
  });

  it("drops adoption when the place changes, and keeps a saved mismatch across a reload", () => {
    const film = filmWith(shot({ id: "s1", no: 1, characters: [], poster: "/empty.png" }));
    const saved = saveStillReview(
      film,
      "s1",
      { "no-people": "match", location: "mismatch", picture: "match" },
      "2026-11-10T00:00:00.000Z",
    );
    const reopened = JSON.parse(JSON.stringify(saved.film)) as typeof saved.film;
    expect(stillAccepted(reopened, reopened.shots[0]!)).toBe(false);
    expect(
      reopened.shots[0]!.stills[0]!.acceptance?.checklist.find((row) => row.id === "location")
        ?.verdict,
    ).toBe("mismatch");
    const adopted = saveStillReview(
      reopened,
      "s1",
      { "no-people": "match", location: "match", picture: "match" },
      "2026-11-10T00:00:01.000Z",
    );
    expect(stillAccepted(adopted.film, adopted.film.shots[0]!)).toBe(true);
    const movedPlace = {
      ...adopted.film,
      scenes: adopted.film.scenes.map((scene) =>
        scene.id === "scene-1" ? { ...scene, where: "新地点" } : scene,
      ),
    };
    expect(stillAccepted(movedPlace, movedPlace.shots[0]!)).toBe(false);
    expect(videoGate(movedPlace, movedPlace.shots[0]!).enabled).toBe(false);
  });

  it("treats a damaged acceptance record as not adopted", () => {
    const film = filmWith(shot({ id: "s1", no: 1, characters: [], poster: "/empty.png" }));
    film.shots[0]!.stills = [
      {
        id: "broken",
        prompt: "",
        url: "/empty.png",
        acceptance: { adopted: "yes" } as never,
      },
    ];
    expect(stillAccepted(film, film.shots[0]!)).toBe(false);
    expect(videoGate(film, film.shots[0]!).reason).toBe("镜头 1 的画面还没核对");
  });
});
