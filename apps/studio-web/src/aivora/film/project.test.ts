import { describe, expect, it } from "vitest";
import { offlineRotation } from "../shot-plan";
import {
  applyShots,
  assistantPrompt,
  agentRequest,
  blankFilm,
  generationNote,
  keyframePrompt,
  newFilmId,
  offlineShots,
  parseDirectorShots,
  readFilm,
  sampleFilm,
  textModel,
  videoPrompt,
  writeFilm,
} from "./project";
import { IMAGE_MODEL, TEXT_MODEL, VIDEO_MODEL } from "../pro/capabilities";

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
    expect(offlineRotation("雨夜巷战")).toHaveLength(6);
  });

  it("puts the project in front of the assistant and the director", () => {
    const film = sampleFilm();
    const prompt = assistantPrompt("这一场怎么写", film);
    expect(prompt).toContain("雨夜巷战");
    expect(prompt).toContain("这一场怎么写");
    expect(prompt).toContain("不要改作品");
    expect(agentRequest("director", "画风", "拆开")).toContain("你是短剧导演");
    expect(assistantPrompt("   ", null)).toContain("短剧助手");
    expect(assistantPrompt("很".repeat(8000), film).length).toBe(7500);
    expect(agentRequest("writer", "很".repeat(8000), "写").length).toBe(7500);
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
    const parsed = parseDirectorShots(
      '说明 {"shots":[{"picture":"抬眼","seconds":99,"characters":["林骁",1]}]}',
      "02",
    );
    expect(parsed?.[0]?.seconds).toBe(15);
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
    expect(textModel([])).toBe(TEXT_MODEL);
    expect(textModel(["grok-4-fast"])).toBe("grok-4-fast");
  });
});
