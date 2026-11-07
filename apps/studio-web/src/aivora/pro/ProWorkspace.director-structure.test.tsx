import * as retryModule from "./actions/director-retry";
import { directorFieldFixture } from "./actions/director-field-fixture";
import * as directorModule from "./actions/director-draft";
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
    holdSave?: boolean;
    failSave?: boolean;
    needsCast?: boolean;
    replaceFirst?: boolean;
    failUndoSave?: boolean;
  } = {},
) {
  const { base: film, incoming, tx } = directorFieldFixture();
  if (options.needsCast) film.locations = [];
  if (options.replaceFirst) incoming[0]!.id = "new-first-director-shot";
  const planner = vi.spyOn(directorModule, "planDirectorDraft").mockImplementation(async () => ({
    status: "complete",
    shots: structuredClone(incoming),
    notice: "镜头建议已准备好",
    coverage: null,
    target: 16,
    event: "shots",
  }));
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  const disk = new Map([[film.id, structuredClone(film)]]);
  let host!: Parameters<typeof originalHost>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return originalHost(value);
  });
  const cards: cardModule.SuggestionCardProps[] = [];
  vi.spyOn(cardModule, "SuggestionCard").mockImplementation((props) => {
    if (props.fieldRows?.some((row) => row.label.includes("镜头顺序"))) cards.push(props);
    return OriginalCard(props);
  });
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let appliedWritten = false;
  const writes = vi.fn(async (value: FilmProject) => {
    if (
      options.failUndoSave &&
      appliedWritten &&
      value.shots[0]?.picture === film.shots[0]!.picture
    )
      throw Error("synthetic undo save failure");
    if (value.shots[0]?.picture === "新画面") {
      if (options.holdSave) await hold;
      if (options.failSave) throw Error("synthetic disk failure");
    }
    disk.set(value.id, structuredClone(value));
    if (value.shots[0]?.picture === "新画面") appliedWritten = true;
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
  const completeText = vi.fn(async () => ({
    kind: "OK",
    text: "{}",
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
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /分镜/,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.change(screen.getByLabelText("正在和："), { target: { value: "director" } });
  return {
    film,
    tx,
    incoming,
    planner,
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
const ask = () => fireEvent.click(screen.getByRole("button", { name: "节奏再快些" }));
const card = () => screen.getByRole("region", { name: "助手的建议" });
beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => vi.restoreAllMocks());

it("reviews the entire current-scene structural transaction and undoes only its receipt while retaining other edits and late media", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  expect(card()).toHaveTextContent("镜头顺序");
  expect(card()).toHaveTextContent("原文文本覆盖");
  expect(card()).toHaveTextContent("镜头预算");
  expect(f.host().current()!.shots[0]!.picture).toBe(f.film.shots[0]!.picture);
  const baseline = card().textContent;
  const live = structuredClone(f.host().current()!);
  live.shots[2]!.poster = "/private/late.png";
  act(() => f.host().applyLive(live));
  expect(card().textContent).toBe(baseline);
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.shots[0]!.picture).toBe("新画面"));
  await screen.findByText("已应用这次字段修改。");
  expect(within(card()).getByRole("button", { name: "撤销" })).toBeEnabled();
  const next = structuredClone(f.host().current()!);
  next.title = "新标题";
  next.shots[2]!.picture = "另一场新画面";
  act(() => f.host().applyLive(next));
  fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(f.host().current()!.shots[0]!.picture).toBe(f.film.shots[0]!.picture));
  expect(f.host().current()!.title).toBe("新标题");
  expect(f.host().current()!.shots[2]!.picture).toBe("另一场新画面");
  expect(f.host().current()!.shots[2]!.poster).toBe("/private/late.png");
  expect(f.createVideo).not.toHaveBeenCalled();
  expect(f.speak).not.toHaveBeenCalled();
  expect(f.completeText).not.toHaveBeenCalled();
});
it.each(["source", "media", "cast"])(
  "rejects %s changes before structural write or a hidden cast request",
  async (mode) => {
    const f = await open();
    ask();
    await screen.findByRole("button", { name: "确认修改" });
    const live = structuredClone(f.host().current()!);
    if (mode === "source") live.scenes[0]!.text = "新原文";
    if (mode === "media") live.shots[0]!.poster = "/private/late.png";
    if (mode === "cast") live.locations = [];
    act(() => f.host().applyLive(live));
    const current = f.host().current(),
      n = f.writes.mock.calls.length;
    fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
    expect(f.host().current()).toBe(current);
    expect(f.writes.mock.calls.length).toBe(n);
    expect(f.completeText).not.toHaveBeenCalled();
    expect(card()).not.toHaveTextContent("已应用这次字段修改。");
  },
);
it("keeps the original legacy card when confirming would additionally trigger unreviewed cast extraction", async () => {
  const f = await open({ needsCast: true });
  ask();
  await screen.findByRole("button", { name: "放进分镜" });
  expect(screen.queryByRole("list", { name: "字段改动" })).toBeNull();
  expect(f.host().current()!.shots[0]!.picture).toBe(f.film.shots[0]!.picture);
});
it("guards reject and duplicate callbacks during deferred saving, then keeps the same applied card", async () => {
  const f = await open({ holdSave: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const pending = f.cards.at(-1)!;
  try {
    fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
    await waitFor(() =>
      expect(
        f.writes.mock.calls.some(([value]) => value.shots[0]!.picture?.includes("新画面")),
      ).toBe(true),
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
  expect(f.host().current()!.shots[0]!.picture).toContain("新画面");
});
it("rejects replay of a dismissed card and a replaced card callback", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const old = f.cards.at(-1)!;
  fireEvent.click(within(card()).getByRole("button", { name: "不要" }));
  act(() => old.onApply());
  expect(f.host().current()!.shots[0]!.picture).toBe(f.film.shots[0]!.picture);
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  act(() => {
    old.onApply();
    old.onReject?.();
  });
  expect(card()).toHaveTextContent("建议变更");
  expect(f.host().current()!.shots[0]!.picture).toBe(f.film.shots[0]!.picture);
});
it("does not claim a saved result when the real persistence rejects", async () => {
  const f = await open({ failSave: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.host().current()!.shots[0]!.picture).toContain("新画面"));
  await screen.findAllByText(/修改没存上/);
  expect(f.disk.get(f.film.id)!.shots[0]!.picture).toBe(f.film.shots[0]!.picture);
  expect(card()).toHaveTextContent("已应用这次字段修改。");
  expect(f.createVideo).not.toHaveBeenCalled();
});
it("retires a pending request on navigation and cannot replay it after returning to the same scope", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const old = f.cards.at(-1)!;
  const navigation = screen.getByRole("navigation", { name: "创作阶段" });
  fireEvent.click(within(navigation).getByRole("button", { name: /剧本/ }));
  act(() => {
    old.onApply();
    old.onReject?.();
  });
  fireEvent.click(within(navigation).getByRole("button", { name: /分镜/ }));
  act(() => old.onApply());
  expect(f.host().current()!.shots[0]!.picture).toBe(f.film.shots[0]!.picture);
  expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
  expect(f.createVideo).not.toHaveBeenCalled();
});
it("does not use an applied card callback after the toolbar already undid its exact token", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.shots[0]!.picture).toContain("新画面"));
  const applied = f.cards.at(-1)!;
  fireEvent.click(screen.getByTitle("撤销 (Ctrl+Z)"));
  await waitFor(() => expect(f.host().current()!.shots[0]!.picture).toBe(f.film.shots[0]!.picture));
  const n = f.writes.mock.calls.length;
  act(() => applied.onUndo?.());
  expect(f.host().current()!.shots[0]!.picture).toBe(f.film.shots[0]!.picture);
  expect(f.writes.mock.calls.length).toBe(n);
  expect(screen.queryByText("已应用这次字段修改。")).toBeNull();
});
it("does not let the old applied card undo write into a different current project", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.shots[0]!.picture).toContain("新画面"));
  const applied = f.cards.at(-1)!;
  const other = {
    ...structuredClone(f.host().current()!),
    id: "film_directorother001",
    title: "另一个作品",
  };
  act(() => f.host().applyLive(other));
  const n = f.writes.mock.calls.length;
  act(() => applied.onUndo?.());
  expect(f.host().current()!.id).toBe(other.id);
  expect(f.host().current()!.title).toBe("另一个作品");
  expect(f.writes.mock.calls.length).toBe(n);
});

