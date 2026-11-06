import { File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import {
  applyBookImportSource,
  bookImportInputUnchanged,
  captureBookImportInput,
  prepareBookImport,
  type BookImportFile,
} from "./book-import";

const file = (text: string, name = "小说.txt") =>
  new NodeFile([text], name) as unknown as BookImportFile;

it("reads the real novel into a complete proposal and source transaction without applying scenes", async () => {
  const source = readFileSync(
    resolve(__dirname, "../../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
    "utf8",
  );
  const film = sampleFilm();
  const before = structuredClone(film);
  const input = captureBookImportInput(film);
  const proposal = await prepareBookImport(file(source));
  expect(proposal.kind).toBe("proposal");
  if (proposal.kind !== "proposal") throw new Error("missing proposal");
  expect(proposal.scenes.map((scene) => scene.title)).toEqual([
    "雨夜旧书店",
    "码头仓库",
    "医院走廊",
  ]);
  for (const paragraph of source
    .split(/\n+/)
    .map((text) => text.trim())
    .filter(Boolean))
    expect(proposal.scenes.map((scene) => scene.text).join("\n")).toContain(paragraph);
  const applied = applyBookImportSource(input, proposal, film);
  expect(applied.kind).toBe("applied");
  if (applied.kind !== "applied") throw new Error("stale");
  expect(applied.film!.sourceText).toBe(source);
  expect(applied.film!.scenes).toBe(film.scenes);
  expect(film).toEqual(before);
});

it("carries more than 200000 characters and 40 scenes through file extraction, proposal and source application", async () => {
  const paragraphs = Array.from(
    { length: 41 },
    (_, index) =>
      `第${index + 1}场 场地${index + 1}\n${`这是第${index + 1}场的完整正文。`.repeat(450)}\n角色说：“第${index + 1}场最后一句不能丢。”`,
  );
  const source = paragraphs.join("\n\n");
  expect(source.length).toBeGreaterThan(200000);
  const film = sampleFilm();
  const proposal = await prepareBookImport(file(source));
  if (proposal.kind !== "proposal") throw new Error("missing proposal");
  expect(proposal.scenes).toHaveLength(41);
  expect(proposal.scenes.at(-1)!.text).toContain("第41场最后一句不能丢。");
  const applied = applyBookImportSource(captureBookImportInput(film), proposal, film);
  if (applied.kind !== "applied") throw new Error("stale");
  expect(applied.film!.sourceText).toBe(source);
  expect(
    proposal.scenes
      .map((scene) => scene.text)
      .join("\n")
      .replace(/\n+/g, "\n"),
  ).toBe(source.replace(/\n+/g, "\n"));
});

it("refuses same-project late source writes after source, scene or risk changes, while preserving unrelated live state", async () => {
  const film = sampleFilm();
  const input = captureBookImportInput(film);
  const proposal = await prepareBookImport(file("第一场 窗前\n新小说全文。"));
  if (proposal.kind !== "proposal") throw new Error("missing proposal");
  for (const update of [
    { ...film, sourceText: "手改原文" },
    {
      ...film,
      scenes: film.scenes.map((scene, i) => (i ? scene : { ...scene, text: "手改正文" })),
    },
    {
      ...film,
      scenes: film.scenes.map((scene, i) =>
        i
          ? scene
          : {
              ...scene,
              paragraphCoverage: {
                ok: false,
                missingParagraphs: ["P101"],
                duplicateParagraphs: [],
                invalidParagraphs: [],
                crossSceneRisk: false,
              },
            },
      ),
    },
    { ...film, id: "another-project" },
    null,
  ])
    expect(applyBookImportSource(input, proposal, update)).toEqual({ kind: "stale" });
  const live = { ...film, styleZh: "新画风", title: "新标题" };
  const applied = applyBookImportSource(input, proposal, live);
  if (applied.kind !== "applied") throw new Error("stale");
  expect(applied.film).toMatchObject({
    styleZh: "新画风",
    title: "新标题",
    sourceText: proposal.sourceText,
  });
  film.scenes[0]!.text = "原地手改也拒绝";
  expect(bookImportInputUnchanged(input, film)).toBe(false);
});

it("returns explicit empty/unsupported notices and propagates read failures", async () => {
  expect(await prepareBookImport(file("", "空白.txt"))).toMatchObject({ kind: "notice" });
  expect(await prepareBookImport(file("pdf", "书.pdf"))).toMatchObject({
    kind: "notice",
    notice: expect.stringContaining("只读取"),
  });
  const error = new Error("read failed");
  await expect(
    prepareBookImport({ name: "失败.txt", arrayBuffer: vi.fn().mockRejectedValue(error) }),
  ).rejects.toBe(error);
});

it("does not mutate proposal ownership risks when source-only application succeeds", async () => {
  const film = sampleFilm();
  const proposal = await prepareBookImport(file("第一场 甲\n第一段。"));
  if (proposal.kind !== "proposal") throw new Error("missing proposal");
  proposal.scenes[0]!.paragraphCoverage = {
    ok: false,
    missingParagraphs: ["P101"],
    duplicateParagraphs: ["P102"],
    invalidParagraphs: ["P999"],
    crossSceneRisk: true,
  };
  const expected = structuredClone(proposal);
  expect(applyBookImportSource(captureBookImportInput(film), proposal, film).kind).toBe("applied");
  expect(proposal).toEqual(expected);
});
