import { writerFieldFixture } from "./actions/writer-field-fixture";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type FilmProject } from "../film/project";
import * as editorModule from "./actions/editor-host";
import * as cardModule from "../next/SuggestionCard";
import { ProWorkspace } from "./ProWorkspace";
const originalHost = editorModule.createEditorHost,
  OriginalCard = cardModule.SuggestionCard;
async function open(
  options: {
    page?: "script" | "board";
    holdSave?: boolean;
    failSave?: boolean;
    needsCast?: boolean;
    rewriteKnownPerson?: boolean;
    failUndoSave?: boolean;
  } = {},
) {
  const { base: film, raw, tx } = writerFieldFixture();
  if (options.needsCast) {
    film.locations = [];
    raw.locations = [];
  }
  if (options.rewriteKnownPerson)
    raw.characters.push({
      name: film.characters[0]!.name,
      identity: "新的成年人物外貌",
      gender: "male",
      age_band: "young",
      first_paragraph: "P01",
      brief: "原人物的新声明",
    });
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  const disk = new Map([[film.id, structuredClone(film)]]);
  let host!: Parameters<typeof originalHost>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return originalHost(value);
  });
  const cards: cardModule.SuggestionCardProps[] = [];
  vi.spyOn(cardModule, "SuggestionCard").mockImplementation((props) => {
    if (props.fieldRows?.some((row) => row.label === "全项目 · 场次顺序")) cards.push(props);
    return OriginalCard(props);
  });
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let appliedWritten = false;
  const writes = vi.fn(async (value: FilmProject) => {
    if (options.failUndoSave && appliedWritten && value.writerPlan === undefined)
      throw Error("synthetic undo save failure");
    if (value.writerPlan?.title === "门外") {
      if (options.holdSave) await hold;
      if (options.failSave) throw Error("synthetic disk failure");
    }
    disk.set(value.id, structuredClone(value));
    if (value.writerPlan?.title === "门外") appliedWritten = true;
    return structuredClone(value);
  });
  const createVideo = vi.fn(),
    speak = vi.fn();
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    readFilmProject: vi.fn(async (id: string) => structuredClone(disk.get(id)!)),
    writeFilmProject: writes,
    prepareFilmProject: vi.fn(async (value: FilmProject) => structuredClone(value)),
    createStoryFilm: createVideo,
  } as unknown as Window["aijian"];
  const completeText = vi.fn(async (_input: { text: string }) => ({
    kind: "OK",
    text: JSON.stringify(raw),
  }));
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "owner",
      lastError: null,
    })),
    models: vi.fn(async () => ({ kind: "OK", models: [{ id: "grok-4.7", label: "text" }] })),
    completeText,
    speak,
  } as unknown as Window["aijianGrok"];
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  if (options.page === "board") {
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
        name: /分镜/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  }
  fireEvent.change(screen.getByLabelText("正在和："), { target: { value: "writer" } });
  return {
    film,
    raw,
    tx,
    disk,
    writes,
    createVideo,
    speak,
    completeText,
    cards,
    host: () => host,
    finish: async () => {
      await act(async () => finish());
    },
  };
}
const ask = () => fireEvent.click(screen.getByRole("button", { name: "让编剧分场" }));
const card = () => screen.getByRole("region", { name: "助手的建议" });
beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => vi.restoreAllMocks());

