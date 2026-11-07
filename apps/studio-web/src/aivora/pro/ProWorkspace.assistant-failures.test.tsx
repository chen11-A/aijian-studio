import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import type { UiNotice } from "../film/contracts3j";
import { NOTICE_TEXT } from "../film/notices";
import * as editor from "./actions/editor-host";
import { ProWorkspace } from "./ProWorkspace";
const createHost = editor.createEditorHost;
const metadata = (film: FilmProject) => ({
  style: film.styleZh,
  characters: film.characters,
  locations: film.locations,
  props: film.props,
  shots: film.shots,
});
const modes = [
  "echo",
  "invalid",
  "empty",
  "denied",
  "model-unavailable",
  "throw",
  "absent-bridge",
  "signed-out",
  "missing-method",
  "account-denied",
  "expired-login",
] as const;
type Mode = (typeof modes)[number];
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function open(role: "art" | "prompter", mode: Mode) {
  const film = sampleFilm();
  film.scenes = [film.scenes[0]!];
  film.shots = film.shots.map((shot) => ({ ...shot, sceneId: film.scenes[0]!.id }));
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.directory = "/synthetic/assistant";
  let current!: Parameters<typeof createHost>[0];
  vi.spyOn(editor, "createEditorHost").mockImplementation((host) => {
    current = host;
    return createHost(host);
  });
  let stored = structuredClone(film);
  const write = vi.fn(async (value: FilmProject) => {
      stored = structuredClone(value);
      return structuredClone(stored);
    }),
    video = vi.fn();
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    readFilmProject: vi.fn(async () => structuredClone(stored)),
    writeFilmProject: write,
    prepareFilmProject: vi.fn(async (value: FilmProject) => structuredClone(value)),
    createStoryFilm: video,
  } as unknown as Window["aijian"];
  const completeText = vi.fn(async (input: { text: string }) => {
    if (mode === "throw") throw Error("PRIVATE_EXCEPTION /private/token/path AUTH_SECRET");
    if (mode === "denied")
      return {
        kind: "ERROR",
        code: "ENTITLEMENT_DENIED",
        detail: "当前会员暂时没有文字生成功能。",
      };
    if (mode === "model-unavailable")
      return { kind: "ERROR", code: "MODEL_UNAVAILABLE", detail: "这个文字模型暂时不可用。" };
    return {
      kind: "OK",
      text: mode === "echo" ? input.text : mode === "empty" ? "" : "not usable JSON",
    };
  });
  if (mode !== "absent-bridge")
    window.aijianGrok = {
      status: vi.fn(async () => ({
        provider: "GROK_LOGIN",
        runtime: "DESKTOP",
        state:
          mode === "signed-out"
            ? "NOT_CONNECTED"
            : mode === "account-denied"
              ? "ENTITLEMENT_DENIED"
              : mode === "expired-login"
                ? "REAUTH_REQUIRED"
                : "CONNECTED",
        secureStorage: "AVAILABLE",
        accountLabel: null,
        lastError: null,
      })),
      models: vi.fn(async () => ({ kind: "OK", models: [{ id: "grok-4.7", label: "text" }] })),
      completeText: mode === "missing-method" ? undefined : completeText,
    } as unknown as Window["aijianGrok"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      ["absent-bridge", "signed-out"].includes(mode)
        ? "未登录"
        : mode === "account-denied"
          ? "这个会员用不了生成"
          : mode === "expired-login"
            ? "需要重新登录"
            : "Grok 会员 · 已连接",
    ),
  );
  const nav = within(screen.getByRole("navigation", { name: "创作阶段" }));
  fireEvent.click(nav.getByRole("button", { name: role === "art" ? /角色与场景/ : /分镜/ }));
  if (role === "prompter") {
    fireEvent.click(screen.getByRole("button", { name: "属性" }));
    const summary = [...document.querySelectorAll<HTMLElement>(".pgroup > summary")].find(
      (e) => e.textContent === "高级",
    )!;
    if (!(summary.parentElement as HTMLDetailsElement).open) fireEvent.click(summary);
  }
  return {
    current: () => current.current()!,
    write,
    video,
    completeText,
    run: () =>
      fireEvent.click(
        screen.getByRole("button", { name: role === "art" ? "请美术定画风" : "写英文画面说明" }),
      ),
  };
}
it.each(
  (["art", "prompter"] as const).flatMap((role) => modes.map((mode) => [role, mode] as const)),
)("keeps %s failure identity and no changes through actual controls (%s)", async (role, mode) => {
  const notices: UiNotice[] = [];
  const collect = (event: Event) => notices.push((event as CustomEvent<UiNotice>).detail);
  window.addEventListener("aivora-notice", collect);
  try {
    const f = await open(role, mode),
      before = structuredClone(metadata(f.current()));
    f.run();
    const code = ["denied", "account-denied"].includes(mode)
      ? "ENTITLEMENT_DENIED"
      : mode === "model-unavailable"
        ? "MODEL_UNAVAILABLE"
        : ["absent-bridge", "missing-method"].includes(mode)
          ? "DESKTOP_REQUIRED"
          : mode === "expired-login"
            ? "REAUTH_REQUIRED"
            : mode === "signed-out"
              ? "GROK_MEMBERSHIP_REQUIRED"
              : role === "art"
                ? "PLANART_FAILED"
                : "PLANPROMPTER_FAILED";
    await waitFor(() => expect(notices.some((n) => n.code === code)).toBe(true));
    const response = notices.filter((n) => n.code === code).at(-1)!;
    await waitFor(() =>
      expect(document.querySelector(".status-note")).toHaveTextContent(NOTICE_TEXT[code]),
    );
    if (mode !== "throw")
      expect(response.detail).toContain(
        role === "art" ? "本次没有修改作品。" : "本次没有修改画面说明。",
      );
    if (mode === "denied")
      expect(document.body.textContent).toContain("当前会员暂时没有文字生成功能。");
    if (mode === "model-unavailable")
      expect(document.body.textContent).toContain("这个文字模型暂时不可用。");
    expect(metadata(f.current())).toEqual(before);
    expect(f.video).not.toHaveBeenCalled();
    expect(f.completeText).toHaveBeenCalledTimes(
      ["absent-bridge", "signed-out", "missing-method", "account-denied", "expired-login"].includes(
        mode,
      )
        ? 0
        : 1,
    );
    expect(document.body.textContent).not.toContain("PRIVATE_EXCEPTION");
    expect(document.body.textContent).not.toContain("AUTH_SECRET");
    expect(screen.queryByRole("region", { name: "助手的建议" })).toBeNull();
    expect(
      f.write.mock.calls.every(
        ([value]) => JSON.stringify(metadata(value)) === JSON.stringify(before),
      ),
    ).toBe(true);
  } finally {
    window.removeEventListener("aivora-notice", collect);
    cleanup();
    vi.restoreAllMocks();
  }
});

it("offers no assistant action before a work is opened and does not dispatch text or media", async () => {
  const text = vi.fn(),
    video = vi.fn();
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    readFilmProject: vi.fn(async () => null),
    createStoryFilm: video,
  } as unknown as Window["aijian"];
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: null,
      lastError: null,
    })),
    models: vi.fn(async () => ({ kind: "OK", models: [] })),
    completeText: text,
  } as unknown as Window["aijianGrok"];
  render(<ProWorkspace />);
  await screen.findByRole("heading", { name: "把故事做成短剧" });
  expect(screen.queryByRole("button", { name: "请美术定画风" })).toBeNull();
  expect(screen.queryByRole("button", { name: "写英文画面说明" })).toBeNull();
  expect(text).not.toHaveBeenCalled();
  expect(video).not.toHaveBeenCalled();
});
