import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { planPrompterDraft, type PrompterActionHost } from "./prompter";

it("locks appearance in request and reply while changing only prompt fields of the target shot", async () => {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  shot.characters = [film.characters[0]!.name];
  shot.userFields = ["picture", "action", "line"];
  const snapshot = structuredClone(film);
  const request = vi.fn<PrompterActionHost["request"]>().mockResolvedValue({
    text: JSON.stringify({
      keyframe: { prompt_zh: "门边近景。", prompt_en: "Close-up by the door." },
    }),
    detail: "",
  });
  const result = await planPrompterDraft(film, shot, { request, current: () => true });
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]![0]).toBe("prompter");
  expect(request.mock.calls[0]![1]).toContain(film.characters[0]!.identity);
  expect(request.mock.calls[0]![2]).toBe("写成这一镜的提示词。只输出 JSON。");
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected prompt draft");
  expect(result.zh).toContain(film.characters[0]!.identity);
  expect(result.missing).toContain(film.characters[0]!.name);
  expect(result.en).toBe("Close-up by the door.");
  expect(result.film.shots[0]).toEqual({ ...shot, promptZh: result.zh, promptEn: result.en });
  expect(result.film.shots[1]).toBe(film.shots[1]);
  expect(film).toEqual(snapshot);
});

it("retains the existing Chinese fallback for an English-only reply", async () => {
  const film = sampleFilm();
  const request = vi.fn<PrompterActionHost["request"]>().mockResolvedValue({
    text: JSON.stringify({ keyframe: { prompt_en: "A close-up." } }),
    detail: "",
  });
  const result = await planPrompterDraft(film, film.shots[0]!, { request, current: () => true });
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.zh).toBe(request.mock.calls[0]![1]);
    expect(result.en).toBe("A close-up.");
  }
});

it.each(["not JSON", "{}"])(
  "rejects malformed/empty content (%s) without film output",
  async (text) => {
    const film = sampleFilm();
    expect(
      await planPrompterDraft(film, film.shots[0]!, {
        request: async () => ({ text, detail: "" }),
        current: () => true,
      }),
    ).toMatchObject({
      status: "rejected",
      structuredNotice: { code: "PLANPROMPTER_FAILED", detail: "本次没有修改画面说明。" },
    });
  },
);

it.each([null, "incomplete reply"])("retains the provider failure detail (%s)", async (text) => {
  const film = sampleFilm();
  expect(
    await planPrompterDraft(film, film.shots[0]!, {
      request: async () => ({ text, detail: "需要重新登录。", code: "REAUTH_REQUIRED" }),
      current: () => true,
    }),
  ).toMatchObject({
    status: "rejected",
    structuredNotice: { code: "REAUTH_REQUIRED", detail: "需要重新登录。 本次没有修改画面说明。" },
  });
});

it("discards late replies after the host invalidates the turn or edited inputs", async () => {
  const film = sampleFilm();
  let current = true;
  let resolve!: (reply: { text: string; detail: string }) => void;
  const pending = planPrompterDraft(film, film.shots[0]!, {
    request: () =>
      new Promise((done) => {
        resolve = done;
      }),
    current: () => current,
  });
  current = false;
  resolve({ text: '{"prompt_zh":"迟到的提示词"}', detail: "" });
  expect(await pending).toEqual({ status: "stale" });
});

it("propagates request errors to the existing foreground boundary", async () => {
  const film = sampleFilm();
  const error = new Error("request failed");
  await expect(
    planPrompterDraft(film, film.shots[0]!, {
      request: async () => {
        throw error;
      },
      current: () => true,
    }),
  ).rejects.toBe(error);
});