it("reviews the complete whole-project writer structure and source/cast/cleanup effects before confirming, then inverses its own receipt", async () => {
  const f = await open();
  const original = structuredClone(f.host().current()!);
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  for (const label of [
    "场次顺序",
    "清理未使用自动镜头",
    "新增 · 人物",
    "新增 · 地点",
    "编剧完整创作声明",
  ])
    expect(card()).toHaveTextContent(label);
  expect(f.host().current()!.shots).toHaveLength(f.film.shots.length);
  expect(f.host().current()!.writerPlan).toBeUndefined();
  const text = card().textContent;
  const live = structuredClone(f.host().current()!);
  live.title = "新标题";
  act(() => f.host().applyLive(live));
  expect(card().textContent).toBe(text);
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.writerPlan?.title).toBe("门外"));
  expect(f.host().current()!.shots).toEqual([]);
  expect(
    f
      .host()
      .current()!
      .characters.some((person) => person.name === "梅子"),
  ).toBe(true);
  expect(
    f
      .host()
      .current()!
      .locations.some((place) => place.name === "门口"),
  ).toBe(true);
  const newer = structuredClone(f.host().current()!);
  newer.title = "确认后的新标题";
  act(() => f.host().applyLive(newer));
  fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(f.host().current()!.shots).toHaveLength(f.film.shots.length));
  expect(f.host().current()!.title).toBe("确认后的新标题");
  expect(f.host().current()!.sourceText).toBe(f.film.sourceText);
  expect(f.host().current()!.characters).toEqual(original.characters);
  expect(f.host().current()!.writerPlan).toBeUndefined();
  expect(f.completeText).toHaveBeenCalledOnce();
  expect(f.createVideo).not.toHaveBeenCalled();
  expect(f.speak).not.toHaveBeenCalled();
});
it.each(["source", "media", "audio"])(
  "preserves the full old structure and refuses new %s work before any writer apply",
  async (mode) => {
    const f = await open();
    ask();
    await screen.findByRole("button", { name: "确认修改" });
    const live = structuredClone(f.host().current()!);
    if (mode === "source") live.sourceText = "用户新原稿";
    if (mode === "media") live.shots[0]!.poster = "/late.png";
    if (mode === "audio")
      live.audioClips.push({
        id: "late-audio",
        shotId: live.shots[0]!.id,
        takeId: "",
        lane: "dialogue",
        path: "/late.wav",
        label: "晚配音",
        startSeconds: 0,
        durationSeconds: 1,
        offsetSeconds: 0,
        gainDb: 0,
      });
    act(() => f.host().applyLive(live));
    const current = f.host().current(),
      n = f.writes.mock.calls.length;
    fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
    expect(f.host().current()).toBe(current);
    expect(f.writes.mock.calls.length).toBe(n);
    expect(card()).not.toHaveTextContent("已应用这次字段修改。");
    expect(f.createVideo).not.toHaveBeenCalled();
  },
);

