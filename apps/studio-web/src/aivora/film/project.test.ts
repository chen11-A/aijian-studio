import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { offlineRotation } from "../shot-plan";
import {
  applyShots,
  interruptStaleWork,
  assistantPrompt,
  agentRequest,
  blankFilm,
  generationNote,
  castTraitsLine,
  keyframePrompt,
  newEpisode,
  newFilmId,
  offlineShots,
  parseDirectorShots,
  shotBudget,
  readFilm,
  sampleFilm,
  textModel,
  videoPrompt,
  writeFilm,
} from "./project";
import { IMAGE_MODEL, VIDEO_MODEL } from "../pro/capabilities";

describe("film project", () => {
  it("gives each shot its own keyframe and the character's looks", () => {
    const film = sampleFilm();
    const first = film.shots[0]!;
    const second = film.shots[1]!;
    const a = keyframePrompt(first, film);
    const b = keyframePrompt(second, film);
    expect(a).not.toBe(b);
    expect(a).toContain("起始画面");
    expect(a).toContain("林骁");
    expect(b).toContain(second.picture.slice(0, 8));
    film.characters[0]!.name = "阿宁";
    film.characters[0]!.identity = "阿宁，短发，灰外套";
    film.shots[1]!.characters = ["阿宁"];
    expect(keyframePrompt(film.shots[1]!, film)).toContain("阿宁，短发");
  });

  it("keeps a line the user edited", () => {
    const film = blankFilm();
    film.shots = [
      {
        ...offlineShots("只有风。", "scene-1")[0]!,
        source: "user",
        userFields: ["picture"],
        picture: "用户写的雨",
      },
    ];
    const incoming = offlineShots("只有风。", "scene-1");
    incoming[0]!.picture = "模型想改";
    const next = applyShots(film, incoming, "scene-1");
    expect(next.shots.some((shot) => shot.picture === "用户写的雨")).toBe(true);
    expect(next.shots.some((shot) => shot.picture === "模型想改")).toBe(false);
  });

  it("does not invent the sample cast when the story never names them", () => {
    const shots = offlineShots("雨夜巷战\n巷口只有风。", "scene-1");
    const text = shots.map((shot) => shot.picture).join(" ");
    expect(text).not.toContain("林夏");
    expect(text).not.toContain("阿凯");
    expect(offlineRotation("雨夜巷战")).toHaveLength(1);
    expect(
      offlineRotation("林雨站在巷口。阿哲撑着伞跑过来。").map((shot) => shot.narration),
    ).toEqual(["林雨站在巷口", "阿哲撑着伞跑过来"]);
  });

  it("puts the project in front of the assistant and the director", () => {
    const film = sampleFilm();
    const prompt = assistantPrompt("这一场怎么写", film);
    expect(prompt).toContain("雨夜巷战");
    expect(prompt).toContain("这一场怎么写");
    expect(prompt).toContain("不要改作品");
    expect(agentRequest("director", "画风", "拆开")).toContain("你是 AIVORA 的导演");
    const directorRules = agentRequest("director", "画风", "拆开");
    for (const rule of [
      "打斗动作优先 1–2 秒",
      "悬疑 3–5 秒",
      "情感 3–4 秒",
      "每连续 3–4 个镜头",
      "台词说完和原文动作完整优先",
      "不能无损合并就保留全部镜头",
    ])
      expect(directorRules).toContain(rule);
    expect(agentRequest("director", "画风", "拆开")).toContain(
      "大约每 40 到 60 个字一个镜头，一场以 16 个为合并节拍的目标",
    );
    expect(assistantPrompt("   ", null)).toContain("短剧助手");
    const novel = "雨夜旧书店。林晚说：“我叫沈砚。”".padEnd(2075, "雨");
    const request = agentRequest("director", novel, "把这一场拆成镜头");
    expect(request).toContain(novel);
    expect(request.length).toBeGreaterThan(2075);
    expect(assistantPrompt("很".repeat(8000), film)).toContain("很".repeat(8000));
    expect(agentRequest("director", "场次原文", "拆镜")).toContain(
      "每句台词和每场末段必须完整覆盖",
    );
  });

  it("reads a saved film and ignores a broken record", () => {
    expect(newFilmId()).toMatch(/^film_[0-9a-f]{16}$/);
    expect(readFilm(window.localStorage)).toBeNull();
    window.localStorage.setItem("aivora.film.active", "{");
    expect(readFilm(window.localStorage)).toBeNull();
    window.localStorage.setItem("aivora.film.active", JSON.stringify({ title: "" }));
    expect(readFilm(window.localStorage)).toBeNull();
    const film = sampleFilm();
    film.shots[0]!.poster = "/pro/key.jpg";
    film.shots[0]!.line = "对白";
    writeFilm(window.localStorage, film);
    const restored = readFilm(window.localStorage);
    expect(restored?.title).toBe("雨夜巷战");
    expect(restored?.shots[0]?.poster).toBe("");
    expect(restored?.shots[0]?.takes).toEqual([]);
    expect(videoPrompt(film.shots[0]!)).toContain("视频不要自己出声");
    expect(parseDirectorShots("没有括号", "02")).toBeNull();
    expect(parseDirectorShots("{", "02")).toBeNull();
    expect(parseDirectorShots('{"shots":"no"}', "02")).toBeNull();
    expect(parseDirectorShots('{"shots":[{}]}', "02")).toBeNull();
    expect(parseDirectorShots("{nope}", "02")).toBeNull();
    const told = parseDirectorShots(
      '{"shots":[{"narration":"她站住","action":"抬一下手","size":"近景"}]}',
      "02",
    );
    expect(told?.[0]?.picture).toBe("她站住");
    expect(told?.[0]?.action).toBe("抬一下手");
    const prefixed = sampleFilm();
    prefixed.shots[0]!.picture = "这一镜的起始画面，雨停了";
    // R2-B06 / R2-B05: the cast list's gender and age, and only the shot's people.
    const person = prefixed.characters[0]!;
    expect(keyframePrompt(prefixed.shots[0]!, prefixed)).toBe(
      `这一镜的起始画面，雨停了。${castTraitsLine(person)}${person.identity}。画面里只有${person.name}，不要多画别的人。\n【画风说明】\n${prefixed.styleZh}\n【画风说明结束】`,
    );
    const inserted = parseDirectorShots(
      '{"shots":[{"action":"手按在刀上","size":"插入","line":"另写一句"}]}',
      "02",
      "剧本里没有这句",
    );
    expect(inserted?.[0]?.size).toBe("特写");
    expect(inserted?.[0]?.tag).toBe("插入");
    expect(inserted?.[0]?.line).toBe("");
    prefixed.characters[0]!.portraits = [
      { view: "正面", prompt: "定妆", url: "data:image/png;base64,aa" },
    ];
    prefixed.aspectRatio = "9:16";
    const episode = newEpisode(prefixed);
    expect(episode.aspectRatio).toBe("9:16");
    prefixed.aspectRatio = "16:9";
    expect(newEpisode(prefixed).aspectRatio).toBe("16:9");
    expect(episode.characters[0]?.portraits[0]?.url).toBe("data:image/png;base64,aa");
    expect(episode.characters[0]?.portraits[0]).not.toBe(prefixed.characters[0]?.portraits[0]);
    const parsed = parseDirectorShots(
      '说明 {"shots":[{"picture":"抬眼","seconds":99,"performance":"皱眉","purpose":"情绪","emotion":"哭，泪，怒","size":"中景","characters":["林骁",1]}]}',
      "02",
    );
    expect(parsed?.[0]?.seconds).toBe(15);
    const flat = parseDirectorShots(
      '{"shots":[{"picture":"甲","seconds":8},{"picture":"乙","seconds":8}]}',
      "02",
    );
    expect(flat?.map((shot) => shot.seconds)).toEqual([3, 4]);
    const wrapped = parseDirectorShots(
      JSON.stringify({
        scenes: [
          {
            scene_id: "书店",
            shots: [{ picture: "林晚守在柜台后", line: "今晚打烊了", speaker: "林晚", seconds: 3 }],
          },
          {
            place: "医院走廊",
            shots: [{ picture: "林晚靠着墙", line: "你还活着", speaker: "林晚", seconds: 4 }],
          },
        ],
      }),
      "scene-9",
      "",
      [
        { id: "scene-1", title: "雨夜旧书店", where: "书店", text: "林晚说：「今晚打烊了。」" },
        { id: "scene-3", title: "医院走廊", where: "医院走廊", text: "林晚哭着说：「你还活着。」" },
      ],
    );
    expect([...new Set(wrapped?.map((shot) => shot.sceneId))]).toEqual(["scene-1", "scene-3"]);
    const spoken = parseDirectorShots(
      JSON.stringify({
        shots: [
          {
            video_prompt: "林晚站在柜台后",
            dialogue: [{ speaker: "林晚", line: "我叫沈砚" }],
            blocking: [{ who: "林晚", where: "画左" }],
            seconds: 3,
          },
        ],
      }),
      "scene-1",
      "林晚说：“我叫沈砚。”",
    );
    expect(spoken?.[0]?.picture).toContain("林晚站在柜台后");
    expect(spoken?.[0]?.line).toBe("我叫沈砚");
    expect(spoken?.[0]?.speaker).toBe("林晚");
    expect(spoken?.[0]?.blocking).toContain("画左");
    const selected = parseDirectorShots(
      JSON.stringify({
        scene_id: "晚照书店_周烈上门",
        shots: [
          {
            picture: "门被撞开",
            action: "周烈停在门口",
            performance: "看向店内，hold_s 0.4",
            seconds: 4,
            characters: ["周烈"],
          },
        ],
      }),
      "scene-1",
      "我叫沈砚。门被撞开。",
      [
        { id: "scene-1", title: "雨夜旧书店", where: "老城区青石巷·晚照书店", text: "我叫沈砚" },
        { id: "scene-2", title: "书店被闯", where: "晚照书店", text: "门被撞开" },
      ],
    );
    expect([...new Set(selected?.map((shot) => shot.sceneId))]).toEqual(["scene-1"]);
    expect(selected?.[0]?.performance).toContain("停 0.4 秒");
    expect(selected?.[0]?.performance).not.toContain("hold_s");
    expect(blankFilm().aspectRatio).toBe("16:9");
    film.aspectRatio = "16:9";
    writeFilm(window.localStorage, film);
    expect(readFilm(window.localStorage)?.aspectRatio).toBe("16:9");
    expect(parsed?.[0]?.performance).toBe("皱眉");
    expect(parsed?.[0]?.size).toBe("中景");
    const novel = readFileSync(
      resolve(__dirname, "../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
      "utf8",
    );
    const bookstore = novel.slice(0, novel.indexOf("第二场")).trim();
    const budget = shotBudget(bookstore);
    expect(budget).toBe(Math.min(16, Math.round(bookstore.length / 50)));
    expect(budget).toBeLessThanOrEqual(16);
    const many = parseDirectorShots(
      JSON.stringify({
        shots: Array.from({ length: 19 }, (_, index) => ({
          id: `scene-1-shot-${index + 1}`,
          picture: `画面${index + 1}`,
          size: "中景",
          seconds: 3,
        })),
      }),
      "scene-1",
      bookstore,
    );
    expect(many!.length).toBeLessThanOrEqual(budget ?? 16);
    for (let no = 1; no <= 19; no += 1)
      expect(many?.map((shot) => shot.picture).join("\n")).toContain(`画面${no}`);
    expect(shotBudget("雨".repeat(2000))).toBe(16);
    expect(
      parseDirectorShots(
        JSON.stringify({
          shots: Array.from({ length: 20 }, (_, index) => ({
            picture: `画面${index + 1}`,
            seconds: 3,
          })),
        }),
        "scene-1",
        "雨".repeat(2000),
      )?.length,
    ).toBeLessThanOrEqual(16);
    expect(shotBudget("短")).toBe(1);
    expect(parsed?.[0]?.sound.source).toBe("native");
    expect(parsed?.[0]?.characters).toEqual(["林骁"]);
    expect(restored?.audioClips).toEqual([]);
    expect(restored?.shots[0]?.sound.source).toBe("native");
    film.shots[0]!.seconds = 99;
    film.audioClips = [
      {
        id: "clip-1",
        lane: "dialogue",
        shotId: film.shots[0]!.id,
        takeId: "",
        label: "原声",
        startSeconds: 0,
        durationSeconds: 2,
        offsetSeconds: 0,
        gainDb: 0,
      },
    ];
    film.narrationVoiceId = "eve";
    writeFilm(window.localStorage, film);
    const withAudio = readFilm(window.localStorage);
    expect(withAudio?.shots[0]?.seconds).toBe(15);
    expect(withAudio?.audioClips).toHaveLength(1);
    expect(withAudio?.audioClips[0]?.lane).toBe("dialogue");
    expect(withAudio?.narrationVoiceId).toBe("eve");
    expect(withAudio?.scenes[0]?.ambience).toBe("");
    expect(generationNote([])).toContain(IMAGE_MODEL);
    expect(generationNote([IMAGE_MODEL])).toContain(VIDEO_MODEL);
    expect(generationNote([IMAGE_MODEL, VIDEO_MODEL])).toContain("起始画面");
    expect(textModel([])).toBe("");
    expect(textModel(["grok-imagine-video", "grok-4"])).toBe("grok-4");
    expect(textModel(["grok-4-fast"])).toBe("grok-4-fast");
    const stale = sampleFilm();
    stale.jobs = [
      {
        id: "job-1",
        shotId: stale.shots[0]!.id,
        kind: "video",
        take: 1,
        status: "queued",
        prompt: "",
        reason: "",
      },
    ];
    stale.shots[0]!.takes = [
      {
        id: "take-1",
        shotId: stale.shots[0]!.id,
        index: 1,
        status: "running",
        stillUrl: "",
        videoPath: "",
        videoUrl: "",
        prompt: "",
        createdAt: "",
        reason: "",
      },
    ];
    const settled = interruptStaleWork(stale);
    expect(settled.interrupted).toBe(true);
    expect(settled.film.jobs[0]?.status).toBe("failed");
    expect(settled.film.jobs[0]?.reason).toBe("已中断");
    expect(settled.film.shots[0]?.takes[0]?.reason).toBe("已中断，可以重试。");
    expect(interruptStaleWork(settled.film).interrupted).toBe(false);
  });
});
