import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { detectDirectorCoverage } from "../../film/director-continuity";
import { enrichDirectorPlan } from "../enrichment-workflow";
import { directorRequestInput } from "./director";
import { retryDirectorDraft, type DirectorRetryHost } from "./director-retry";

function setup() {
  const film = sampleFilm();
  film.scenes = [
    {
      ...film.scenes[0]!,
      id: "scene-p101",
      text: "甲说：“别走。”\n门关了。",
      writerSourceText: "甲说：“别走。”\n门关了。",
      writerParagraphIds: ["P101", "P102"],
      sourceParagraphIds: ["P101", "P102"],
      userFields: [],
    },
  ];
  const scene = film.scenes[0]!;
  const context = directorRequestInput(film, scene.id, scene.text, scene.text).context;
  const job = { context: `${context}\n补充要求：门在左边。`, instruction: "只返回JSON，完整重试" };
  const host: DirectorRetryHost = {
    request: vi.fn<DirectorRetryHost["request"]>().mockResolvedValue({
      text: '{"shots":[{"picture":"甲站在门口","line":"别走。","seconds":3}]}',
      detail: "",
    }),
    current: () => true,
    progress: vi.fn(),
    notify: vi.fn(),
    enrich: vi.fn<DirectorRetryHost["enrich"]>().mockImplementation((base, sceneId, shots, valid) =>
      enrichDirectorPlan(base, sceneId, shots, {
        valid,
        request: async (role) => ({
          text:
            role === "director"
              ? JSON.stringify({
                  shots: [
                    { picture: "甲站在门口", line: "别走。", seconds: 3 },
                    { picture: scene.text, line: "别走。", seconds: 3 },
                  ],
                })
              : null,
          detail: "",
        }),
        warning: vi.fn(),
        unassigned: vi.fn(),
      }),
    ),
  };
  return { film, scene, job, host };
}
it("keeps saved P101 source wording and routes parsed shots through real coverage enrichment", async () => {
  const { film, scene, job, host } = setup();
  const before = structuredClone(film);
  const result = await retryDirectorDraft(film, scene.id, job, host);
  expect(host.request).toHaveBeenCalledWith(
    "director",
    expect.stringContaining("[P101] 甲说：“别走。”"),
    job.instruction,
    expect.any(Object),
  );
  const context = vi.mocked(host.request).mock.calls[0]![1];
  expect(context).toContain("[P102] 门关了。");
  expect(context).toContain("补充要求：门在左边。");
  expect(context).not.toContain("[P01]");
  expect(result.kind).toBe("ready");
  if (result.kind === "ready") expect(detectDirectorCoverage(scene, result.shots).ok).toBe(true);
  expect(host.enrich).toHaveBeenCalledOnce();
  expect(film).toEqual(before);
});
it.each(["request", "enrich"])(
  "discards results when ownership changes during %s",
  async (stage) => {
    const { film, scene, job, host } = setup();
    if (stage === "request") {
      const request = host.request;
      host.request = async (...args) => {
        const result = await request(...args);
        host.current = () => false;
        return result;
      };
    } else
      host.enrich = async (_base, _scene, shots) => {
        host.current = () => false;
        return shots;
      };
    expect(await retryDirectorDraft(film, scene.id, job, host)).toEqual({ kind: "stale" });
    if (stage === "request") expect(host.enrich).not.toHaveBeenCalled();
  },
);
it("does not invent a director plan when retry parsing fails", async () => {
  const { film, scene, job, host } = setup();
  host.request = vi
    .fn<DirectorRetryHost["request"]>()
    .mockResolvedValue({ text: "not JSON", detail: "格式不符" });
  expect(await retryDirectorDraft(film, scene.id, job, host)).toEqual({
    kind: "rejected",
    detail: "格式不符",
  });
  expect(host.enrich).not.toHaveBeenCalled();
});
it("retries a stall once through the existing shared timeout wrapper", async () => {
  const { film, scene, job, host } = setup();
  host.request = vi
    .fn<DirectorRetryHost["request"]>()
    .mockResolvedValueOnce({ text: null, detail: "stalled", code: "TEXT_STALLED" })
    .mockResolvedValueOnce({
      text: '{"shots":[{"picture":"门关了。","line":"别走。"}]}',
      detail: "",
    });
  expect((await retryDirectorDraft(film, scene.id, job, host)).kind).toBe("ready");
  expect(host.request).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(host.request).mock.calls;
  expect(calls[0]![3]?.deadlineAt).toBe(calls[1]![3]?.deadlineAt);
});

it("retains a parsed retry draft at the shared deadline while rejecting late enrichment", async () => {
  vi.useFakeTimers();
  try {
    const { film, scene, job, host } = setup();
    let finish!: (shots: typeof film.shots) => void;
    host.enrich = vi.fn(
      () =>
        new Promise<typeof film.shots>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = retryDirectorDraft(film, scene.id, job, host);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.enrich).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(240_000);
    const result = await pending;
    expect(result).toMatchObject({
      kind: "ready",
      partial: true,
      shots: [expect.objectContaining({ picture: "甲站在门口" })],
    });
    const snapshot = JSON.stringify(result);
    finish([{ ...film.shots[0]!, picture: "迟到内容" }]);
    await Promise.resolve();
    expect(JSON.stringify(result)).toBe(snapshot);
    expect(host.notify).toHaveBeenCalledWith(expect.objectContaining({ code: "TEXT_TIMEOUT" }));
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
