import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import * as editor from "./actions/editor-host";
import * as cardModule from "../next/SuggestionCard";
import { ProWorkspace } from "./ProWorkspace";
import { deferred } from "./shot-audio-suggestions.test-fixture";
const createHost = editor.createEditorHost,
  OriginalCard = cardModule.SuggestionCard;
const requests = new Set<Promise<unknown>>(),
  finishers: (() => void)[] = [];
function track<T>(promise: Promise<T>) {
  requests.add(promise);
  void promise.then(
    () => requests.delete(promise),
    () => requests.delete(promise),
  );
  return promise;
}
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(async () => {
  cleanup();
  for (const finish of finishers.splice(0)) finish();
  while (requests.size) await Promise.allSettled([...requests]);
  vi.restoreAllMocks();
});
async function open(
  options: { role?: string; hold?: boolean; duplicate?: boolean; directorReady?: boolean } = {},
) {
  const film = sampleFilm();
  if (options.directorReady) {
    film.scenes[0]!.text = "参考甲推开门，挥拳。";
    film.scenes[0]!.tags = ["打斗"];
  }
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.characters = [
    { ...film.characters[0]!, id: "reference-person-1", name: "参考甲", identity: "蓝色外套" },
    {
      ...film.characters[1]!,
      id: "reference-person-2",
      name: options.duplicate ? "参考甲" : "参考乙",
      identity: "白色衬衣",
    },
  ];
  film.locations = [
    {
      id: "reference-place",
      name: "旧书店",
      prompt: "木架",
      ambience: "安静",
      layout: "门在左侧",
      referenceImage: "/private/place.png",
    },
  ];
  Object.assign(film.characters[0]!, { privateData: "PRIVATE_CHARACTER_BINDING" });
  film.shots = film.shots.slice(0, 2).map((shot, i) => ({
    ...shot,
    no: i + 1,
    sceneId: film.scenes[0]!.id,
    characters: ["参考甲"],
    speaker: "参考甲",
    line: "",
    lines: [],
    source: "agent:director",
    userFields: [],
    performance: "原表演",
    action: "原动作",
    actionBeats: ["原动作"],
    takes: [],
    selectedTakeId: "",
  }));
  const other = {
    ...structuredClone(film),
    id: "film_reference_other01",
    episodeNo: 2,
    episodeTitle: "引用另一集",
  };
  const disk = new Map([
    [film.id, structuredClone(film)],
    [other.id, structuredClone(other)],
  ]);
  let host!: Parameters<typeof createHost>[0];
  vi.spyOn(editor, "createEditorHost").mockImplementation((value) => {
    host = value;
    return createHost(value);
  });
  const cards: cardModule.SuggestionCardProps[] = [];
  vi.spyOn(cardModule, "SuggestionCard").mockImplementation((props) => {
    cards.push(props);
    return OriginalCard(props);
  });
  const write = vi.fn(async (value: FilmProject) => {
    disk.set(value.id, structuredClone(value));
    return structuredClone(value);
  });
  const media = vi.fn();
  window.aijian = {
    listFilmSeries: async () => [],
    readFilmProject: async (id: string) => structuredClone(disk.get(id) ?? null),
    writeFilmProject: write,
    prepareFilmProject: async (value: FilmProject) => structuredClone(value),
    createStoryFilm: media,
  } as unknown as Window["aijian"];
  const reply = (agent: string) => ({
    kind: "OK",
    text: JSON.stringify(
      agent === "director" && options.directorReady
        ? { shots: [{ picture: film.scenes[0]!.text, characters: ["参考甲"], seconds: 3 }] }
        : agent === "art"
          ? {
              prompt_block_zh: "新的克制画风",
              identities: [
                { name: "参考甲", identity: "新的蓝外套固定外貌", char_id: film.characters[0]!.id },
              ],
            }
          : agent === "prompter"
            ? {
                keyframe: { prompt_zh: "参考甲站在窗边", prompt_en: "A person stands by a window" },
              }
            : agent === "performance"
              ? {
                  shots: [
                    {
                      shot_id: film.shots[0]!.id,
                      who: "参考甲",
                      emotion: "紧张",
                      face: ["眼神一沉"],
                      eyes: "看向门口",
                      hands: "收紧",
                      breath: "平稳",
                      hold_s: 1,
                      voice: { tone: "低声", pace: "慢", pauses: "短停", emotion: "克制" },
                    },
                  ],
                }
              : {},
    ),
  });
  const hold = deferred<void>();
  finishers.push(() => hold.resolve());
  const completeText = vi.fn((input: { agent: string; text: string }) =>
    track(
      (async () => {
        if (options.hold) await hold.promise;
        return reply(input.agent);
      })(),
    ),
  );
  const connectedStatus = {
    provider: "GROK_LOGIN",
    runtime: "DESKTOP",
    state: "CONNECTED",
    secureStorage: "AVAILABLE",
    accountLabel: "synthetic",
    lastError: null,
  } as const;
  const status = vi.fn(async () => connectedStatus);
  window.aijianGrok = {
    status,
    models: async () => ({ kind: "OK", models: [{ id: "grok-4.7", label: "text" }] }),
    completeText,
  } as unknown as Window["aijianGrok"];
  localStorage.setItem("aivora.film.activeId", film.id);
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
  if (options.role)
    fireEvent.change(screen.getByLabelText("正在和："), { target: { value: options.role } });
  return {
    film,
    other,
    disk,
    write,
    media,
    completeText,
    status,
    connectedStatus,
    cards,
    host: () => host,
    finish: async () => {
      await act(async () => hold.resolve());
    },
    adopt: (value: FilmProject) => act(() => host.applyLive(value)),
  };
}
const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value } });
const send = () => fireEvent.click(screen.getByRole("button", { name: "发送" }));
it.each(["action", "performance", "art", "writer", "director"])(
  "passes captured user request and real %s scope with references through the actual manual provider",
  async (role) => {
    const f = await open({ role });
    const asked = "请参考 @参考甲 和 @镜头2，动作更克制。";
    type(asked);
    send();
    await waitFor(() => expect(f.completeText).toHaveBeenCalled());
    const text = f.completeText.mock.calls[0]![0].text;
    expect(text).toContain(asked);
    expect(text).toContain('"name":"参考甲"');
    expect(text).toContain(
      `"taskScope":"${role === "writer" || role === "art" ? "project" : role === "director" ? "scene" : "shot"}"`,
    );
    expect(text).not.toMatch(/PRIVATE_CHARACTER_BINDING|private\/place/);
    expect(f.host().selection().shotId).toBe(f.film.shots[0]!.id);
    expect(f.media).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  "refuses unknown or ambiguous references before dispatch and preserves the entire draft (duplicate=%s)",
  async (duplicate) => {
    const f = await open({ role: "art", duplicate });
    const asked = duplicate ? "修改 @参考甲 的外貌" : "修改 @不存在 的外貌";
    type(asked);
    send();
    expect(screen.getByLabelText("跟助手说")).toHaveValue(asked);
    expect(f.completeText).not.toHaveBeenCalled();
    expect(f.media).not.toHaveBeenCalled();
  },
);
it("keeps the next draft during a pending manual request and never mixes it into the captured request", async () => {
  const f = await open({ role: "performance", hold: true });
  const first = "参考 @镜头1，表演更克制";
  type(first);
  send();
  await waitFor(() => expect(f.completeText).toHaveBeenCalledOnce());
  type("下一条尚未发送的新稿");
  await f.finish();
  await screen.findByRole("region", { name: "助手的建议" });
  expect(screen.getByLabelText("跟助手说")).toHaveValue("下一条尚未发送的新稿");
  expect(f.completeText.mock.calls[0]![0].text).toContain(first);
  expect(f.completeText.mock.calls[0]![0].text).not.toContain("下一条尚未发送的新稿");
});
it("keeps applied reference-bearing performance cards and their own undo usable after the apply changes the referenced shot", async () => {
  const f = await open({ role: "performance" });
  const original = f.host().current()!.shots[0]!.performance;
  type("参考 @镜头1，表演更克制");
  send();
  const card = await screen.findByRole("region", { name: "助手的建议" });
  fireEvent.click(within(card).getByRole("button", { name: "确认修改" }));
  await within(card).findByRole("button", { name: "撤销" });
  expect(f.host().current()!.shots[0]!.performance).not.toBe(original);
  f.adopt({ ...f.host().current()!, title: "稍后改的标题" });
  fireEvent.click(within(card).getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(f.host().current()!.shots[0]!.performance).toBe(original));
  expect(f.host().current()!.title).toBe("稍后改的标题");
});
it("uses the real existing place menu item and discards a late reply when that place was renamed", async () => {
  const f = await open({ role: "art", hold: true });
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /角色/,
    }),
  );
  expect(f.host().selection().page).toBe("cast");
  fireEvent.click(screen.getByRole("button", { name: "提到人物、场景或镜头" }));
  fireEvent.click(
    within(screen.getByRole("menu", { name: "提到谁" })).getByRole("menuitem", { name: "@旧书店" }),
  );
  expect(screen.getByLabelText("跟助手说")).toHaveValue("@旧书店 ");
  send();
  await waitFor(() => expect(f.completeText).toHaveBeenCalledOnce());
  expect(f.completeText.mock.calls[0]![0].text).toContain('"layout":"门在左侧"');
  f.adopt({
    ...f.host().current()!,
    locations: f
      .host()
      .current()!
      .locations.map((place) => ({ ...place, name: "改名后书店" })),
  });
  await f.finish();
  expect(screen.queryByRole("region", { name: "助手的建议" })).toBeNull();
  expect(f.host().current()!.locations[0]!.name).toBe("改名后书店");
});

