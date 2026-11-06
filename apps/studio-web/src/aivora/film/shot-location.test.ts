import { describe, expect, it } from "vitest";
import { continuityRisks } from "./continuity-rules";
import { locationReference, shotLocation } from "./location-reference";
import { sampleFilm, type FilmProject, type FilmShot } from "./project";

/** Scene 1 at the bookstore, scene 2 at the warehouse, each with a current reference image. */
function film(): FilmProject {
  const base = sampleFilm();
  const [first, second] = base.scenes;
  base.styleRevision = 0;
  base.scenes = [
    {
      ...first!,
      id: "s1",
      where: "青石巷晚照书店",
      text: "雨夜，书店还亮着灯。门外亮起两束车灯。",
    },
    {
      ...second!,
      id: "s2",
      where: "城东码头仓库",
      text: "三个男人撞开书店的门。半小时后，城东废弃的码头仓库。",
    },
  ];
  base.locations = [
    {
      id: "l1",
      name: "青石巷晚照书店",
      prompt: "",
      ambience: "",
      referenceImage: "/ws/l1.png",
      referenceStyleRevision: 0,
    },
    {
      id: "l2",
      name: "城东码头仓库",
      prompt: "",
      ambience: "",
      referenceImage: "/ws/l2.png",
      referenceStyleRevision: 0,
    },
  ];
  return base;
}

const shot = (base: FilmProject, picture: string, extra: Partial<FilmShot> = {}): FilmShot => ({
  ...base.shots[0]!,
  id: `shot-${picture.length}`,
  sceneId: "s2",
  picture,
  action: "",
  directorFramePrompt: undefined,
  ...extra,
});

describe("3JR-B13 (R2-B02) each shot gets the place it shows", () => {
  it("gives the bookstore shots at the start of scene 2 the bookstore's reference", () => {
    const base = film();
    expect(locationReference(base, shot(base, "三个男人撞开书店的门，书架被推倒。"))?.url).toBe(
      "/ws/l1.png",
    );
    // Only the picture part of the director's frame counts, not the people's looks.
    const framed = shot(base, "", {
      directorFramePrompt: "横屏构图。人物：周烈。画面：书店玻璃门口，周烈站在雨里。",
    });
    expect(locationReference(base, framed)?.url).toBe("/ws/l1.png");
  });

  it("keeps the warehouse for its own shots and for shots naming no place", () => {
    const base = film();
    expect(locationReference(base, shot(base, "城东废弃的码头仓库，雨砸在铁皮屋顶上。"))?.url).toBe(
      "/ws/l2.png",
    );
    expect(locationReference(base, shot(base, "林晚被推到一只木箱上。"))?.url).toBe("/ws/l2.png");
    expect(shotLocation(base, shot(base, "仓库里，书店老板的女儿被推过来。"))?.id).toBe("l2");
  });

  it("attaches nothing rather than a wrong background", () => {
    const base = film();
    base.locations[0] = { ...base.locations[0]!, referenceImage: undefined };
    expect(locationReference(base, shot(base, "三个男人撞开书店的门。"))).toBeNull();
  });
});

describe("3JR-B13 (R2-B02) a vehicle the scene never mentions is flagged", () => {
  it("notes the van in the warehouse scene, and not a car the source has", () => {
    const base = film();
    const van = shot(base, "一辆面包车停在仓库门口。");
    base.shots = [van];
    const notes = continuityRisks(base)[van.id] ?? [];
    expect(notes.map((note) => note.text)).toContain(
      "画面里写了「面包车」，这一场的原文没有，确认要不要留。",
    );
    base.scenes[1] = { ...base.scenes[1]!, text: `${base.scenes[1]!.text}一辆面包车开进来。` };
    expect((continuityRisks(base)[van.id] ?? []).some((note) => note.text.includes("面包车"))).toBe(
      false,
    );
  });
});
