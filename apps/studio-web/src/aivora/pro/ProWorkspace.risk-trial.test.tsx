import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";
import * as editors from "./actions/editor-host";
import * as queues from "./film-persistence";
import * as view from "./RiskTrialReview";
import { deferred } from "./shot-audio-suggestions.test-fixture";
const originalHost = editors.createEditorHost,
  originalQueue = queues.createFilmPersistence,
  OriginalReview = view.RiskTrialReview;
const running = new Set<Promise<unknown>>();
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(async () => {
  cleanup();
  while (running.size) await Promise.allSettled([...running]);
  vi.restoreAllMocks();
});
async function open(options: { offline?: boolean } = {}) {
  const film = sampleFilm();
  film.scenes = film.scenes.slice(0, 2);
  film.jobs = [];
  film.audioClips = [];
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.shots = [2, 1, 1].map((no, i) => ({
    ...structuredClone(film.shots[0]!),
    id: `risk-host-${i}`,
    sceneId: film.scenes[i === 2 ? 1 : 0]!.id,
    no,
    line: "",
    lines: [],
    speaker: "",
    poster: "",
    stills: [],
    takes: [],
    selectedTakeId: "",
    userFields: [],
  }));
  film.shots[0]!.lines = [
    { speaker: "甲", text: "你好。" },
    { speaker: "乙", text: "再见。" },
  ];
  film.shots[0]!.takes = [1, 2].map((index) => ({
    id: `private-version-${index}`,
    shotId: film.shots[0]!.id,
    index,
    status: "done",
    videoPath: `/private/not-inspected-${index}.mp4`,
    videoUrl: "",
    stillUrl: "",
    createdAt: "",
    prompt: "",
    reason: "",
  }));
  film.shots[0]!.selectedTakeId = "private-version-1";
  let host!: Parameters<typeof originalHost>[0], queue!: ReturnType<typeof originalQueue>;
  const firstSave = deferred<void>();
  const savedInputs: FilmProject[] = [];
  vi.spyOn(editors, "createEditorHost").mockImplementation((value) => {
    host = value;
    return originalHost(value);
  });
  vi.spyOn(queues, "createFilmPersistence").mockImplementation((options) => {
    const q = originalQueue(options),
      save = q.save;
    q.save = (...args) => {
      const result = save(...args);
      running.add(result);
      void result.then(
        (stored) => {
          running.delete(result);
          if (stored) savedInputs.push(args[0]);
          if (stored?.id === film.id) firstSave.resolve();
        },
        () => running.delete(result),
      );
      return result;
    };
    vi.spyOn(q, "acquire");
    queue = q;
    return q;
  });
  const props: Parameters<typeof OriginalReview>[0][] = [];
  vi.spyOn(view, "RiskTrialReview").mockImplementation((value) => {
    props.push(value);
    return OriginalReview(value);
  });
  const disk = new Map([[film.id, structuredClone(film)]]),
    write = vi.fn(async (raw: FilmProject) => {
      disk.set(raw.id, structuredClone(raw));
      return structuredClone(raw);
    });
  const media = vi.fn(),
    text = vi.fn(),
    prepare = vi.fn();
  window.aijian = {
    listFilmSeries: async () => [],
    readFilmProject: async (id: string) => structuredClone(disk.get(id) ?? null),
    writeFilmProject: write,
    prepareFilmProject: prepare,
    createStoryFilm: media,
  } as unknown as Window["aijian"];
  if (!options.offline)
    window.aijianGrok = {
      status: async () => ({
        provider: "GROK_LOGIN",
        runtime: "DESKTOP",
        state: "CONNECTED",
        secureStorage: "AVAILABLE",
        accountLabel: "synthetic",
        lastError: null,
      }),
      models: async () => ({ kind: "OK", models: [{ id: "grok-4.7", label: "text" }] }),
      completeText: text,
    } as unknown as Window["aijianGrok"];
  localStorage.setItem("aivora.film.activeId", film.id);
  const rendered = render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await firstSave.promise;
  const show = () => {
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "查看试片候选" }));
    return screen.getByRole("dialog", { name: "试片候选审阅" });
  };
  return {
    film,
    disk,
    write,
    media,
    text,
    prepare,
    props,
    savedInputs,
    show,
    rendered,
    queue: () => queue,
    host: () => host,
    adopt: (raw: FilmProject) => act(() => host.applyLive(raw)),
  };
}
it("opens from the real work menu with no default trial choice, no draft mutation, write, owner, provider or generation permission", async () => {
  const f = await open(),
    before = structuredClone(f.host().current()),
    count = f.write.mock.calls.length;
  const selection = structuredClone(f.host().selection());
  const dialog = f.show();
  expect(
    within(dialog)
      .getAllByRole("radio")
      .every((el) => !(el as HTMLInputElement).checked),
  ).toBe(true);
  expect(within(dialog).getByRole("button", { name: "在分镜查看" })).toBeDisabled();
  fireEvent.click(within(dialog).getAllByRole("radio")[1]!);
  expect(within(dialog).getByRole("region", { name: "候选详情" })).toHaveTextContent(
    "第 1 版 · 完成记录（文件与内容未核验）",
  );
  expect(dialog.textContent).not.toMatch(/private-version|\/private\/|\.mp4/);
  expect(screen.queryByRole("dialog", { name: "生成前确认" })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "刷新候选" }));
  const refreshed = screen.getByRole("dialog", { name: "试片候选审阅" });
  expect(
    within(refreshed)
      .getAllByRole("radio")
      .every((el) => !(el as HTMLInputElement).checked),
  ).toBe(true);
  fireEvent.click(within(refreshed).getByRole("button", { name: "关闭" }));
  expect(f.host().current()).toEqual(before);
  expect(f.host().selection()).toEqual(selection);
  expect(f.write).toHaveBeenCalledTimes(count);
  expect(f.queue().acquire).not.toHaveBeenCalled();
  expect(f.text).not.toHaveBeenCalled();
  expect(f.media).not.toHaveBeenCalled();
  expect(f.prepare).not.toHaveBeenCalled();
  await expect(f.queue().flushAll()).resolves.toMatchObject({ status: "saved" });
});
it("navigates only on the explicit view action, preserving the latest title and all media despite unrelated save metadata", async () => {
  const f = await open(),
    dialog = f.show();
  fireEvent.click(within(dialog).getAllByRole("radio")[1]!);
  const before = structuredClone(f.host().current()!),
    old = f.props.at(-1)!;
  f.adopt({ ...before, title: "后来改的标题", savedAt: "later", directory: "/private/later" });
  expect(within(dialog).queryByRole("alert")).toBeNull();
  await act(async () => old.onInspect(old.review.candidates[1]!.id));
  await waitFor(() => expect(f.host().selection().page).toBe("board"));
  expect(f.host().selection().shotId).toBe(f.film.shots[0]!.id);
  expect(f.host().current()!.title).toBe("后来改的标题");
  expect(f.host().current()!.shots).toEqual(before.shots);
  expect(screen.queryByRole("dialog", { name: "生成前确认" })).toBeNull();
  expect(f.text).not.toHaveBeenCalled();
  expect(f.media).not.toHaveBeenCalled();
});
it.each(["source", "take", "project"])(
  "rejects a retained navigation callback after %s changes and requires refreshed facts",
  async (kind) => {
    const f = await open(),
      dialog = f.show();
    fireEvent.click(within(dialog).getAllByRole("radio")[0]!);
    const old = f.props.at(-1)!,
      live = structuredClone(f.host().current()!);
    if (kind === "source") live.shots[0]!.picture = "用户改了当前画面文字";
    if (kind === "take") live.shots[0]!.selectedTakeId = "private-version-2";
    if (kind === "project") live.id = "film_risk_other_0001";
    f.adopt(live);
    const savedDraft = f.host().current()!;
    await waitFor(() => expect(f.savedInputs).toContain(savedDraft));
    const selection = structuredClone(f.host().selection()),
      current = f.host().current(),
      count = f.write.mock.calls.length;
    await act(async () => old.onInspect(old.review.candidates[0]!.id));
    expect(f.host().selection()).toEqual(selection);
    expect(f.host().current()).toBe(current);
    expect(f.write).toHaveBeenCalledTimes(count);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("已变化");
    expect(within(dialog).getByRole("button", { name: "在分镜查看" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "刷新候选" }));
    const refreshed = screen.getByRole("dialog", { name: "试片候选审阅" });
    expect(within(refreshed).queryByRole("alert")).toBeNull();
    await act(async () => old.onInspect(old.review.candidates[0]!.id));
    expect(within(refreshed).queryByRole("alert")).toBeNull();
    expect(
      within(refreshed)
        .getAllByRole("radio")
        .every((el) => !(el as HTMLInputElement).checked),
    ).toBe(true);
    expect(f.queue().acquire).not.toHaveBeenCalled();
    expect(f.text).not.toHaveBeenCalled();
    expect(f.media).not.toHaveBeenCalled();
  },
);
it("retires closed or unmounted view callbacks without navigation or queue work", async () => {
  const f = await open(),
    dialog = f.show(),
    old = f.props.at(-1)!;
  const selected = structuredClone(f.host().selection());
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  await act(async () => old.onInspect(old.review.candidates[0]!.id));
  expect(f.host().selection()).toEqual(selected);
  f.show();
  const again = f.props.at(-1)!;
  f.rendered.unmount();
  await act(async () => again.onInspect(again.review.candidates[0]!.id));
  expect(f.host().selection()).toEqual(selected);
  expect(f.queue().acquire).not.toHaveBeenCalled();
  expect(f.media).not.toHaveBeenCalled();
});

it("can review current text and records without a membership text bridge or model request", async () => {
  const f = await open({ offline: true }),
    dialog = f.show();
  expect(dialog).toHaveTextContent("只根据文字和记录");
  fireEvent.click(within(dialog).getAllByRole("radio")[0]!);
  expect(within(dialog).getByRole("region", { name: "候选详情" })).toHaveTextContent(
    "仍待播放核对",
  );
  expect(f.text).not.toHaveBeenCalled();
  expect(f.media).not.toHaveBeenCalled();
  expect(f.queue().acquire).not.toHaveBeenCalled();
});
