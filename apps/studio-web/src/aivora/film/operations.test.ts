import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { blankFilm, sampleFilm } from "./project";
import {
  actionBeats,
  adaptToShortDrama,
  addShot,
  applyScenes,
  moveShot,
  clipLayout,
  continuityPrompt,
  ensureLocations,
  exportSummary,
  extractBookText,
  keyframeVariants,
  locationPlate,
  offlineScreenplay,
  parseWriterScenes,
  performanceLine,
  planVideoJobs,
  portraitPrompts,
  PREVIEW_REASON,
  removeShot,
  splitNovel,
  storyFilmBatches,
  subtitleCues,
  VOICES,
  zipTexts,
} from "./operations";

function storedZip(files: Record<string, Uint8Array>, method: 0 | 8 = 0): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const named = encoder.encode(name);
    const local = new Uint8Array(30 + named.length + stored.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, method, true);
    view.setUint32(18, stored.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, named.length, true);
    local.set(named, 30);
    local.set(stored, 30 + named.length);
    locals.push(local);
    const central = new Uint8Array(46 + named.length);
    const cd = new DataView(central.buffer);
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, method, true);
    cd.setUint32(20, stored.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, named.length, true);
    cd.setUint32(42, offset, true);
    central.set(named, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralBlob = concat(centrals);
  const eocd = new Uint8Array(22);
  const end = new DataView(eocd.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, centrals.length, true);
  end.setUint16(10, centrals.length, true);
  end.setUint32(12, centralBlob.length, true);
  end.setUint32(16, offset, true);
  return concat([...locals, centralBlob, eocd]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

describe("film operations", () => {
  it("splits chapters and keeps the title", () => {
    const book = splitNovel("雨巷\n\n第一章 夜\n巷口只有风。\n\n第二章 停\n他还没走。");
    expect(book.title).toBe("雨巷");
    expect(book.scenes).toHaveLength(2);
    expect(book.scenes[0]?.text).toContain("巷口只有风");
    expect(book.scenes[1]?.title).toContain("第二章");
  });

  it("groups a novel that has no chapter headings", () => {
    const book = splitNovel(`序\n\n${"雨。".repeat(300)}\n\n${"风。".repeat(300)}`);
    expect(book.scenes.length).toBeGreaterThan(1);
  });

  it("writes and adapts a short drama without inventing the sample cast", () => {
    const scenes = offlineScreenplay("巷口只有风。他停下。");
    const text = scenes.map((item) => item.text).join(" ");
    expect(text).not.toContain("林夏");
    expect(text).not.toContain("阿凯");
    expect(scenes[2]?.text).toContain("还没完");
    const adapted = adaptToShortDrama("第一章 夜\n只有风。\n\n第二章 停\n他回头。", 40);
    expect(adapted).toHaveLength(2);
    expect(adapted[0]?.where).toContain("秒");
  });

  it("reads a writer reply and leaves a user-written scene alone", () => {
    const parsed = parseWriterScenes(
      '说明 {"title":"巷","scenes":[{"title":"夜","place":"巷口","time":"夜","key_event":"只有风"}]}',
    );
    expect(parsed?.[0]?.text).toBe("只有风");
    expect(parsed?.[0]?.where).toContain("巷口");
    expect(parseWriterScenes("不是 json")).toBeNull();
    const film = blankFilm();
    film.scenes[0]!.text = "用户写的";
    film.scenes[0]!.userFields = ["text"];
    const next = applyScenes(film, parsed ?? []);
    expect(next.scenes.some((item) => item.text === "用户写的")).toBe(true);
    expect(next.scenes.some((item) => item.text === "只有风")).toBe(true);
  });

  it("plans portraits, empty plates, beats and four keyframes", () => {
    const portraits = portraitPrompts("林骁", "林骁，短发", "写实电影感");
    expect(portraits.map((item) => item.view)).toEqual(["正面", "侧面", "背面", "脸部"]);
    expect(portraits[0]?.prompt).toContain("定妆照");
    expect(portraits[0]?.prompt).not.toContain("起始画面");
    expect(locationPlate("窄巷", "写实。", "雨")).toContain("空镜");
    const film = ensureLocations(sampleFilm());
    expect(film.locations.length).toBeGreaterThan(0);
    expect(ensureLocations(film)).toBe(film);
    const beats = actionBeats("他出拳。两人抱摔在一起。");
    expect(beats[0]?.feasibility).toBe("稳");
    expect(beats[1]?.feasibility).toBe("难");
    expect(beats[1]?.workaround).toContain("剪辑");
    expect(performanceLine("")).toContain("眼神");
    const variants = keyframeVariants(sampleFilm().shots[0]!, sampleFilm());
    expect(new Set(variants).size).toBe(4);
    expect(variants[0]).toContain("起始画面");
  });

  it("queues takes, summarizes gaps, and lays clips out on the timeline", () => {
    const film = sampleFilm();
    const jobs = planVideoJobs(film.shots[4]!, 2, false, "还不能生成");
    expect(jobs.every((job) => job.status === "blocked")).toBe(true);
    film.jobs = planVideoJobs(film.shots[0]!, 1, true, "");
    film.jobs[0]!.status = "done";
    expect(exportSummary(film)).toContain("还有 5 个镜头没生成");
    const cues = subtitleCues(film.shots);
    expect(cues.map((item) => item.text)).toEqual([
      "东西交出来，留你一条腿。",
      "雨太大，我听不清。",
      "一起上！",
    ]);
    const clips = clipLayout(film.shots);
    expect(clips.map((item) => item.width)).toEqual([102, 76, 102, 76, 154, 206]);
    expect(clips[4]?.left).toBe(365);
    const previous = film.shots[3];
    expect(continuityPrompt(previous, film.shots[4]!, film)).toContain("接上一镜");
    expect(continuityPrompt(undefined, film.shots[0]!, film)).toContain("起始画面");
  });

  it("packs at most ten shots and names the draft model", () => {
    const film = blankFilm();
    film.title = "长片";
    film.shots = Array.from({ length: 11 }, (_, index) => ({
      ...addShot(film, "scene-1").shots[0]!,
      id: `s-${index}`,
      picture: `第${index}镜`,
    }));
    const batches = storyFilmBatches(film, film.shots, true);
    expect(batches).toHaveLength(2);
    expect(batches[0]?.shots).toHaveLength(10);
    expect(batches[0]?.video_model).toBe("grok-imagine-video-1.5-lite");
    expect(batches[0]?.shots[0]?.prompt.length).toBeLessThanOrEqual(400);
    expect(storyFilmBatches(film, film.shots, false)[0]?.video_model).toBe(
      "grok-imagine-video-1.5",
    );
  });

  it("adds, moves, and removes a shot without touching the others", () => {
    const film = addShot(addShot(blankFilm(), "scene-1"), "scene-1");
    expect(film.shots).toHaveLength(2);
    const moved = moveShot(film, film.shots[0]!.id, 1);
    expect(moved.shots[1]?.id).toBe(film.shots[0]?.id);
    expect(moved.shots[1]?.no).toBe(2);
    expect(moveShot(film, film.shots[0]!.id, -1)).toBe(film);
    expect(removeShot(film, film.shots[0]!.id).shots).toHaveLength(1);
  });

  it("reads txt, docx and epub, and refuses other files", async () => {
    const encoder = new TextEncoder();
    const plain = await extractBookText("故事.txt", encoder.encode("第一章 夜\n只有风。"));
    expect(plain.text).toContain("只有风");
    const docx = storedZip({
      "word/document.xml": encoder.encode("<w:p>巷口只有风。</w:p>"),
    });
    const fromDoc = await extractBookText("故事.docx", docx);
    expect(fromDoc.text).toContain("巷口只有风");
    const epub = storedZip({ "OEBPS/chap.xhtml": encoder.encode("<p>他还没走。</p>") }, 8);
    const fromBook = await extractBookText("故事.epub", epub);
    expect(fromBook.text).toContain("他还没走");
    const files = await zipTexts(epub);
    expect(files.get("OEBPS/chap.xhtml")).toContain("他还没走");
    const refused = await extractBookText("故事.pdf", encoder.encode("x"));
    expect(refused.text).toBe("");
    const broken = await extractBookText("故事.docx", encoder.encode("not a zip"));
    expect(broken.note).toContain("txt");
  });

  it("describes every voice in plain words", () => {
    expect(VOICES.every((voice) => voice.description.includes("·"))).toBe(true);
    expect(PREVIEW_REASON).toContain("不播放");
  });
});
