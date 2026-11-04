import { describe, expect, it } from "vitest";
import { upgradeFilm } from "../../film/project";
import { mediaUrl } from "./media";
import { exportedShots, sceneName, shotName, takeInUse } from "./names";
import { readProject, type ProjectShot, type ProjectView } from "./read";
import { sampleProjectJson } from "./sampleProject";

function sample(): ProjectView {
  const read = readProject(sampleProjectJson());
  if (!read.ok) throw new Error(read.reason);
  return read.project;
}

describe("readProject", () => {
  it("refuses only what is not an object", () => {
    for (const value of [null, undefined, "{}", 3, []]) {
      expect(readProject(value)).toEqual({
        ok: false,
        reason: "作品记录不是一份完整的作品，读不出来。",
      });
    }
    expect(readProject({}).ok).toBe(true);
  });

  it("reads the example project as saved, with nothing missing", () => {
    const project = sample();
    expect(project.missing).toEqual([]);
    expect(project.seriesTitle).toBe("雨夜旧书店");
    expect(project.aspectRatio).toBe("9:16");
    expect(project.scenes.map((scene) => scene.no)).toEqual([1, 2, 3]);
    expect(project.shots).toHaveLength(8);
    expect(project.shots[0]?.takes.map((take) => take.status)).toEqual(["done", "done"]);
    expect(project.shots[0]?.musicMood).toBe("不安");
    expect(project.jobs.map((job) => job.status)).toEqual(["running", "blocked"]);
    expect(project.audioClips.map((clip) => clip.lane)).toEqual(["dialogue", "score"]);
  });

  it("leaves a gap empty and notes where it was, instead of filling it", () => {
    const read = readProject({
      title: 7,
      aspectRatio: "4:3",
      scenes: [{ id: "a", title: "第 1 场" }, { title: "没有编号" }, "x"],
      shots: [
        {
          id: "s1",
          sound: "loud",
          stills: [{ url: "/still.png" }, "x", { url: "" }],
          takes: [{ id: "t1", status: "done" }, { id: "t2", status: "lost" }, { status: "done" }],
        },
      ],
      jobs: [
        { id: "j1", kind: "voice", status: "queued" },
        { id: "j2", kind: "video", status: "waiting" },
        { id: "j3", kind: "portrait", status: "done", take: "1" },
      ],
      audioClips: [
        { id: "c1", lane: "music" },
        { id: "c2", lane: "dialogue", path: "/v.mp3" },
      ],
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const { project } = read;
    expect(project.missing).toEqual([
      "title",
      "seriesTitle",
      "episodeTitle",
      "aspectRatio",
      "scenes[1]",
      "scenes[2]",
      "scenes[0].no",
      "shots[0].sceneId",
      "shots[0].no",
      "shots[0].seconds",
      "shots[0].takes[2]",
      "shots[0].takes[0].index",
      "shots[0].takes[1].status",
      "jobs[0].kind",
      "jobs[1].status",
      "audioClips[0].lane",
      "audioClips[1].gainDb",
    ]);
    expect(project.title).toBe("");
    expect(project.aspectRatio).toBeNull();
    expect(project.scenes).toEqual([{ id: "a", no: null, title: "第 1 场", where: "", text: "" }]);
    const shot = project.shots[0]!;
    expect(shot).toMatchObject({ no: null, seconds: null, sceneId: "", musicMood: "" });
    expect(shot.stills).toEqual(["/still.png"]);
    expect(shot.takes).toEqual([
      {
        id: "t1",
        index: null,
        status: "done",
        stillUrl: "",
        videoPath: "",
        reason: "",
        createdAt: "",
      },
    ]);
    expect(project.jobs).toEqual([
      { id: "j3", shotId: "", kind: "portrait", take: null, status: "done", reason: "" },
    ]);
    expect(project.audioClips).toEqual([
      { id: "c2", lane: "dialogue", shotId: "", gainDb: null, path: "/v.mp3" },
    ]);
  });

  it("notes missing lists and does not invent a scene the way upgradeFilm does", () => {
    const read = readProject({ title: "雨夜旧书店", seriesTitle: "", episodeTitle: "" });
    expect(read.ok && read.project.missing).toEqual([
      "aspectRatio",
      "scenes",
      "shots",
      "jobs",
      "audioClips",
    ]);
    expect(read.ok && read.project.scenes).toEqual([]);
    expect(upgradeFilm({ title: "雨夜旧书店" })?.scenes[0]?.title).toBe("第 1 场");
  });
});

describe("names", () => {
  const project = sample();
  const at = (id: string) => project.shots.find((shot) => shot.id === id)!;

  it("names shots by the saved scene and shot numbers", () => {
    expect(shotName(project, at("scene-2-shot-3"))).toBe("第 2 场第 3 个镜头");
    const moved: ProjectShot = { ...at("scene-2-shot-3"), sceneId: "gone" };
    expect(shotName(project, moved)).toBe("镜头 3");
    expect(shotName(project, { ...moved, no: null })).toBe("scene-2-shot-3");
    const unnumbered = { ...project, scenes: [{ ...project.scenes[1]!, no: null }] };
    expect(shotName(unnumbered, at("scene-2-shot-3"))).toBe("镜头 3");
  });

  it("names scenes without repeating the number", () => {
    const scene = project.scenes[1]!;
    expect(sceneName(scene)).toBe("第 2 场 · 码头仓库");
    expect(sceneName({ ...scene, title: "第 2 场" })).toBe("第 2 场");
    expect(sceneName({ ...scene, title: " " })).toBe("第 2 场");
    expect(sceneName({ ...scene, no: null })).toBe("码头仓库");
    expect(sceneName({ ...scene, no: null, title: "" })).toBe("scene-2");
  });

  it("picks the take the export uses, as chosenExport does", () => {
    expect(takeInUse(at("scene-1-shot-1"))?.id).toBe("s1-1-t2");
    expect(takeInUse(at("scene-1-shot-2"))?.id).toBe("s1-2-t1");
    expect(takeInUse(at("scene-1-shot-3"))).toBeUndefined();
    expect(takeInUse(at("scene-2-shot-3"))).toBeUndefined();
    const noFile = {
      ...at("scene-1-shot-2"),
      takes: [{ ...at("scene-1-shot-2").takes[0]!, videoPath: "" }],
    };
    expect(takeInUse(noFile)).toBeUndefined();
    expect(exportedShots(project).map(({ shot, take }) => `${shot.id}:${take.id}`)).toEqual([
      "scene-1-shot-1:s1-1-t2",
      "scene-1-shot-2:s1-2-t1",
      "scene-2-shot-1:s2-1-t1",
    ]);
  });
});

describe("mediaUrl", () => {
  it("loads saved paths the way the workspace does", () => {
    expect(mediaUrl("")).toBe("");
    expect(mediaUrl("https://x/a.png")).toBe("https://x/a.png");
    expect(mediaUrl("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
    expect(mediaUrl("blob:abc")).toBe("blob:abc");
    expect(mediaUrl("aivora-media://local/?path=%2Fa.png")).toBe(
      "aivora-media://local/?path=%2Fa.png",
    );
    expect(mediaUrl("/films/a b.png")).toBe("aivora-media://local/?path=%2Ffilms%2Fa%20b.png");
    expect(mediaUrl("C:\\films\\a.png")).toBe("aivora-media://local/?path=C%3A%5Cfilms%5Ca.png");
    expect(mediaUrl("stills/a.png")).toBe("");
  });
});