it("keeps its own applied card after replacing the originally selected first shot, then inverses the original story receipt", async () => {
  const f = await open({ replaceFirst: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.shots[0]!.id).toBe("new-first-director-shot"));
  fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(f.host().current()!.shots[0]!.id).toBe(f.film.shots[0]!.id));
  expect(f.createVideo).not.toHaveBeenCalled();
});
it("never launches a hidden cast request when new live inputs arrive during saving", async () => {
  const f = await open({ holdSave: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  try {
    await waitFor(() =>
      expect(f.writes.mock.calls.some(([value]) => value.shots[0]?.picture === "新画面")).toBe(
        true,
      ),
    );
    const live = structuredClone(f.host().current()!);
    live.locations = [];
    act(() => f.host().applyLive(live));
  } finally {
    await f.finish();
  }
  expect(f.completeText).not.toHaveBeenCalled();
  expect(f.host().current()!.locations).toEqual([]);
});
it.each(["after", "lock", "media", "budget"])(
  "atomically refuses later %s conflicts on its own receipt",
  async (mode) => {
    const f = await open();
    ask();
    await screen.findByRole("button", { name: "确认修改" });
    fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
    await waitFor(() => expect(f.disk.get(f.film.id)!.shots[0]!.picture).toBe("新画面"));
    const live = structuredClone(f.host().current()!);
    if (mode === "after") live.shots[0]!.picture = "用户后来改过";
    if (mode === "lock") live.shots[0]!.userFields.push("picture");
    if (mode === "media") live.shots[0]!.poster = "/late-target.png";
    if (mode === "budget") delete live.scenes[0]!.shotBudget;
    act(() => f.host().applyLive(live));
    const current = f.host().current(),
      n = f.writes.mock.calls.length;
    fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
    expect(f.host().current()).toBe(current);
    expect(f.writes.mock.calls.length).toBe(n);
  },
);

it("uses the same complete reviewed structure for the explicit director retry path", async () => {
  const f = await open();
  f.planner.mockResolvedValueOnce({
    status: "complete",
    shots: null,
    notice: "本次没有修改分镜。",
    coverage: null,
    target: 16,
    retry: { role: "director", context: "受控重试上下文", instruction: "受控重试指令" },
  });
  const retry = vi
    .spyOn(retryModule, "retryDirectorDraft")
    .mockResolvedValue({ kind: "ready", shots: structuredClone(f.incoming), partial: false });
  ask();
  fireEvent.click(await screen.findByRole("button", { name: "换个问法再问一次" }));
  await screen.findByRole("button", { name: "确认修改" });
  expect(card()).toHaveTextContent("镜头顺序");
  expect(f.host().current()!.shots[0]!.picture).toBe(f.film.shots[0]!.picture);
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.shots[0]!.picture).toBe("新画面"));
  expect(retry).toHaveBeenCalledOnce();
  expect(f.completeText).not.toHaveBeenCalled();
});

it("reports an unsaved own inverse even when that inverse restores a different first-shot identity", async () => {
  const f = await open({ replaceFirst: true, failUndoSave: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() => expect(f.disk.get(f.film.id)!.shots[0]!.id).toBe("new-first-director-shot"));
  fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
  await screen.findAllByText(/修改没存上/);
  expect(f.host().current()!.shots[0]!.id).toBe(f.film.shots[0]!.id);
  expect(f.disk.get(f.film.id)!.shots[0]!.id).toBe("new-first-director-shot");
});
