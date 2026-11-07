import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { shotActions } from "../film/shot-actions";
import { sampleFilm, type FilmProject } from "../film/project";
import * as editorModule from "./actions/editor-host";
import * as cardModule from "../next/SuggestionCard";
import { ProWorkspace } from "./ProWorkspace";
const originalHost = editorModule.createEditorHost,
  OriginalCard = cardModule.SuggestionCard;
async function open(options: { holdSave?: boolean; failSave?: boolean; rejected?: boolean } = {}) {
  const film = sampleFilm();
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.scenes = film.scenes.slice(0, 1);
  film.shots = film.shots.slice(0, 2).map((shot, index) => ({
    ...shot,
    no: index + 1,
    sceneId: film.scenes[0]!.id,
    characters: ["动作甲"],
    speaker: "动作甲",
    line: "",
    lines: [],
    action: "原来平静站立",
    actionBeats: ["原来平静站立"],
    source: "agent:director",
    userFields: [],
    takes: [],
    selectedTakeId: "",
  }));
  film.characters = [{ ...film.characters[0]!, name: "动作甲" }];
  if (options.rejected) {
    film.sourceText = "动作甲安静站在门边说停下。";
    film.scenes[0]!.text = film.sourceText;
    film.shots[0]!.picture = "动作甲安静站在门边说话";
    film.shots[0]!.line = "停下";
    film.shots[0]!.lines = [{ speaker: "动作甲", text: "停下" }];
  }
  const disk = new Map([[film.id, structuredClone(film)]]);
  let host!: Parameters<typeof originalHost>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return originalHost(value);
  });
  const cards: cardModule.SuggestionCardProps[] = [];
  vi.spyOn(cardModule, "SuggestionCard").mockImplementation((props) => {
    if (props.fieldRows?.some((row) => row.label === "动作要点")) cards.push(props);
    return OriginalCard(props);
  });
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const writes = vi.fn(async (value: FilmProject) => {
    if (shotActions(value.shots[0]!).some((text) => text.includes("抬起左手"))) {
      if (options.holdSave) await hold;
      if (options.failSave) throw Error("synthetic disk failure");
    }
    disk.set(value.id, structuredClone(value));
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
    text: JSON.stringify({
      shots: [
        {
          shot_id: film.shots[0]!.id,
          nodes: [
            {
              node_id: "node-1",
              at_seconds: 0.5,
              duration_seconds: 0.6,
              actor: "动作甲",
              target: null,
              move: options.rejected ? "挥拳" : "抬起左手",
              body_part: "前臂",
              direction: "向上",
              force: 2,
              force_cue: "适中",
              contact: false,
              reaction: "停顿",
              sfx_cue: "衣料声",
            },
          ],
          prompt_addon: "动作自然",
        },
      ],
      beats: [
        {
          node_id: "node-1",
          shot_id: film.shots[0]!.id,
          text: options.rejected ? "动作甲挥拳" : "动作甲抬起左手",
          at_seconds: 0.5,
          feasibility: "稳",
          workaround: "减慢动作",
        },
      ],
      injuries: [
        {
          name: "动作甲",
          body_part: "前臂",
          side: "左",
          kind: "擦伤",
          from_shot: film.shots[0]!.id,
          visible_as: "轻微红痕",
        },
      ],
      props_after: [{ name: "书", left: null, right: "手中", shot_id: film.shots[0]!.id }],
      safety_notes: ["不要接触面部"],
    }),
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
  fireEvent.change(screen.getByLabelText("正在和："), { target: { value: "action" } });
  return {
    film,
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
const ask = () => fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
const card = () => screen.getByRole("region", { name: "助手的建议" });
beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => vi.restoreAllMocks());
it("shows a complete fixed-baseline action proposal and undoes its own receipt while preserving a newer unrelated edit and late media", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  expect(card()).toHaveTextContent("动作计划");
  expect(card()).toHaveTextContent("声音计划");
  expect(card()).toHaveTextContent("不要接触面部");
  expect(card()).toHaveTextContent("轻微红痕");
  expect(card()).toHaveTextContent("0.5 秒（建议时间）");
  expect(card()).not.toHaveTextContent("node-1");
  expect(card()).toHaveTextContent("原来平静站立");
  expect(card()).toHaveTextContent("抬起左手");
  expect(card()).not.toHaveTextContent(f.film.shots[0]!.id);
  expect(shotActions(f.host().current()!.shots[0]!)).toEqual(["原来平静站立"]);
  const baseline = card().textContent;
  const live = structuredClone(f.host().current()!);
  live.shots[0]!.poster = "/private/late.png";
  act(() => f.host().applyLive(live));
  expect(card().textContent).toBe(baseline);
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await screen.findByText("已应用这次字段修改。");
  await waitFor(() =>
    expect(shotActions(f.disk.get(f.film.id)!.shots[0]!).join("\n")).toContain("抬起左手"),
  );
  const newer = structuredClone(f.host().current()!);
  newer.shots[1]!.picture = "另一镜的新画面";
  newer.title = "用户新标题";
  act(() => f.host().applyLive(newer));
  fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(shotActions(f.host().current()!.shots[0]!)).toEqual(["原来平静站立"]));
  expect(f.host().current()!.shots[1]!.picture).toBe("另一镜的新画面");
  expect(f.host().current()!.title).toBe("用户新标题");
  expect(f.host().current()!.shots[0]!.poster).toBe("/private/late.png");
  expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
  expect(f.completeText).toHaveBeenCalledOnce();
  expect(f.createVideo).not.toHaveBeenCalled();
  expect(f.speak).not.toHaveBeenCalled();
});
it("keeps the reviewed baseline and atomically refuses input conflicts", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const text = card().textContent;
  const live = structuredClone(f.host().current()!);
  live.shots[0]!.action = "用户后来决定";
  act(() => f.host().applyLive(live));
  expect(card().textContent).toBe(text);
  const n = f.writes.mock.calls.length;
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  expect(f.host().current()!.shots[0]!.action).toBe("用户后来决定");
  expect(f.writes.mock.calls.length).toBe(n);
  expect(card()).not.toHaveTextContent("已应用这次字段修改");
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
        f.writes.mock.calls.some(([value]) =>
          shotActions(value.shots[0]!).some((text) => text.includes("抬起左手")),
        ),
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
  expect(shotActions(f.host().current()!.shots[0]!).join("\n")).toContain("抬起左手");
});
it("rejects replay of a dismissed card and a replaced card callback", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const old = f.cards.at(-1)!;
  fireEvent.click(within(card()).getByRole("button", { name: "不要" }));
  act(() => old.onApply());
  expect(shotActions(f.host().current()!.shots[0]!)).toEqual(["原来平静站立"]);
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  act(() => {
    old.onApply();
    old.onReject?.();
  });
  expect(card()).toHaveTextContent("建议变更");
  expect(shotActions(f.host().current()!.shots[0]!)).toEqual(["原来平静站立"]);
});
it("does not claim a saved result when the real persistence rejects", async () => {
  const f = await open({ failSave: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() =>
    expect(shotActions(f.host().current()!.shots[0]!).join("\n")).toContain("抬起左手"),
  );
  await screen.findAllByText(/修改没存上/);
  expect(shotActions(f.disk.get(f.film.id)!.shots[0]!)).toEqual(["原来平静站立"]);
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
  expect(shotActions(f.host().current()!.shots[0]!)).toEqual(["原来平静站立"]);
  expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
  expect(f.createVideo).not.toHaveBeenCalled();
});
it("does not use an applied card callback after the toolbar already undid its exact token", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() =>
    expect(shotActions(f.disk.get(f.film.id)!.shots[0]!).join("\n")).toContain("抬起左手"),
  );
  const applied = f.cards.at(-1)!;
  fireEvent.click(screen.getByTitle("撤销 (Ctrl+Z)"));
  await waitFor(() => expect(shotActions(f.host().current()!.shots[0]!)).toEqual(["原来平静站立"]));
  const n = f.writes.mock.calls.length;
  act(() => applied.onUndo?.());
  expect(shotActions(f.host().current()!.shots[0]!)).toEqual(["原来平静站立"]);
  expect(f.writes.mock.calls.length).toBe(n);
  expect(screen.queryByText("已应用这次字段修改。")).toBeNull();
});
it("does not let the old applied card undo write into a different current project", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() =>
    expect(shotActions(f.disk.get(f.film.id)!.shots[0]!).join("\n")).toContain("抬起左手"),
  );
  const applied = f.cards.at(-1)!;
  const other = {
    ...structuredClone(f.host().current()!),
    id: "film_actionother001",
    title: "另一个作品",
  };
  act(() => f.host().applyLive(other));
  const n = f.writes.mock.calls.length;
  act(() => applied.onUndo?.());
  expect(f.host().current()!.id).toBe(other.id);
  expect(f.host().current()!.title).toBe("另一个作品");
  expect(f.writes.mock.calls.length).toBe(n);
});
it.each(["after", "state", "lock"])(
  "refuses the applied card's later %s conflict with no undo write",
  async (mode) => {
    const f = await open();
    ask();
    await screen.findByRole("button", { name: "确认修改" });
    fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
    await waitFor(() =>
      expect(shotActions(f.disk.get(f.film.id)!.shots[0]!).join("\n")).toContain("抬起左手"),
    );
    const live = structuredClone(f.host().current()!);
    if (mode === "after") live.shots[0]!.actionBeats = ["用户最新动作"];
    else if (mode === "state")
      live.scenes[0]!.actionState = {
        propsAfter: [],
        safetyNotes: ["用户后来安全提示"],
        unassigned: [],
      };
    else live.shots[0]!.userFields.push("action");
    act(() => f.host().applyLive(live));
    const current = f.host().current(),
      n = f.writes.mock.calls.length;
    fireEvent.click(within(card()).getByRole("button", { name: "撤销" }));
    expect(f.host().current()).toBe(current);
    expect(f.writes.mock.calls.length).toBe(n);
    expect(card()).toHaveTextContent("已应用这次字段修改。");
  },
);
it("ignores an old card callback while another role is active", async () => {
  const f = await open();
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const old = f.cards.at(-1)!;
  fireEvent.change(screen.getByLabelText("正在和："), { target: { value: "performance" } });
  const n = f.writes.mock.calls.length;
  act(() => old.onApply());
  expect(shotActions(f.host().current()!.shots[0]!)).toEqual(["原来平静站立"]);
  expect(f.writes.mock.calls.length).toBe(n);
});
it("shows rejected current-shot actions in the real scene state and unassigned diff before saving them as pending, not as performed actions", async () => {
  const f = await open({ rejected: true });
  ask();
  await screen.findByRole("button", { name: "确认修改" });
  const fields = screen.getByRole("list", { name: "字段改动" });
  expect(fields).toHaveTextContent("场内动作状态");
  expect(fields).toHaveTextContent("本场待对应动作");
  expect(fields).toHaveTextContent("挥拳");
  expect(f.host().current()!.scenes[0]!.actionState).toBeUndefined();
  fireEvent.click(within(card()).getByRole("button", { name: "确认修改" }));
  await waitFor(() =>
    expect(f.disk.get(f.film.id)!.unassignedBeats?.some((row) => row.text.includes("挥拳"))).toBe(
      true,
    ),
  );
  expect(f.host().current()!.shots[0]!.action).toBe("原来平静站立");
  expect(
    f
      .host()
      .current()!
      .scenes[0]!.actionState!.unassigned.some((row) =>
        row.plan.nodes.some((node) => node.move === "挥拳"),
      ),
  ).toBe(true);
  expect(f.createVideo).not.toHaveBeenCalled();
  expect(f.speak).not.toHaveBeenCalled();
});
