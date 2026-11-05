import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { detectDirectorCoverage } from "../../film/director-continuity";
import { enrichDirectorPlan } from "../enrichment-workflow";
import { directorRequestInput, requestDirectorDraft, type DirectorRequestHost } from "./director";

function fixture() {
  const film = sampleFilm();
  const scene = { ...film.scenes[0]!, id: "scene-1", text: "林晚说：“你来晚了。”\n刹车声传来。" };
  film.scenes = [scene];
  const input = directorRequestInput(
    film,
    scene.id,
    `${scene.text}\n请保持原文，不要增加剧情。`,
    scene.text,
  );
  return { film, scene, input };
}
function host(request: DirectorRequestHost["request"]): DirectorRequestHost {
  return { request, current: () => true, progress: vi.fn(), notify: vi.fn() };
}

it("builds numbered context and preserves the original source boundary for coverage repair", async () => {
  const { film, scene, input } = fixture();
  const before = structuredClone(film);
  const request = vi.fn<DirectorRequestHost["request"]>().mockResolvedValue({
    text: JSON.stringify({ shots: [{ picture: "林晚抬眼。", size: "近景", seconds: 3 }] }),
    detail: "",
  });
  const result = await requestDirectorDraft(input, host(request));
  expect(input.context).toContain(`场次 id：${scene.id}`);
  expect(input.context).toContain(film.characters[0]!.identity);
  expect(input.context).toContain("请保持原文，不要增加剧情。");
  expect(input.sourceText).not.toContain("请保持原文");
  expect(request).toHaveBeenCalledWith(
    "director",
    input.context,
    "把这一场拆成镜头",
    expect.objectContaining({ deadlineAt: expect.any(Number), signal: expect.any(AbortSignal) }),
  );
  expect(result.shots?.length).toBeGreaterThan(0);
  const coverage = detectDirectorCoverage(scene, result.shots!);
  expect(coverage.ok).toBe(false);
  expect(coverage.missingLines).toContain("你来晚了。");
  expect(coverage.missingTail).not.toBeNull();
  expect(JSON.stringify(result.shots)).not.toContain("请保持原文");
  expect(film).toEqual(before);
});

it("retries one stalled request with the same total deadline and reports structured progress", async () => {
  const { input } = fixture();
  const request = vi
    .fn<DirectorRequestHost["request"]>()
    .mockResolvedValueOnce({ text: null, detail: "stalled", code: "TEXT_STALLED" })
    .mockResolvedValueOnce({ text: '{"shots":[{"picture":"林晚抬眼","seconds":3}]}', detail: "" });
  const callbacks = host(request);
  expect((await requestDirectorDraft(input, callbacks)).shots?.length).toBeGreaterThan(0);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0]![3]!.deadlineAt).toBe(request.mock.calls[1]![3]!.deadlineAt);
  expect(request.mock.calls[0]![3]!.signal).toBe(request.mock.calls[1]![3]!.signal);
  expect(callbacks.notify).toHaveBeenCalledWith(
    expect.objectContaining({ code: "STALL_RETRYING" }),
  );
  expect(callbacks.progress).toHaveBeenCalledOnce();
});

it("returns an unusable reply for the existing manual retry flow without inventing shots", async () => {
  const { input } = fixture();
  const request = vi
    .fn<DirectorRequestHost["request"]>()
    .mockResolvedValue({ text: "bad JSON", detail: "没有可用回复" });
  expect(await requestDirectorDraft(input, host(request))).toEqual({
    shots: null,
    detail: "没有可用回复",
  });
  expect(request).toHaveBeenCalledOnce();
});

it("stops after two timeouts and leaves retry decisions to the caller", async () => {
  const { input } = fixture();
  const request = vi
    .fn<DirectorRequestHost["request"]>()
    .mockResolvedValue({ text: null, detail: "timeout", code: "TEXT_TIMEOUT" });
  expect(await requestDirectorDraft(input, host(request))).toEqual({
    shots: null,
    detail: "timeout",
  });
  expect(request).toHaveBeenCalledTimes(2);
});

it("does not send a request for a stale owner and discards an in-flight stale reply", async () => {
  const { input } = fixture();
  const request = vi
    .fn<DirectorRequestHost["request"]>()
    .mockResolvedValue({ text: '{"shots":[{"picture":"late","seconds":3}]}', detail: "" });
  const callbacks = { ...host(request), current: () => false };
  expect((await requestDirectorDraft(input, callbacks)).shots).toBeNull();
  expect(request).not.toHaveBeenCalled();
  let current = true;
  request.mockImplementationOnce(async () => {
    current = false;
    return { text: '{"shots":[{"picture":"late","seconds":3}]}', detail: "" };
  });
  expect(
    (await requestDirectorDraft(input, { ...host(request), current: () => current })).shots,
  ).toBeNull();
  expect(request).toHaveBeenCalledOnce();
});

it("preserves thrown request errors for the component catch/finally", async () => {
  const error = new Error("transport failed");
  await expect(
    requestDirectorDraft(
      fixture().input,
      host(async () => {
        throw error;
      }),
    ),
  ).rejects.toBe(error);
});

it("still feeds the existing enrichment repair without losing the first shot, dialogue or ending", async () => {
  const { film, scene, input } = fixture();
  const result = await requestDirectorDraft(
    input,
    host(async () => ({
      text: '{"shots":[{"picture":"林晚抬眼。","size":"近景","seconds":3}]}',
      detail: "",
    })),
  );
  const request = vi.fn<Parameters<typeof enrichDirectorPlan>[3]["request"]>(async (role) => ({
    text: JSON.stringify(
      role === "director"
        ? {
            shots: [
              { picture: "林晚抬眼。", size: "近景", seconds: 3 },
              { picture: scene.text, line: "你来晚了。", speaker: "林晚", seconds: 4 },
            ],
          }
        : [],
    ),
    detail: "",
  }));
  const repaired = await enrichDirectorPlan(film, scene.id, result.shots!, {
    request,
    valid: () => true,
    warning: vi.fn(),
    unassigned: vi.fn(),
  });
  expect(request).toHaveBeenCalledWith(
    "director",
    expect.any(String),
    expect.stringContaining("只补这一场缺失台词与结尾"),
    expect.objectContaining({ deadlineAt: expect.any(Number), signal: expect.any(AbortSignal) }),
  );
  expect(repaired.map((shot) => shot.picture).join("\n")).toContain("林晚抬眼。");
  expect(detectDirectorCoverage(scene, repaired).ok).toBe(true);
});

it("retains complete scene source metadata for the reply parser", () => {
  const { film } = fixture();
  const scene = film.scenes[0]!;
  scene.sourceParagraphIds = ["P101", "P102"];
  scene.writerParagraphIds = ["P101", "P102"];
  scene.writerSourceText = scene.text;
  const input = directorRequestInput(film, scene.id, scene.text, scene.text);
  expect(input.sceneRefs[0]).toEqual(scene);
  expect(input.sceneRefs[0]?.writerParagraphIds).toEqual(["P101", "P102"]);
  expect(input.context).toContain("[P101] 林晚说：“你来晚了。”");
  expect(input.context).toContain("[P102] 刹车声传来。");
});
