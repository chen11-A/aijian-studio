import { afterEach, expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { shotLines } from "../../film/director-continuity";
import { prepareDialogueSplitPreview, dialogueSplitPreviewCurrent } from "./dialogue-split";
afterEach(() => {
  delete window.aijian;
  vi.restoreAllMocks();
});
function fixture() {
  const film = sampleFilm(),
    shot = film.shots[0]!;
  const text = ("字".repeat(35) + "。 ").repeat(3);
  shot.line = text;
  shot.lines = [{ speaker: "甲", text }];
  shot.speaker = "甲";
  return { film, shot };
}
it("adapts actual canonical shotLines, model and explicit current versions without speech/save/provider calls or edits", async () => {
  const { film, shot } = fixture(),
    before = structuredClone(film),
    paid = vi.fn(() => {
      throw Error("UNEXPECTED_CALL");
    });
  window.aijian = new Proxy({}, { get: () => paid }) as Window["aijian"];
  const result = await prepareDialogueSplitPreview(film, shot.id, { versions: 4 });
  expect(result.kind).toBe("READY");
  if (result.kind !== "READY") throw Error(result.code);
  expect(result.sourceLines).toEqual(shotLines(shot));
  expect(result.videoCount).toBe(result.parts.length * 4);
  expect(result.model).toBe(film.draft ? "grok-imagine-video-1.5-lite" : "grok-imagine-video-1.5");
  expect(result.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(film).toEqual(before);
  expect(paid).not.toHaveBeenCalled();
});
it("honors scalar edits versus structured dialogue using the existing production precedence", async () => {
  const { film, shot } = fixture();
  shot.line = ("新".repeat(30) + "！").repeat(3);
  const result = await prepareDialogueSplitPreview(film, shot.id, { versions: 1 });
  if (result.kind !== "READY") throw Error(result.code);
  expect(result.sourceLines).toEqual([{ speaker: "甲", text: shot.line }]);
  expect(result.parts.map((part) => part.text).join("")).toBe(shot.line);
});
it("binds semantic freshness to project/shot/selected version/input and count while ignoring save timestamps", async () => {
  const { film, shot } = fixture(),
    result = await prepareDialogueSplitPreview(film, shot.id, { versions: 2 });
  expect(
    await dialogueSplitPreviewCurrent(
      { ...film, savedAt: "later" },
      shot.id,
      { versions: 2 },
      result,
    ),
  ).toBe(true);
  for (const change of ["project", "line", "speaker", "take", "picture", "draft", "versions"]) {
    const next = structuredClone(film),
      target = next.shots[0]!;
    if (change === "project") next.id = "another";
    if (change === "line") target.line += "新句。";
    if (change === "speaker") target.lines![0]!.speaker = "乙";
    if (change === "take") target.selectedTakeId = "different";
    if (change === "picture") target.picture += "新画面";
    if (change === "draft") next.draft = !next.draft;
    expect(
      await dialogueSplitPreviewCurrent(
        next,
        shot.id,
        { versions: change === "versions" ? 4 : 2 },
        result,
      ),
    ).toBe(false);
  }
});
it("rejects missing/duplicate scope or malformed count without mutating old assets", async () => {
  const { film, shot } = fixture(),
    before = structuredClone(film);
  expect(await prepareDialogueSplitPreview(film, "missing", { versions: 1 })).toMatchObject({
    code: "INVALID_INPUT",
  });
  expect(
    await prepareDialogueSplitPreview({ ...film, shots: [shot, shot] }, shot.id, { versions: 1 }),
  ).toMatchObject({ code: "INVALID_INPUT" });
  expect(await prepareDialogueSplitPreview(film, shot.id, { versions: 99 })).toMatchObject({
    code: "INVALID_INPUT",
  });
  expect(film).toEqual(before);
});

it("rejects in-place input changes during asynchronous fingerprinting without calling a service", async () => {
  const { film, shot } = fixture();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((yes) => (release = yes)),
    started = new Promise<void>((yes) => (entered = yes));
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => {
    entered();
    await hold;
    return digest(...args);
  });
  const work = prepareDialogueSplitPreview(film, shot.id, { versions: 2 });
  try {
    await started;
    shot.line += "新句。";
    release();
    expect(await work).toMatchObject({ kind: "UNSUPPORTED", code: "INPUT_CHANGED" });
  } finally {
    release();
    await work;
  }
});
it("reports unavailable fingerprinting honestly instead of returning an unbound ready plan", async () => {
  const { film, shot } = fixture();
  vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(Error("unavailable"));
  expect(await prepareDialogueSplitPreview(film, shot.id, { versions: 1 })).toMatchObject({
    kind: "UNSUPPORTED",
    code: "FINGERPRINT_UNAVAILABLE",
  });
});
