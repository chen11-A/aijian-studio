import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../../film/project";
import { remakeCleanCopies } from "./clean-copy";

function fixture() {
  const base = sampleFilm();
  base.shots = base.shots.slice(0, 3).map((shot, index) => ({
    ...shot,
    line: "需要字幕的台词",
    lines: [{ speaker: "林晚", text: "需要字幕的台词" }],
    selectedTakeId: `chosen-${index}`,
    takes: [0, 1].map((version) => ({
      id: version ? `other-${index}` : `chosen-${index}`,
      shotId: shot.id,
      index: version + 1,
      status: "done" as const,
      videoPath: `/tmp/original-${index}-${version}.mp4`,
      videoUrl: "",
      stillUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    })),
  }));
  let live: FilmProject | null = base;
  const apply = vi.fn((next: FilmProject) => {
    live = next;
  });
  const persist = vi.fn(async (_snapshot: FilmProject) => undefined);
  const host = { current: () => live, apply, persist };
  return {
    base,
    host,
    persist,
    apply,
    live: () => live!,
    set: (next: FilmProject | null) => {
      live = next;
    },
  };
}
const success = {
  data: {
    status: "SUCCEEDED",
    clean_output_path: "/tmp/repaired-clean.mp4",
    subtitle_cues: [{ text: "台词", start_seconds: 0, end_seconds: 1 }],
  },
  request_id: "test",
};
function install(make = vi.fn().mockResolvedValue(success)) {
  window.aijian = { remakeStoryFilmCleanCopy: make } as unknown as Window["aijian"];
  return make;
}
afterEach(() => {
  delete window.aijian;
});

describe("4B-B12 clean copy current selection and persistence", () => {
  it.each(["project", "selection", "path", "removed"])(
    "does not dispatch an already changed %s",
    async (kind) => {
      const f = fixture();
      const make = install();
      const changed = structuredClone(f.base);
      if (kind === "project") changed.id += "other";
      else if (kind === "selection") changed.shots[0]!.selectedTakeId = "other-0";
      else if (kind === "path") changed.shots[0]!.takes[0]!.videoPath = "/tmp/changed.mp4";
      else changed.shots.shift();
      f.set(changed);
      const result = await remakeCleanCopies(f.base, [f.base.shots[0]!.id], "billing", f.host);
      expect(make).not.toHaveBeenCalled();
      expect(f.apply).not.toHaveBeenCalled();
      expect(result.outcomes.map((item) => item.status)).toEqual(["stale"]);
      expect(result.notice).toContain("已经变化");
      expect(result.notice).not.toMatch(/补好了|没有需要补做/);
    },
  );

  it.each(["project", "selection", "path", "removed"])(
    "does not write or report done after a %s changes during the request",
    async (kind) => {
      const f = fixture();
      const make = install(
        vi.fn(async () => {
          const changed = structuredClone(f.live());
          if (kind === "project") changed.id += "other";
          else if (kind === "selection") changed.shots[0]!.selectedTakeId = "other-0";
          else if (kind === "path") changed.shots[0]!.takes[0]!.videoPath = "/tmp/changed.mp4";
          else changed.shots.shift();
          f.set(changed);
          return success;
        }),
      );
      const result = await remakeCleanCopies(f.base, [f.base.shots[0]!.id], "billing", f.host);
      expect(make).toHaveBeenCalledTimes(1);
      expect(f.apply).not.toHaveBeenCalled();
      expect(f.persist).not.toHaveBeenCalled();
      expect(result.outcomes[0]?.status).toBe("stale");
      expect(result.notice).not.toContain("补好了");
    },
  );

  it("keeps partial success durable before dispatching the next target and stops on work switch", async () => {
    const f = fixture();
    const make = install();
    f.persist.mockImplementationOnce(async (snapshot) => {
      expect(make).toHaveBeenCalledTimes(1);
      expect(snapshot.shots[0]!.takes[0]!.cleanVideoPath).toBe(success.data.clean_output_path);
      f.set({ ...structuredClone(snapshot), id: "film_switched000001" });
    });
    const result = await remakeCleanCopies(f.base, null, "billing", f.host);
    expect(make).toHaveBeenCalledTimes(1);
    expect(f.persist).toHaveBeenCalledTimes(1);
    expect(f.persist.mock.calls[0]![0].id).toBe(f.base.id);
    expect(result.outcomes.map((item) => item.status)).toEqual(["done", "stale"]);
    expect(result.notice).toContain("补好了");
    expect(result.notice).toContain("已经变化");
  });

  it("never reports done if the host did not apply the result", async () => {
    const f = fixture();
    install();
    const result = await remakeCleanCopies(f.base, [f.base.shots[0]!.id], "billing", {
      ...f.host,
      apply: () => undefined,
    });
    expect(result.outcomes[0]?.status).toBe("stale");
    expect(result.notice).not.toContain("补好了");
    expect(f.persist).not.toHaveBeenCalled();
  });

  it("keeps selected/nonselected original takes and later text edits while writing only the requested copy", async () => {
    const f = fixture();
    const make = install(
      vi.fn(async () => {
        f.set({ ...f.live(), title: "后来修改的标题" });
        return success;
      }),
    );
    const before = structuredClone(f.base);
    const result = await remakeCleanCopies(f.base, [f.base.shots[1]!.id], "billing", f.host);
    expect(make).toHaveBeenCalledWith("billing", before.shots[1]!.takes[0]!.videoPath);
    expect(result.outcomes[0]?.status).toBe("done");
    expect(f.live().title).toBe("后来修改的标题");
    expect(f.live().shots[0]).toEqual(before.shots[0]);
    expect(f.live().shots[2]).toEqual(before.shots[2]);
    expect(f.live().shots[1]!.takes[1]).toEqual(before.shots[1]!.takes[1]);
    expect(f.live().shots[1]!.takes[0]).toMatchObject({
      videoPath: before.shots[1]!.takes[0]!.videoPath,
      cleanVideoPath: success.data.clean_output_path,
    });
  });

  it("uses stable Chinese error categories and never exposes exception or service paths", async () => {
    const f = fixture();
    install(vi.fn().mockRejectedValue(new Error("/private/user/source.mp4 socket secret-detail")));
    const result = await remakeCleanCopies(f.base, [f.base.shots[0]!.id], "billing", f.host);
    expect(result.notice).toContain("本机处理没有完成");
    expect(result.notice).not.toMatch(/private|source\.mp4|secret-detail/);
    install(
      vi.fn().mockResolvedValue({
        data: {
          status: "FAILED",
          clean_copy_reason: "/private/user/font.ttf",
          clean_copy_error: "UNKNOWN",
        },
      }),
    );
    const service = await remakeCleanCopies(f.base, [f.base.shots[1]!.id], "billing", f.host);
    expect(service.notice).toContain("不带字幕的那份没有做出来");
    expect(service.notice).not.toContain("private");
  });
});
