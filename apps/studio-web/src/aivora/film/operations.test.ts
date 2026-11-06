import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankFilm, sampleFilm } from "./project";
import { agentRequestBatches, TEXT_REQUEST_LIMIT } from "./request-batches";
import {
  actionBeats,
  adaptToShortDrama,
  addShot,
  applyScenes,
  moveShot,
  clipLayout,
  continuityPrompt,
  ensureLocations,
  extractCastOffline,
  exportSummary,
  mergeCast,
  parseCastReply,
  extractBookText,
  keyframeVariants,
  locationPlate,
  offlineScreenplay,
  beatsForShot,
  isFightScene,
  keepFightDetails,
  numberedScript,
  parseWriterScenes,
  sceneNeedsSource,
  sliceNovel,
  performanceLine,
  planVideoJobs,
  filmFileName,
  portraitPrompts,
  PREVIEW_REASON,
  removeShot,
  splitNovel,
  chosenExport,
  confirmEstimate,
  dialogueTracks,
  draftFaceWarning,
  fitShotToLine,
  previewMix,
  motionPrompt,
  shotVoiceId,
  spokenLine,
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
  it("keeps all 41 short chapters through import and scene application", async () => {
    const source = Array.from(
      { length: 41 },
      (_, index) => `第${index + 1}章 夜雨\n林晚说：“第${index + 1}句不能丢。”`,
    ).join("\n\n");
    expect(source.length).toBeLessThan(7500);
    const extracted = await extractBookText("41-chapters.txt", new TextEncoder().encode(source));
    const split = splitNovel(extracted.text);
    expect(split.scenes).toHaveLength(41);
    expect(split.note).not.toMatch(/只收|只读/);
    const film = applyScenes(blankFilm(), split.scenes);
    expect(film.scenes).toHaveLength(41);
    for (let index = 1; index <= 41; index += 1)
      expect(film.scenes[index - 1]?.text).toContain(`第${index}句不能丢。`);
  });

  it("keeps the final dialogue and tail beyond 200000 characters through director batching", async () => {
    const ending = "林晚说：“最后一句也不能丢。”\n警笛远去，所有人终于走出书店。";
    const body = `${"雨".repeat(200001)}\n${ending}`;
    const source = `第一章 长夜\n${body}`;
    const extracted = await extractBookText("long-source.txt", new TextEncoder().encode(source));
    expect(extracted.text).toBe(source);
    const split = splitNovel(extracted.text);
    expect(split.scenes).toHaveLength(1);
    expect(split.scenes[0]?.text).toBe(body);
    expect(split.note).not.toMatch(/只收|只读/);
    const film = applyScenes(blankFilm(), split.scenes);
    const script = numberedScript(film.scenes[0]!.text);
    const batches = agentRequestBatches(
      "director",
      `场次 id：scene-1\n剧本：\n${script}`,
      "逐句拆镜",
    );
    expect(batches.every((batch) => batch.text.length <= TEXT_REQUEST_LIMIT)).toBe(true);
    expect(batches.map((batch) => batch.source).join("")).toBe(script);
    expect(batches.at(-1)?.source).toContain(ending.split("\n").at(-1));
  });

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
    expect(parseWriterScenes("{nope}")).toBeNull();
    const film = blankFilm();
    film.scenes[0]!.text = "用户写的";
    film.scenes[0]!.userFields = ["text"];
    const next = applyScenes(film, parsed ?? []);
    expect(next.scenes.some((item) => item.text === "用户写的")).toBe(true);
    expect(next.scenes.some((item) => item.text === "只有风")).toBe(true);
    const novel = [
      "雨夜旧书店。林晚说：「今晚打烊了。」沈砚说：「我留下。」",
      "码头仓库。周烈挥起钢条。林晚说：「刀放下。」周烈的前臂被划开。",
      "医院走廊。林晚哭着说：「你还活着。」",
    ].join("\n");
    const split = parseWriterScenes(
      JSON.stringify({
        scenes: [
          {
            title: "雨夜旧书店",
            place: "雨夜旧书店",
            key_event: "沈砚许诺留下书店",
            beats: ["打烊"],
          },
          { title: "码头仓库", place: "码头仓库", key_event: "仓库里打了起来", beats: ["钢条"] },
          { title: "医院走廊", place: "医院走廊", key_event: "林晚在走廊哭", beats: ["哭"] },
        ],
      }),
      novel,
    );
    expect(split).toHaveLength(3);
    expect(split?.[0]?.text).toContain("今晚打烊了");
    expect(split?.[0]?.text).toContain("我留下");
    expect(split?.[0]?.where).toContain("雨夜旧书店");
    expect(split?.[1]?.text).toContain("刀放下");
    expect(split?.[1]?.text).toContain("钢条");
    expect(split?.[2]?.text).toContain("你还活着");
    expect(split?.[0]?.text).not.toBe("沈砚许诺留下书店");
    const pasted = blankFilm();
    pasted.scenes[0]!.text = novel;
    pasted.scenes[0]!.userFields = ["text"];
    const placed = applyScenes(pasted, split ?? []);
    expect(placed.scenes).toHaveLength(3);
    expect(placed.scenes.some((item) => item.text === novel)).toBe(false);
    expect(sceneNeedsSource("沈砚许诺留下书店")).toBe(true);
    expect(sceneNeedsSource(split?.[2]?.text ?? "")).toBe(false);
    expect(keepFightDetails(novel, "沈砚左手按在周烈前臂上")).toBe("沈砚左手按在周烈前臂上");
    const book = [
      "第一场　雨夜旧书店",
      "入秋后的雨打在青石巷。门铃响了。“打烊了。”林晚说。男人说：“我叫沈砚。”",
      "第二场　码头仓库",
      "三个男人撞开书店的门。周烈挥起铁棍。林晚尖叫：“小心！”刀划过小臂。",
      "第三场　医院走廊",
      "凌晨的走廊里，林晚说：“你本来可以不管的。”天亮的时候，阿婆说：“灯还亮着，就好。”",
    ].join("\n");
    const five = parseWriterScenes(
      JSON.stringify({
        scenes: [
          {
            title: "雨夜旧书店",
            place: "老城区青石巷·晚照书店",
            key_event: "沈砚还钱",
            text: "打烊了",
          },
          {
            title: "书店被闯",
            place: "晚照书店",
            key_event: "周烈上门",
            text: "三个男人撞开书店的门",
          },
          {
            title: "码头仓库",
            place: "城东废弃码头仓库",
            key_event: "仓库打斗",
            text: "林晚尖叫：“小心！”",
          },
          {
            title: "医院走廊",
            place: "市医院急诊室走廊",
            key_event: "林晚哭",
            text: "你本来可以不管的",
          },
          { title: "天亮青石巷", place: "青石巷门口", key_event: "灯还亮着", text: "天亮的时候" },
        ],
      }),
      book,
    );
    expect(five).toHaveLength(3);
    expect(five?.[0]?.text).toContain("我叫沈砚");
    expect(five?.[0]?.text).not.toContain("小心");
    expect(five?.some((item) => item.text.includes("小心"))).toBe(true);
    expect(five?.some((item) => item.text.includes("你本来可以不管的"))).toBe(true);
    expect(five?.some((item) => item.text.length > book.length * 0.75)).toBe(false);
    const joined = five?.map((item) => item.text).join("\n") ?? "";
    expect(joined).toContain("我叫沈砚");
    expect(joined).toContain("小心");
    expect(joined).toContain("灯还亮着");
    expect(isFightScene("打烊了。林晚说今晚不卖了。")).toBe(false);
    expect(five?.some((item) => isFightScene(item.text))).toBe(true);
    expect(
      beatsForShot(
        [
          { text: "镜头1·攻：挥铁棍", shotId: "one" },
          { text: "镜头2·防：侧身", shotId: "two" },
        ],
        2,
        "two",
      ),
    ).toBe("镜头2·防：侧身");
    expect(beatsForShot([{ text: "镜头1·攻：挥铁棍" }, { text: "镜头1·防：侧身" }], 18)).toBe("");
    const adults = mergeCast(blankFilm(), {
      characters: [
        { name: "林晚", identity: "二十六岁，女店主" },
        { name: "沈砚", identity: "三十岁男人" },
        { name: "林国栋", identity: "林晚之父，已去世" },
        { name: "周烈", identity: "讨债领头人，寸头，戴粗金链" },
        { name: "打手", identity: "跟在周烈身后的打手" },
        { name: "阿婆", identity: "巷口卖早点的老人" },
      ],
      locations: [],
    });
    const voiceOf = (name: string) => adults.characters.find((item) => item.name === name)?.voiceId;
    expect(["iris", "sirius", "cosmo", "helix"]).toContain(voiceOf("林晚"));
    expect(["helios", "castor", "kepler", "zenith"]).toContain(voiceOf("沈砚"));
    expect(["leo", "rex", "atlas", "perseus", "zagan", "sal", "lux", "orion"]).toContain(
      voiceOf("林国栋"),
    );
    expect(voiceOf("周烈")).toBe("");
    expect(voiceOf("打手")).toBe("");
    expect(["naksh", "ursa"]).toContain(voiceOf("阿婆"));
    expect(voiceOf("林晚")).not.toBe("aurora");
    expect(voiceOf("沈砚")).not.toBe("liora");
  });

  it("plans portraits, empty plates, beats and four keyframes", () => {
    const portraits = portraitPrompts("林骁", "林骁，短发", "写实电影感");
    expect(portraits.map((item) => item.view)).toEqual(["正面", "侧面", "背面", "脸部"]);
    expect(portraits[0]?.prompt).toContain("定妆照");
    expect(portraits[0]?.prompt).toContain("性别");
    expect(filmFileName("雨夜重逢", "第 1 集")).toBe("雨夜重逢-第1集.mp4");
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
    film.jobs[0]!.status = "queued";
    film.shots[0]!.takes = [
      {
        id: "take-1",
        shotId: film.shots[0]!.id,
        index: 1,
        status: "done",
        stillUrl: "",
        videoPath: "/tmp/a.mp4",
        videoUrl: "",
        prompt: "",
        createdAt: "",
        reason: "",
      },
    ];
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
    const previous = film.shots[3]!;
    expect(continuityPrompt(previous, film.shots[4]!, film)).not.toContain("接上一镜");
    expect(
      continuityPrompt(
        previous,
        { ...film.shots[4]!, sceneId: previous.sceneId, continuityFromShotId: previous.id },
        film,
      ),
    ).toContain("接上一镜");
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
    film.shots[0]!.styleNote = "冷色雨夜";
    const request = storyFilmBatches(film, [film.shots[0]!], false)[0]!;
    expect(request.shots[0]!.prompt).toContain("冷色雨夜");
    expect(request.shots[0]!.prompt).toContain(film.styleZh);
    expect(request).not.toHaveProperty("style_block");
  });

  it("reads names and a rainy alley from the script, and keeps names the user already wrote", () => {
    const found = extractCastOffline(
      "01夜里下雨，林雨站在巷口等人。阿哲撑着伞跑过来，两人对视，林雨笑了。",
    );
    expect(found.characters.map((item) => item.name)).toEqual(["林雨", "阿哲"]);
    expect(found.locations.map((item) => item.name)).toEqual(["雨夜巷口"]);
    expect(parseCastReply("不是")).toBeNull();
    expect(parseCastReply("{nope}")).toBeNull();
    expect(parseCastReply('{"characters":[],"locations":[]}')).toBeNull();
    const parsed = parseCastReply(
      '好 {"characters":[{"name":"林雨","identity":"短发"}],"locations":[{"name":"巷口","prompt":"夜"}]}',
    );
    expect(parsed?.characters[0]?.identity).toBe("短发");
    const film = blankFilm();
    film.characters = [
      {
        id: "cast-1",
        name: "林雨",
        identity: "我写的",
        voiceId: "",
        source: "user",
        userFields: ["identity"],
        portraits: [],
      },
    ];
    const merged = mergeCast(film, found);
    expect(merged.characters.find((item) => item.name === "林雨")?.identity).toBe("我写的");
    expect(merged.characters.map((item) => item.name)).toEqual(["林雨", "阿哲"]);
    expect(
      merged.characters.every(
        (person) => person.voiceId === "" && person.voiceCode === "VOICE_TRAITS_REQUIRED",
      ),
    ).toBe(true);
    const voiced = mergeCast(blankFilm(), {
      characters: [
        { name: "林雨", identity: "年轻女子" },
        { name: "阿哲", identity: "中年男人" },
        { name: "小满", identity: "七岁女孩" },
      ],
      locations: [],
    });
    const ids = voiced.characters.map((item) => item.voiceId);
    expect(new Set(ids).size).toBe(3);
    expect(["iris", "sirius", "cosmo", "helix"]).toContain(ids[0]);
    expect(["leo", "rex", "orion", "atlas", "perseus", "zagan", "sal", "lux"]).toContain(ids[1]);
    expect(["iris", "sirius", "cosmo", "lumen"]).toContain(ids[2]);
    expect(merged.scenes[0]?.where).toBe("雨夜巷口");
    expect(mergeCast(merged, found)).toBe(merged);
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
      "word/document.xml": encoder.encode("<w:p>巷口只有风&#12290;</w:p>"),
    });
    const fromDoc = await extractBookText("故事.docx", docx);
    expect(fromDoc.text).toContain("巷口只有风。");
    const corrupt = storedZip({ "word/document.xml": encoder.encode("<w:p>坏掉的压缩</w:p>") }, 8);
    const nameLength = "word/document.xml".length;
    corrupt.fill(0xff, 30 + nameLength, 30 + nameLength + 6);
    const unreadable = await extractBookText("坏.docx", corrupt);
    expect(unreadable.text).toBe("");
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

  it("speaks the line in that character's voice and exports the chosen takes", () => {
    const film = sampleFilm();
    const shot = film.shots[0]!;
    shot.picture = "雨夜里的巷口，一个人站住。";
    shot.line = "雨太大。我听不清。";
    shot.promptZh = "冷色，湿地面反光。";
    shot.characters = [film.characters[0]!.name];
    film.characters[0]!.voiceId = "rex";
    film.narrationVoiceId = "eve";
    expect(spokenLine(shot)).toBe("雨太大。我听不清。");
    expect(motionPrompt(shot)).toContain("冷色，湿地面反光");
    expect(motionPrompt(shot)).not.toContain("雨太大");
    expect(shotVoiceId(shot, film)).toBe("rex");
    shot.characters = [film.characters[0]!.name, film.characters[1]!.name];
    shot.speaker = film.characters[1]!.name;
    film.narrationVoiceId = "eve";
    expect(shotVoiceId(shot, film)).toBe(film.characters[1]!.voiceId);
    const silent = { ...shot, line: "", characters: [], speaker: "" };
    expect(spokenLine(silent)).toBe("");
    expect(shotVoiceId(silent, film)).toBe("eve");
    shot.speaker = "";
    shot.characters = [film.characters[0]!.name, film.characters[1]!.name];
    expect(shotVoiceId(shot, film)).not.toBe("eve");
    const unnamed = {
      ...film,
      narrationVoiceId: "",
      characters: film.characters.map((person) => ({ ...person, voiceId: "" })),
    };
    expect(
      shotVoiceId(
        {
          ...shot,
          speaker: "",
          line: "",
          characters: unnamed.characters.map((person) => person.name),
        },
        unnamed,
      ),
    ).toBe("");
    expect(
      motionPrompt({ ...shot, picture: "", promptZh: "", performance: "", userFields: [] }),
    ).toBe("起始画面");
    shot.performance = "皱眉，呼吸停一下";
    expect(motionPrompt(shot)).toContain("皱眉");
    const fitted = fitShotToLine({ ...shot, seconds: 2, line: "雨太大，我听不清，你再说一遍。" });
    expect(fitted.shot.seconds).toBeGreaterThan(2);
    const over = fitShotToLine({
      ...shot,
      seconds: 3,
      userFields: [],
      line: "啊".repeat(90),
    });
    expect(over.warning).toBe(
      `镜头 ${shot.no} 的台词超过 15 秒，一个视频放不下，这一镜不会生成。把台词分到两个镜头里。`,
    );
    expect(over.warning).not.toContain("截断");
    expect(over.shot.seconds).toBe(3);
    const kept = fitShotToLine({
      ...shot,
      seconds: 4,
      userFields: ["seconds"],
      line: "啊".repeat(40),
    });
    expect(kept.shot.seconds).toBe(4);
    expect(kept.warning).toContain("生成时会跟着配音加长。");
    expect(kept.warning).not.toContain("截断");
    // With the scene number it names the shot the way copy-zh.md does.
    expect(
      fitShotToLine(
        { ...shot, no: 3, seconds: 4, userFields: ["seconds"], line: "啊".repeat(40) },
        2,
      ).warning,
    ).toMatch(/^第 2 场第 3 个镜头定的是 4 秒，台词要说 \d+ 秒左右，生成时会跟着配音加长。$/);
    // A locked line too long for any video says so, instead of promising to lengthen it.
    expect(
      fitShotToLine({ ...shot, seconds: 4, userFields: ["seconds"], line: "啊".repeat(90) })
        .warning,
    ).toContain("这一镜不会生成");
    shot.speaker = film.characters[0]!.name;
    shot.poster = "/tmp/still.png";
    film.characters[0]!.portraits = [
      { view: "正面", prompt: "定妆", url: "https://cdn.example/face.png" },
    ];
    const batch = storyFilmBatches(film, [shot], false)[0]!;
    expect(batch.shots[0]?.still).toBe("/tmp/still.png");
    expect(batch.shots[0]?.references).toContain("https://cdn.example/face.png");
    expect(batch.shots[0]?.references).not.toContain("/tmp/still.png");
    expect(batch.shots[0]?.prompt).toContain("<IMAGE_0>");
    expect(batch.shots[0]?.prompt).toContain("<IMAGE_1>");
    expect(batch.shots[0]?.prompt).toContain("定妆照");
    expect(batch.aspect_ratio).toBe("16:9");
    expect(storyFilmBatches({ ...film, aspectRatio: "9:16" }, [shot], false)[0]?.aspect_ratio).toBe(
      "9:16",
    );
    expect(draftFaceWarning(true)).toContain("不参考定妆照");
    expect(draftFaceWarning(true)).toContain("可能和定妆照不一样");
    expect(draftFaceWarning(false)).toBe("");
    shot.poster = "";
    shot.stills = [];
    film.characters[0]!.portraits = [{ view: "正面", prompt: "定妆", url: "/tmp/face.png" }];
    const local = storyFilmBatches(film, [shot], false)[0]!;
    expect(local.shots[0]?.still).toBeUndefined();
    expect(local.shots[0]?.references).toContain("/tmp/face.png");
    expect(local.shots[0]?.prompt).toContain("<IMAGE_0>");
    expect(batch.shots[0]?.narration).toBe("雨太大。我听不清。");
    expect(batch.shots[0]?.prompt).toContain("冷色");
    expect(batch.shots[0]?.prompt).not.toBe(batch.shots[0]?.narration);
    expect(batch.shots[0]?.voice_id).toBe("rex");
    expect(batch.shots[0]?.subtitle).toBe("雨太大。我听不清。");
    shot.takes = [
      {
        id: "take-old",
        shotId: shot.id,
        index: 1,
        status: "done",
        reason: "",
        videoPath: "/films/old.mp4",
        videoUrl: "",
        stillUrl: "",
        prompt: "",
        createdAt: "",
      },
      {
        id: "take-new",
        shotId: shot.id,
        index: 2,
        status: "done",
        reason: "",
        videoPath: "/films/new.mp4",
        videoUrl: "",
        stillUrl: "",
        prompt: "",
        createdAt: "",
      },
    ];
    shot.selectedTakeId = "take-new";
    film.shots[1]!.takes = [];
    film.audioClips = [
      {
        id: "voice-1",
        lane: "dialogue",
        shotId: shot.id,
        takeId: "",
        label: "配音",
        startSeconds: 0,
        durationSeconds: 2,
        offsetSeconds: 0,
        gainDb: 0,
        path: "/films/line.wav",
      },
    ];
    expect(dialogueTracks(film)).toEqual(["/films/line.wav"]);
    film.audioClips[0]!.gainDb = -80;
    expect(dialogueTracks(film)).toEqual(["mute"]);
    expect(
      previewMix({
        joined: true,
        voice: "/films/line.wav",
        music: "/films/bed.mp3",
        dialogueMuted: false,
        solo: "",
        musicHeard: true,
      }),
    ).toEqual({ voice: "", music: "", hearVideo: true });
    expect(
      previewMix({
        joined: false,
        voice: "/films/line.wav",
        music: "/films/bed.mp3",
        dialogueMuted: false,
        solo: "",
        musicHeard: true,
      }).hearVideo,
    ).toBe(false);
    const plan = chosenExport(film);
    expect(plan.paths).toEqual(["/films/new.mp4"]);
    expect(plan.missing.join(" ")).toContain("镜头");
    const eight = Array.from({ length: 8 }, () => ({ seconds: 3 }));
    expect(confirmEstimate(eight, 1)).toBe("将生成 8 个视频 · 约 24 秒 · 记在 Grok 会员额度里");
  });

  it("rebuilds scenes from the numbered paragraphs and keeps each line", () => {
    const source = ["[P01] 门铃响了。林晚说：“打烊了。”", "[P02] 男人说：“我叫沈砚。”"].join("\n");
    expect(numberedScript("门铃响了。")).toContain("[P01]");
    const parsed = parseWriterScenes(
      JSON.stringify({
        scenes: [
          {
            title: "雨夜旧书店",
            heading: { place: "晚照书店", time: "夜" },
            source_paragraphs: ["P01"],
            elements: [{ type: "dialogue", speaker: "林晚", line: "打烊了" }],
            key_event: "打烊",
          },
          {
            title: "书店被闯",
            place: "晚照书店",
            source_paragraphs: ["P02"],
            text: source,
          },
        ],
      }),
      source,
    );
    expect(parsed?.[0]?.text).toContain("打烊了");
    expect(parsed?.[0]?.text).not.toContain("我叫沈砚");
    expect(parsed?.[0]?.where).toContain("晚照书店");
    expect(parsed?.[1]?.text).toContain("我叫沈砚");
    expect(parsed?.[1]?.text).not.toContain("打烊了");
    const cast = parseCastReply(
      '{"characters":[{"name":"林晚","identity_lock":"低马尾","gender":"女","age_band":"成年"},{"name":"阿婆","identity":"卖早点","gender":"女","age_band":"老年"}]}',
    );
    const voiced = mergeCast(blankFilm(), cast ?? { characters: [], locations: [] });
    expect(voiced.characters.find((item) => item.name === "林晚")?.gender).toBe("女");
    expect(voiced.characters.find((item) => item.name === "林晚")?.ageBand).toBe("");
    expect(voiced.characters.find((item) => item.name === "林晚")?.voiceDefault).toMatchObject({
      basis: "adult-default",
      evidenceSource: "character-reply",
    });
    expect(["ara", "eve", "luna", "carina", "celeste"]).toContain(
      voiced.characters.find((item) => item.name === "林晚")?.voiceId,
    );
    expect(["naksh", "ursa"]).toContain(
      voiced.characters.find((item) => item.name === "阿婆")?.voiceId,
    );
  });

  it("keeps the test novel's scenes, headings, and fight tag apart", () => {
    const novel = readFileSync(
      resolve(__dirname, "../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
      "utf8",
    );
    const slices = sliceNovel(novel, ["雨夜旧书店", "码头仓库", "医院走廊"]);
    expect(slices[0]).toContain("本店月底停业");
    expect(slices[0]).not.toMatch(/第二场\s*$/);
    expect(slices[0]).not.toContain("小心");
    expect(slices[1]).toContain("第二场");
    expect(slices[1]).toContain("小心");
    expect(slices[1]).not.toMatch(/第三场\s*$/);
    expect(slices[2]).toContain("第三场");
    expect(slices[2]).toContain("你本来可以不管的");
    expect(isFightScene(slices[0] ?? "")).toBe(false);
    expect(isFightScene("“打烊了。”林晚头也没抬。")).toBe(false);
    expect(isFightScene(slices[1] ?? "")).toBe(true);
    expect(isFightScene(slices[1] ?? "", "打斗")).toBe(true);
    expect(isFightScene("下雨。", "打斗")).toBe(true);
    const parsed = parseWriterScenes(
      JSON.stringify({
        scenes: [
          {
            id: "scene-2",
            no: 2,
            title: "码头仓库",
            place: "码头仓库",
            time: "夜",
            text: "小心",
            tags: ["打斗", "换地点"],
            source_paragraphs: [
              "P16",
              "P17",
              "P18",
              "P19",
              "P20",
              "P21",
              "P22",
              "P23",
              "P24",
              "P25",
              "P26",
              "P27",
              "P28",
              "P29",
              "P30",
              "P31",
            ],
          },
        ],
      }),
      novel,
    );
    // Preserve all source, but explicitly flag ownership and cross-scene repair risks.
    expect(parsed?.[0]?.paragraphCoverage).toMatchObject({ ok: false, crossSceneRisk: true });
    expect(parsed?.[0]?.text).toContain("灯还亮着，就好。");
    expect(parsed?.[0]?.paragraphCoverage?.missingParagraphs).toContain("P01");
  });

  it("describes every voice in plain words", () => {
    expect(VOICES.every((voice) => !/[A-Za-z]/.test(`${voice.name}${voice.description}`))).toBe(
      true,
    );
    expect(PREVIEW_REASON).toContain("不播放");
  });
});
