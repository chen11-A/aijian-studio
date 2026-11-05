import { expect, it, vi } from "vitest";
import { sampleFilm, type FilmShot } from "../film/project";
import { repairDirectorCoverage } from "./director-workflow";

const scene = { id: "s1", title: "门口", where: "门口", text: "最后关门。" };
function originals(): FilmShot[] {
  return Array.from({ length: 17 }, (_, i) => ({
    ...sampleFilm().shots[0]!,
    id: `s1-shot-${i + 1}`,
    sceneId: "s1",
    no: i + 1,
    picture: i === 16 ? "最后关门。" : `动作画面${i}。`,
    action: "",
    actionBeats: [],
    line: "",
    lines: [],
    speaker: "",
    seconds: 10,
    takes: [],
    stills: [],
    poster: "",
    selectedTakeId: "",
    continuityFrame: undefined,
    userFields: [],
  }));
}
const answer = (shots: FilmShot[]) => ({ text: JSON.stringify({ shots }), detail: "" });
function compressed(shots: FilmShot[]) {
  return [
    {
      ...shots[0]!,
      picture: shots
        .slice(0, 2)
        .map((s) => s.picture)
        .join("\n"),
      lines: shots.slice(0, 2).flatMap((s) => s.lines ?? []),
    },
    ...shots.slice(2),
  ];
}
it("requests compression once for a complete seventeen-shot scene", async () => {
  const shots = originals();
  const request = vi.fn(async () => answer(compressed(shots)));
  const result = await repairDirectorCoverage(scene, shots, request);
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.repaired).toBe(true);
  expect(result.shots).toHaveLength(16);
  expect(result.coverage.ok).toBe(true);
});
it("does not request an already complete sixteen-shot scene", async () => {
  const request = vi.fn();
  await repairDirectorCoverage(scene, compressed(originals()), request);
  expect(request).not.toHaveBeenCalled();
});
it("keeps the original when the reply still exceeds the cap", async () => {
  const shots = originals();
  const result = await repairDirectorCoverage(scene, shots, async () => answer(shots));
  expect(result.shots).toBe(shots);
  expect(result.repaired).toBe(false);
});
it.each(["speaker", "duplicate", "order", "picture"])(
  "rejects compression losing %s",
  async (kind) => {
    const shots = originals();
    shots[0]!.lines = [{ speaker: "甲", text: "再说一遍。" }];
    shots[1]!.lines = [{ speaker: "乙", text: "再说一遍。" }];
    const next = compressed(shots);
    if (kind === "speaker") next[0]!.lines = next[0]!.lines!.map((l) => ({ ...l, speaker: "丙" }));
    if (kind === "duplicate") next[0]!.lines = next[0]!.lines!.slice(0, 1);
    if (kind === "order") next[0]!.lines = [...next[0]!.lines!].reverse();
    if (kind === "picture") next[0]!.picture = shots[1]!.picture;
    const dialogueScene = { ...scene, text: "甲说：“再说一遍。”乙说：“再说一遍。”\n最后关门。" };
    const result = await repairDirectorCoverage(dialogueScene, shots, async () => answer(next));
    expect(result.shots).toBe(shots);
    expect(result.repaired).toBe(false);
  },
);
it("combines missing-tail repair and compression in one attempt", async () => {
  const shots = originals();
  shots[16]!.picture = "准备关门。";
  const next = compressed(shots);
  next[15] = { ...next[15]!, picture: `${next[15]!.picture}最后关门。` };
  const request = vi.fn(async () => answer(next));
  const result = await repairDirectorCoverage(scene, shots, request);
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.coverage.ok).toBe(true);
  expect(result.shots).toHaveLength(16);
});
it("keeps the complete original if compression fails or becomes stale", async () => {
  const shots = originals();
  expect(
    (
      await repairDirectorCoverage(scene, shots, async () => {
        throw Error("timeout");
      })
    ).shots,
  ).toBe(shots);
  let current = true;
  const result = await repairDirectorCoverage(
    scene,
    shots,
    async () => {
      current = false;
      return answer(compressed(shots));
    },
    () => current,
  );
  expect(result.shots).toBe(shots);
});

it("preserves repeated dialogue ownership when compressing a multi-speaker shot", async () => {
  const shots = originals();
  shots[0]!.lines = [{ speaker: "甲", text: "再说一遍。" }];
  shots[1]!.lines = [{ speaker: "乙", text: "再说一遍。" }];
  const dialogueScene = { ...scene, text: "甲说：“再说一遍。”乙说：“再说一遍。”\n最后关门。" };
  const result = await repairDirectorCoverage(dialogueScene, shots, async () =>
    answer(compressed(shots)),
  );
  expect(result.repaired).toBe(true);
  expect(result.shots.flatMap((s) => s.lines ?? [])).toEqual(shots.flatMap((s) => s.lines ?? []));
});

it("rejects a new parking event added during otherwise lossless compression", async () => {
  const shots = originals();
  const next = compressed(shots);
  next[0]!.picture += "面包车停在仓库外。";
  const result = await repairDirectorCoverage(
    { ...scene, text: "沈砚开着旧面包车跟了过来。\n最后关门。" },
    shots,
    async () => answer(next),
  );
  expect(result.repaired).toBe(false);
  expect(result.shots).toBe(shots);
});
