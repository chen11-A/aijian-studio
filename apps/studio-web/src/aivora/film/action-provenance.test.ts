import { expect, it } from "vitest";
import { sampleFilm, type FilmShot } from "./project";
import { assignActionBeats } from "./operations";
import { applyActionPlan } from "./action-plan";
import { parseDirectorPlan } from "./director-plan";

const text = "林晚问：“报警？”\n沈砚挥棍击中周烈肩头。";
const film = () => {
  const base = sampleFilm();
  base.scenes = [
    {
      ...base.scenes[0]!,
      id: "s",
      text,
      writerSourceText: text,
      writerParagraphIds: ["P001", "P002"],
      sourceParagraphIds: ["P001", "P002"],
      userFields: [],
    },
  ];
  base.shots = [];
  return base;
};
const shot = (id: string, picture: string, hint: string): FilmShot => ({
  ...sampleFilm().shots[0]!,
  id,
  sceneId: "s",
  picture,
  action: "",
  actionBeats: [],
  line: "",
  lines: [],
  characters: ["林晚", "沈砚", "周烈"],
  userFields: [],
  directorPlan: parseDirectorPlan({ source: hint }, sampleFilm().shots[0]!),
});
it("uses reliable source paragraph attribution for a silent frame without fight keywords", () => {
  const base = film();
  const target = shot("hit", "两人身影交错", "P002");
  const result = assignActionBeats(
    [target],
    "s",
    [{ text: "沈砚挥棍击中周烈肩头" }],
    text,
    base.scenes[0],
  );
  expect(result.unassignedBeats).toEqual([]);
  expect(result.shots[0]!.action).toContain("挥棍");
});
it("does not bind a fight onto the earlier bookstore dialogue even with an erroneous action hint", () => {
  const base = film();
  const target = {
    ...shot("talk", "林晚询问沈砚", "P002"),
    line: "报警？",
    speaker: "林晚",
    lines: [{ speaker: "林晚", text: "报警？" }],
  };
  const result = assignActionBeats(
    [target],
    "s",
    [{ shotId: "talk", text: "沈砚挥棍击中周烈肩头" }],
    text,
    base.scenes[0],
  );
  expect(result.unassignedBeats).toHaveLength(1);
});
it.each(["stale", "unknown", "duplicate", "locked", "ambiguous"])(
  "rejects unreliable %s attribution",
  (kind) => {
    const base = film();
    const scene = base.scenes[0]!;
    const target = shot("hit", "两人身影交错", "P002");
    if (kind === "stale") scene.writerSourceText = "旧原文";
    if (kind === "unknown") scene.sourceParagraphIds = ["P001"];
    if (kind === "duplicate") scene.writerParagraphIds = ["P002", "P002"];
    if (kind === "locked") target.userFields = ["action"];
    const shots = kind === "ambiguous" ? [target, { ...target, id: "other" }] : [target];
    expect(
      assignActionBeats(shots, "s", [{ text: "沈砚挥棍击中周烈肩头" }], text, scene)
        .unassignedBeats,
    ).toHaveLength(1);
  },
);
it("does not authorize an unrelated action because the paragraph shares people or weapons", () => {
  const base = film();
  const target = shot("hit", "两人身影交错", "P002");
  expect(
    assignActionBeats([target], "s", [{ text: "周烈挥棍击中沈砚膝盖" }], text, base.scenes[0])
      .unassignedBeats,
  ).toHaveLength(1);
});
it("uses literal same-sentence visual evidence without demanding a fight keyword in the frame", () => {
  const source = "沈砚挥棍击中周烈肩头，雨水沿着衣领淌下。";
  const target = shot("hit", "雨水沿着衣领淌下", "");
  expect(
    assignActionBeats([target], "s", [{ text: "沈砚挥棍击中周烈肩头" }], source).unassignedBeats,
  ).toEqual([]);
  expect(
    assignActionBeats([target], "s", [{ text: "沈砚挥棍击中周烈肩头" }], source.replace("，", "。"))
      .unassignedBeats,
  ).toHaveLength(1);
});
it("uses identical evidence for structured stale-ID nodes", () => {
  const base = film();
  base.shots = [shot("hit", "两人身影交错", "P002")];
  const result = applyActionPlan(base, "s", {
    shots: [{ shot_id: "stale", nodes: [{ actor: "沈砚", move: "沈砚挥棍击中周烈肩头" }] }],
  });
  expect(result.scenes[0]!.actionState!.unassigned).toEqual([]);
  expect(result.shots[0]!.actionPlan!.nodes).toHaveLength(1);
});

it("keeps ambiguous legacy sentence matches unassigned without paragraph metadata", () => {
  const source = "沈砚挥棍击中周烈肩头，雨水沿着衣领淌下。";
  const shots = [shot("one", "雨水沿着衣领淌下", ""), shot("two", "雨水沿着衣领淌下", "")];
  expect(
    assignActionBeats(shots, "s", [{ text: "沈砚挥棍击中周烈肩头" }], source).unassignedBeats,
  ).toHaveLength(1);
});

it("does not use just people and weapon names as a legacy source anchor", () => {
  const source = "沈砚挥棍击中周烈肩头，林晚沈砚周烈铁棍钢管折叠刀。";
  const target = shot("names", "林晚沈砚周烈铁棍钢管折叠刀", "");
  expect(
    assignActionBeats([target], "s", [{ text: "沈砚挥棍击中周烈肩头" }], source).unassignedBeats,
  ).toHaveLength(1);
});