it("blocks reject, duplicate apply and own undo while its real save is pending", async () => {
  const f = await open({ holdSave: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const pending = f.cards.at(-1)!;
  try {
    fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
    await waitFor(() =>
      expect(f.writes.mock.calls.some(([value]) => value.writerPlan?.title === "门外")).toBe(true),
    );
    const n = f.writes.mock.calls.length;
    act(() => {
      pending.onReject?.();
      pending.onApply();
    });
    expect(card()).toHaveTextContent("已应用这次字段修改。");
    expect(within(card()).getByRole("button", { name: "撤销" })).toBeDisabled();
    expect(f.writes.mock.calls.length).toBe(n);
  } finally {
    await f.finish();
  }
  await waitFor(() => expect(within(card()).getByRole("button", { name: "撤销" })).toBeEnabled());
  expect(f.completeText).toHaveBeenCalledOnce();
});
it("keeps applied-but-unsaved structure and never reports a saved writer result after actual write failure", async () => {
  const f = await open({ failSave: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await screen.findAllByText(/修改没存上/);
  expect(f.host().current()!.writerPlan?.title).toBe("门外");
  expect(f.disk.get(f.film.id)!.writerPlan).toBeUndefined();
  expect(card()).toHaveTextContent("已应用这次字段修改。");
  expect(f.completeText).toHaveBeenCalledOnce();
  expect(f.createVideo).not.toHaveBeenCalled();
});
it("retires rejected and replaced card callbacks instead of rebinding them to a newer proposal", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const old = f.cards.at(-1)!;
  fireEvent.click(within(card()).getByRole("button", { name: "不要" }));
  act(() => old.onApply());
  expect(f.host().current()!.writerPlan).toBeUndefined();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const n = f.writes.mock.calls.length;
  act(() => {
    old.onApply();
    old.onReject?.();
  });
  expect(f.host().current()!.writerPlan).toBeUndefined();
  expect(f.writes.mock.calls.length).toBe(n);
  expect(card()).toHaveTextContent("建议变更");
});
it("retires pending proposals on navigation and refuses retained callbacks after returning", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const old = f.cards.at(-1)!,
    nav = screen.getByRole("navigation", { name: "创作阶段" });
  fireEvent.click(within(nav).getByRole("button", { name: /分镜/ }));
  act(() => old.onApply());
  fireEvent.click(within(nav).getByRole("button", { name: /剧本/ }));
  act(() => old.onApply());
  expect(f.host().current()!.writerPlan).toBeUndefined();
  expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
});
it("does not let an applied card consume a different entry after toolbar undo", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.writerPlan).toBeDefined());
  const applied = f.cards.at(-1)!;
  fireEvent.click(screen.getByTitle("撤销 (Ctrl+Z)"));
  await waitFor(() => expect(f.host().current()!.writerPlan).toBeUndefined());
  const n = f.writes.mock.calls.length;
  act(() => applied.onUndo?.());
  expect(f.writes.mock.calls.length).toBe(n);
  expect(screen.queryByText("已应用这次字段修改。")).toBeNull();
});
it("refuses an applied card callback in a different current project", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.writerPlan).toBeDefined());
  const applied = f.cards.at(-1)!;
  const other = {
    ...structuredClone(f.host().current()!),
    id: "film_writer_other001",
    title: "别的作品",
  };
  act(() => f.host().applyLive(other));
  const n = f.writes.mock.calls.length;
  act(() => applied.onUndo?.());
  expect(f.host().current()!.id).toBe(other.id);
  expect(f.writes.mock.calls.length).toBe(n);
});
it.each(["scene-after", "cast-after", "new-dependent-media"])(
  "keeps all current work when own inverse meets %s",
  async (mode) => {
    const f = await open();
    ask();
    await screen.findByRole("button", { name: "确认修改" });
    fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
    await waitFor(() => expect(f.disk.get(f.film.id)!.writerPlan).toBeDefined());
    const live = structuredClone(f.host().current()!);
    if (mode === "scene-after") live.scenes[0]!.text = "后来改写的正文";
    if (mode === "cast-after") live.characters.at(-1)!.identity = "用户新的外貌";
    if (mode === "new-dependent-media")
      live.audioClips.push({
        id: "after-audio",
        shotId: f.film.shots[0]!.id,
        takeId: "",
        lane: "dialogue",
        path: "/new.wav",
        label: "新配音",
        startSeconds: 0,
        durationSeconds: 1,
        offsetSeconds: 0,
        gainDb: 0,
      });
    act(() => f.host().applyLive(live));
    const current = f.host().current(),
      n = f.writes.mock.calls.length;
    fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
    expect(f.host().current()).toBe(current);
    expect(f.writes.mock.calls.length).toBe(n);
  },
);
it("retains exact manual references and lets own inverse run after its own apply changes those referenced facts and removes the referenced shot", async () => {
  const f = await open({ rewriteKnownPerson: true });
  const original = structuredClone(f.host().current()!);
  const referenceScene = original.scenes.find((scene) => scene.id === original.shots[0]!.sceneId)!;
  fireEvent.click(screen.getByRole("button", { name: new RegExp(referenceScene.title) }));
  const name = original.characters[0]!.name,
    asked = `参考 @${name} 和 @镜头1，保留原文重分场。`;
  fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: asked } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByRole("button", { name: "确认修改" });
  expect(f.completeText.mock.calls[0]![0].text).toContain(asked);
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.writerPlan).toBeDefined());
  expect(f.host().current()!.characters[0]!.identity).toBe("新的成年人物外貌");
  expect(f.host().current()!.shots).toEqual([]);
  fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(f.host().current()!.shots).toHaveLength(original.shots.length));
  expect(f.host().current()!.characters).toEqual(original.characters);
  expect(f.completeText).toHaveBeenCalledOnce();
});
it("rejects a pending explicit reference change without writing or making another request", async () => {
  const f = await open(),
    name = f.host().current()!.characters[0]!.name;
  fireEvent.change(screen.getByLabelText("跟助手说"), {
    target: { value: `参考 @${name}，重新分场。` },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByRole("button", { name: "确认修改" });
  const live = structuredClone(f.host().current()!);
  live.characters[0]!.identity = "用户改了引用外貌";
  act(() => f.host().applyLive(live));
  const n = f.writes.mock.calls.length;
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  expect(f.host().current()!.writerPlan).toBeUndefined();
  expect(f.writes.mock.calls.length).toBe(n);
  expect(f.completeText).toHaveBeenCalledOnce();
});
it.each(["edit", "project"])(
  "does not publish a late writer reply after %s changes",
  async (mode) => {
    const f = await open();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.completeText.mockImplementation(async () => {
      await hold;
      return { kind: "OK", text: JSON.stringify(f.raw) };
    });
    ask();
    try {
      await waitFor(() => expect(f.completeText).toHaveBeenCalledOnce());
      const live = structuredClone(f.host().current()!);
      if (mode === "edit") live.scenes[0]!.text = "用户先改了原文";
      else live.id = "film_late_other001";
      act(() => f.host().applyLive(live));
    } finally {
      await act(async () => release());
    }
    expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
    expect(f.host().current()!.writerPlan).toBeUndefined();
    expect(f.completeText).toHaveBeenCalledOnce();
  },
);
it("does not start a hidden cast request after later live inputs change during saving", async () => {
  const f = await open({ holdSave: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  try {
    await waitFor(() =>
      expect(f.writes.mock.calls.some(([value]) => value.writerPlan?.title === "门外")).toBe(true),
    );
    const live = structuredClone(f.host().current()!);
    live.locations = [];
    act(() => f.host().applyLive(live));
  } finally {
    await f.finish();
  }
  expect(f.completeText).toHaveBeenCalledOnce();
});
it("keeps the entire legacy card when its full writer result would need additional cast extraction", async () => {
  const f = await open({ needsCast: true });
  ask();
  await screen.findByRole("button", { name: "放进剧本" });
  expect(screen.queryByRole("list", { name: "字段改动" })).toBeNull();
  expect(f.host().current()!.writerPlan).toBeUndefined();
  expect(f.completeText).toHaveBeenCalledOnce();
});
it("reports failed saving of an inverse after restoring the old first scene identity", async () => {
  const f = await open({ failUndoSave: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.writerPlan).toBeDefined());
  fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
  await screen.findAllByText(/修改没存上/);
  expect(f.host().current()!.writerPlan).toBeUndefined();
  expect(f.disk.get(f.film.id)!.writerPlan).toBeDefined();
});

it("retires the prior pending writer request when its replacement returns no usable proposal", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const old = f.cards.at(-1)!;
  f.completeText.mockResolvedValueOnce({ kind: "OK", text: "这不是可用的结构建议" });
  ask();
  await waitFor(() => expect(f.completeText).toHaveBeenCalledTimes(2));
  await screen.findByText("这次回复用不了，没有改剧本。");
  const n = f.writes.mock.calls.length;
  act(() => old.onApply());
  expect(f.host().current()!.writerPlan).toBeUndefined();
  expect(f.writes.mock.calls.length).toBe(n);
  expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
});

it("keeps the actual board-origin writer request whole-project and undoes it under its own original page receipt", async () => {
  const f = await open({ page: "board" });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  expect(card()).toHaveTextContent("场次顺序");
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.writerPlan).toBeDefined());
  fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(f.host().current()!.writerPlan).toBeUndefined());
  expect(f.host().current()!.shots).toHaveLength(f.film.shots.length);
  expect(f.completeText).toHaveBeenCalledOnce();
  expect(f.createVideo).not.toHaveBeenCalled();
});
