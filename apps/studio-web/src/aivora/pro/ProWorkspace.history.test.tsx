import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { readSaved, saveFilm } from "../film/library";
import * as historyModule from "./actions/page-history";
import * as checkpointModule from "./actions/history-checkpoint";
import { ProWorkspace } from "./ProWorkspace";

const createHistory = historyModule.createEditorPageHistory,
  createCheckpoint = checkpointModule.historyCheckpoint;

describe("5-3-03 workspace history notices", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
    delete window.aijianGrok;
  });
  afterEach(() => vi.restoreAllMocks());

  async function open(film: FilmProject) {
    let committed!: () => void;
    const initialCheckpoint = new Promise<void>((done) => {
      committed = done;
    });
    vi.spyOn(checkpointModule, "historyCheckpoint").mockImplementation(
      (snapshot, selection, host) => {
        const checkpoint = createCheckpoint(snapshot, selection, host);
        return () => {
          const accepted = checkpoint();
          // Observe the real timer's guarded commit; never invoke it early or
          // confuse a visible textarea with a settled hydration/history baseline.
          if (accepted && snapshot.id === film.id && selection.page === "script") committed();
          return accepted;
        };
      },
    );
    await saveFilm(film);
    render(<ProWorkspace />);
    await screen.findByLabelText("这一场");
    await act(async () => initialCheckpoint);
  }

  const notice = () => document.querySelector(".status-note")?.textContent;

  it("describes a real text edit undo and redo in the status bar without quoting its contents", async () => {
    const film = sampleFilm();
    await open(film);
    const text = "不应出现在状态栏的私人正文";
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: text } });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("这一场")).toHaveValue(film.scenes[0]!.text);
    expect(notice()).toBe("已撤销：修改场次的剧本");
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByLabelText("这一场")).toHaveValue(text);
    expect(notice()).toBe("已重做：修改场次的剧本");
    expect(notice()).not.toContain(text);
    await waitFor(async () => {
      expect((await readSaved(film.id))?.scenes[0]!.text).toBe(text);
    });
  });

  it("reports a partial undo and preserves the conflicting field", async () => {
    const history = createHistory();
    vi.spyOn(historyModule, "createEditorPageHistory").mockReturnValue(history);
    const before = sampleFilm();
    const edited = structuredClone(before);
    edited.scenes[0]!.text = "第一次修改的正文";
    edited.scenes[0]!.title = "第一次修改的标题";
    const scope = { projectId: before.id, page: "script" as const };
    const live = structuredClone(edited);
    live.scenes[0]!.title = "后来独立修改的标题";
    await open(live);
    expect(history.record(before, edited, scope)).toEqual([]);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("这一场")).toHaveValue(before.scenes[0]!.text);
    expect(notice()).toBe("已撤销部分改动：修改场次的剧本。其余内容后来改过，已保留。");
    expect(notice()).not.toMatch(/第一次|后来独立|VALUE_CHANGED|scenes:/);
    await waitFor(async () => {
      const saved = await readSaved(live.id);
      expect(saved?.scenes[0]!.title).toBe(live.scenes[0]!.title);
      expect(saved?.scenes[0]!.text).toBe(before.scenes[0]!.text);
    });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByLabelText("这一场")).toHaveValue(edited.scenes[0]!.text);
    expect(notice()).toBe("已重做：修改场次的剧本");
  });

  it("keeps redo atomic and announces no success if one field conflicts", async () => {
    const history = createHistory();
    vi.spyOn(historyModule, "createEditorPageHistory").mockReturnValue(history);
    const before = sampleFilm();
    const edited = structuredClone(before);
    edited.scenes[0]!.text = "第一次修改的正文";
    edited.scenes[0]!.title = "第一次修改的标题";
    const scope = { projectId: before.id, page: "script" as const };
    const live = structuredClone(before);
    live.scenes[0]!.title = "后来独立修改的标题";
    await open(live);
    history.record(before, edited, scope);
    history.undo(edited, scope);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByLabelText("这一场")).toHaveValue(before.scenes[0]!.text);
    expect(notice()).toBe("内容后来改过，这次没有覆盖。");
    expect(history.canRedo(scope)).toBe(true);
    await waitFor(async () => {
      expect((await readSaved(live.id))?.scenes[0]!.title).toBe(live.scenes[0]!.title);
    });
  });

  it("does not announce success when every field conflicts", async () => {
    const history = createHistory();
    vi.spyOn(historyModule, "createEditorPageHistory").mockReturnValue(history);
    const before = sampleFilm();
    const edited = structuredClone(before);
    edited.scenes[0]!.text = "第一次修改";
    const scope = { projectId: before.id, page: "script" as const };
    const live = structuredClone(edited);
    live.scenes[0]!.text = "后来修改的正文";
    await open(live);
    expect(history.record(before, edited, scope)).toEqual([]);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("这一场")).toHaveValue(live.scenes[0]!.text);
    expect(notice()).toBe("内容后来改过，这次没有覆盖。");
    expect(history.canUndo(scope)).toBe(true);
  });
});