function advanced() {
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  const summary = [...document.querySelectorAll<HTMLElement>(".pgroup > summary")].find(
    (item) => item.textContent === "高级",
  )!;
  if (!(summary.parentElement as HTMLDetailsElement).open) fireEvent.click(summary);
}
it.each([
  ["prompter", "写英文画面说明"],
  ["qc", "审一下这一镜的文字"],
])("passes the captured typed request through the real advanced %s entry", async (agent, label) => {
  const f = await open();
  const asked = "参考 @参考甲 和 @镜头2，画面里不要出现雨伞。";
  type(asked);
  advanced();
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(f.completeText).toHaveBeenCalledOnce());
  const sent = f.completeText.mock.calls[0]![0];
  expect(sent.agent).toBe(agent);
  expect(sent.text).toContain(asked);
  expect(sent.text).toContain('"taskScope":"shot"');
  expect(sent.text).toContain('"no":2');
  if (agent === "prompter") {
    const scope = await screen.findByLabelText("画面说明的参考与修改范围");
    expect(scope).toHaveTextContent("参考甲、镜头 2");
    expect(scope).toHaveTextContent("修改范围：当前镜头");
  }
  expect(f.host().current()!.shots[0]!.promptEn).toBe(f.film.shots[0]!.promptEn);
  expect(f.host().selection().shotId).toBe(f.film.shots[0]!.id);
  expect(f.media).not.toHaveBeenCalled();
});
it("rechecks resolved references after membership admission and before provider dispatch", async () => {
  const f = await open({ role: "performance" });
  const admitted = deferred<void>(),
    gate = deferred<void>();
  finishers.push(() => gate.resolve());
  f.status.mockImplementationOnce(async () => {
    admitted.resolve();
    await gate.promise;
    return f.connectedStatus;
  });
  type("参考 @参考甲，表演更克制。");
  send();
  await admitted.promise;
  f.adopt({ ...f.host().current()!, characters: [] });
  await act(async () => gate.resolve());
  await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
  expect(f.completeText).not.toHaveBeenCalled();
  expect(f.media).not.toHaveBeenCalled();
  expect(f.host().current()!.characters).toEqual([]);
});
it.each(["rename", "delete", "project", "page-return"])(
  "discards a pending reference-bearing reply after %s without replacing a later draft",
  async (change) => {
    const f = await open({ role: "performance", hold: true });
    type("参考 @参考甲 和 @镜头1，表演更克制。");
    send();
    await waitFor(() => expect(f.completeText).toHaveBeenCalledOnce());
    type("用户稍后输入的新稿");
    if (change === "rename")
      f.adopt({
        ...f.host().current()!,
        characters: f
          .host()
          .current()!
          .characters.map((p) => ({ ...p, name: "改名后的角色" })),
      });
    if (change === "delete") f.adopt({ ...f.host().current()!, characters: [] });
    if (change === "project") f.adopt(f.other);
    if (change === "page-return") {
      const nav = screen.getByRole("navigation", { name: "创作阶段" });
      fireEvent.click(within(nav).getByRole("button", { name: /剧本/ }));
      fireEvent.click(within(nav).getByRole("button", { name: /分镜/ }));
    }
    const beforeReply = structuredClone(f.host().current());
    await f.finish();
    expect(f.host().current()).toEqual(beforeReply);
    expect(f.cards.filter((card) => card.proposed.length || card.fieldRows?.length)).toHaveLength(
      0,
    );
    if (change === "rename" || change === "delete")
      expect(screen.getByLabelText("跟助手说")).toHaveValue("用户稍后输入的新稿");
    expect(f.completeText).toHaveBeenCalledOnce();
    expect(f.media).not.toHaveBeenCalled();
  },
);
it("rejects the old confirmation callback after a referenced entity changes, preserving new edits and media", async () => {
  const f = await open({ role: "performance" });
  type("参考 @参考甲 和 @镜头1，表演更克制。");
  send();
  await screen.findByRole("region", { name: "助手的建议" });
  const callback = f.cards.find((card) => card.fieldRows?.length && !card.applied)!.onApply;
  const live = f.host().current()!;
  f.adopt({
    ...live,
    title: "新标题",
    characters: live.characters.map((p) => ({ ...p, identity: "后来调整的外貌" })),
  });
  const before = structuredClone(f.host().current());
  await act(async () => callback());
  expect(f.host().current()).toEqual(before);
  expect(f.media).not.toHaveBeenCalled();
});

it.each(["分镜", "剧本", "角色"])(
  "keeps the new whole-project art review visible on %s and its own undo usable after changing the referenced person",
  async (page) => {
    const f = await open({ role: "art" });
    if (page !== "分镜") {
      const nav = screen.getByRole("navigation", { name: "创作阶段" });
      fireEvent.click(within(nav).getByRole("button", { name: new RegExp(page) }));
      fireEvent.change(screen.getByLabelText("正在和："), { target: { value: "art" } });
    }
    const original = f.host().current()!.characters[0]!.identity;
    type("参考 @参考甲，调整全作品画风和外貌。");
    send();
    const card = await screen.findByRole("region", { name: "助手的建议" });
    expect(card).toHaveTextContent("全项目");
    expect(f.host().current()!.characters[0]!.identity).toBe(original);
    fireEvent.click(within(card).getByRole("button", { name: "确认修改" }));
    await within(card).findByRole("button", { name: "撤销" });
    expect(f.host().current()!.characters[0]!.identity).toBe("新的蓝外套固定外貌");
    await waitFor(() =>
      expect(f.disk.get(f.film.id)!.characters[0]!.identity).toBe("新的蓝外套固定外貌"),
    );
    const latest = f.host().current()!;
    f.adopt({
      ...latest,
      title: "应用后的新标题",
      shots: latest.shots.map((s, i) =>
        i === 0 ? { ...s, poster: "/synthetic/late-frame.png" } : s,
      ),
    });
    fireEvent.click(within(card).getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(f.host().current()!.characters[0]!.identity).toBe(original));
    expect(f.host().current()!.title).toBe("应用后的新标题");
    expect(f.host().current()!.shots[0]!.poster).toBe("/synthetic/late-frame.png");
    expect(f.media).not.toHaveBeenCalled();
  },
);
it.each(["entity", "navigation"])(
  "guards the new independent art-review confirmation after %s changes without writing old content",
  async (change) => {
    const f = await open({ role: "art" });
    type("参考 @参考甲，调整全作品画风和外貌。");
    send();
    await screen.findByRole("region", { name: "助手的建议" });
    const captured = f.cards.find(
      (card) => card.fieldRows?.some((row) => row.label === "全项目 · 画风说明") && !card.applied,
    )!;
    if (change === "entity") {
      const live = f.host().current()!;
      f.adopt({
        ...live,
        characters: live.characters.filter((p) => p.id !== f.film.characters[0]!.id),
      });
    } else {
      const nav = screen.getByRole("navigation", { name: "创作阶段" });
      fireEvent.click(within(nav).getByRole("button", { name: /剧本/ }));
      fireEvent.click(within(nav).getByRole("button", { name: /分镜/ }));
    }
    const before = structuredClone(f.host().current());
    const count = f.write.mock.calls.length;
    await act(async () => captured.onApply());
    expect(f.host().current()).toEqual(before);
    expect(f.write).toHaveBeenCalledTimes(count);
    expect(f.media).not.toHaveBeenCalled();
  },
);

it("inherits the captured director references and scene-wide task scope in the real performance and action supplements", async () => {
  const f = await open({ role: "director", directorReady: true });
  const before = structuredClone(f.host().current()!.shots);
  const asked = "参考 @参考甲 和 @镜头2，保持原文，不增加剧情。";
  type(asked);
  send();
  await screen.findByRole("region", { name: "助手的建议" });
  const roles = f.completeText.mock.calls.map(([input]) => input.agent);
  expect(roles).toContain("director");
  expect(roles).toContain("performance");
  expect(roles).toContain("action");
  for (const [input] of f.completeText.mock.calls) {
    expect(input.text).toContain(asked);
    expect(input.text).toContain('"taskScope":"scene"');
    expect(input.text).toContain('"name":"参考甲"');
    expect(input.text).not.toContain("PRIVATE_CHARACTER_BINDING");
  }
  expect(f.host().current()!.shots).toEqual(before);
  expect(f.media).not.toHaveBeenCalled();
});
