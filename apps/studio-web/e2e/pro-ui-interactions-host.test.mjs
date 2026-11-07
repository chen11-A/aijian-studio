/** Actual Pro with the browser's default local-only ABI; not real playback/OS IME evidence. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { it, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { ProWorkspace } from "../src/aivora/pro/ProWorkspace";
import * as persistence from "../src/aivora/pro/film-persistence";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { waitAssemblyIdle } from "./pro-assembly-assertions.mjs";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import {
  installEvidenceLegacyBridge,
  seedEvidenceLegacyProject,
} from "./pro-evidence-legacy-fixture.mjs";
import {
  READY_SHOT_MENU,
  observeUiSeekMetadata,
  installUiInteractionsBridge,
  seedUiInteractionsProject,
} from "./pro-ui-interactions-fixture.mjs";
const create = persistence.createFilmPersistence,
  queues = [],
  originals = new Map(
    [
      "aijian",
      "aijianGrok",
      "__exportQcAudit",
      "__proCreationAudit",
      "__assemblyAudit",
      "__proEvidenceLegacyAudit",
      "__uiInteractionsAudit",
      "TextEncoder",
      "setTimeout",
      "clearTimeout",
    ].map((k) => [k, window[k]]),
  );
afterEach(async () => {
  cleanup();
  for (const q of queues.splice(0)) await q.flushAll();
  vi.restoreAllMocks();
  for (const [k, v] of originals) {
    if (v === undefined) delete window[k];
    else window[k] = v;
  }
  window.localStorage.clear();
});
async function open(state) {
  window.localStorage.clear();
  window.TextEncoder = globalThis.TextEncoder;
  installExportQcBridge({ state: "clean", aspect: "16:9" });
  installCreationBridge({ state });
  installAssemblyAuditBridge({ mode: "complete" });
  installEvidenceLegacyBridge({ state });
  installUiInteractionsBridge();
  await seedProProject({
    projectModuleUrl: "../src/aivora/film/project.ts",
    aspect: "16:9",
    versions: 3,
    videoUrl: "data:video/mp4;base64,AAAA",
  });
  seedEvidenceLegacyProject({ state });
  const seed = seedUiInteractionsProject();
  vi.spyOn(persistence, "createFilmPersistence").mockImplementation((v) => {
    const q = create(v);
    queues.push(q);
    return q;
  });
  render(createElement(ProWorkspace));
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    assert(window.__proEvidenceLegacyAudit.filmWrites.some((w) => w.projectId === seed.projectId)),
  );
  const before = window.__proCreationAudit.record(seed.projectId);
  return { seed, before, raw: () => window.__proCreationAudit.record(seed.projectId) };
}
async function settled(f, count) {
  await waitFor(() => assert.equal(window.__assemblyAudit.artifacts.length, count));
  await waitAssemblyIdle(
    {
      evaluate: async (fn, arg) => fn(arg),
      waitForFunction: async (fn, arg) => waitFor(() => assert.equal(fn(arg), true)),
    },
    f.seed.projectId,
  );
}
const tab = (name) =>
  within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
    name: new RegExp(name),
  });
const kept = (f) => ({
  shots: f.shots
    .map((s) => ({
      id: s.id,
      takes: s.takes,
      stills: s.stills,
      poster: s.poster,
      selectedTakeId: s.selectedTakeId,
    }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  audioClips: f.audioClips,
});
function safe(waves = 0, orphans = 0) {
  assert.equal(window.__proEvidenceLegacyAudit.waveforms.length, waves);
  assert.equal(window.__uiInteractionsAudit.orphanRefusals.length, orphans);
  assert.deepEqual(
    [
      ...window.__proCreationAudit.forbidden,
      ...window.__exportQcAudit.forbidden,
      ...window.__proEvidenceLegacyAudit.forbidden,
      ...window.__assemblyAudit.forbidden,
      ...window.__uiInteractionsAudit.forbidden,
    ],
    [],
  );
}
it("context menus use actual scene/board/clip lists, dismiss on Escape and mirror More", async () => {
  const f = await open("ui-context-menus");
  fireEvent.click(tab("分镜"));
  fireEvent.contextMenu(window.document.querySelectorAll(".grid .card")[1]);
  let menu = screen.getByRole("menu", { name: /^镜头 \d+ 的操作$/ });
  const labels = within(menu)
    .getAllByRole("menuitem")
    .map((e) => e.textContent);
  assert.deepEqual(labels, READY_SHOT_MENU);
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => assert.equal(screen.queryByRole("menu"), null));
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  assert.deepEqual(
    within(screen.getByRole("menu", { name: "这一镜的更多操作" }))
      .getAllByRole("button")
      .map((e) => e.textContent),
    labels,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.contextMenu(window.document.querySelector(".scenes .scene"));
  menu = screen.getByRole("menu", { name: /的操作$/ });
  assert.deepEqual(
    within(menu)
      .getAllByRole("menuitem")
      .map((e) => e.textContent),
    ["加镜头", "生成这一场"],
  );
  fireEvent.keyDown(menu, { key: "Escape" });
  fireEvent.click(tab("剪辑"));
  await waitFor(() => assert.equal(window.__assemblyAudit.artifacts.length, 1));
  fireEvent.contextMenu(window.document.querySelectorAll(".clip.v")[1]);
  menu = screen.getByRole("menu", { name: /^镜头 \d+ 的操作$/ });
  assert.deepEqual(
    within(menu)
      .getAllByRole("menuitem")
      .map((e) => e.textContent),
    ["重新生成", "换配音", "剪掉"],
  );
  // The selected-clip toolbar uses the same visible deletion verb as its menu.
  for (const label of ["重新生成", "换配音", "剪掉"])
    assert.equal(screen.queryAllByRole("button", { name: label }).length, 1);
  fireEvent.keyDown(menu, { key: "Escape" });
  assert.deepEqual(kept(f.raw()), kept(f.before));
  safe(6);
});
it("title Enter saves once, Escape/composition do not submit, and typing transport keys preserves media", async () => {
  const f = await open("ui-title-composition");
  fireEvent.doubleClick(screen.getByRole("button", { name: "作品" }));
  let input = screen.getByLabelText("改作品名");
  fireEvent.change(input, { target: { value: "取消稿" } });
  fireEvent.keyDown(input, { key: "Escape" });
  assert.equal(window.__uiInteractionsAudit.renames.length, 0);
  fireEvent.doubleClick(screen.getByRole("button", { name: "作品" }));
  input = screen.getByLabelText("改作品名");
  fireEvent.change(input, { target: { value: "合成输入中" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
  assert.equal(window.__uiInteractionsAudit.renames.length, 0);
  assert.equal(screen.getByLabelText("改作品名"), input);
  fireEvent.change(input, { target: { value: "正常浏览器改名" } });
  fireEvent.keyDown(input, { key: "Enter" });
  assert.deepEqual(window.__uiInteractionsAudit.renames, [
    { seriesId: f.seed.seriesId, title: "正常浏览器改名" },
  ]);
  assert.deepEqual(kept(f.raw()), kept(f.before));
  safe();
});
it("folded sound/advanced badges count actual edits, disappear when open and update after clearing", async () => {
  const f = await open("ui-property-counts");
  fireEvent.click(tab("分镜"));
  const summary = (name) =>
    [...window.document.querySelectorAll(".pgroup > summary")].find((s) => s.textContent === name);
  const fold = async (name, want) => {
    const s = summary(name);
    if (s.parentElement.open !== want) fireEvent.click(s);
    await waitFor(() => {
      assert.equal(s.parentElement.open, want);
      if (want) {
        assert.equal(s.getAttribute("data-count"), null);
        assert.equal(s.getAttribute("title"), null);
      }
    });
    return s;
  };
  await fold("声音", true);
  fireEvent.change(screen.getByLabelText("这一镜的环境音"), { target: { value: "门外雨声" } });
  fireEvent.change(screen.getByLabelText("配乐情绪"), { target: { value: "平静" } });
  const nativeToggle = [];
  summary("声音").parentElement.addEventListener(
    "toggle",
    () =>
      nativeToggle.push({
        open: summary("声音").parentElement.open,
        count: summary("声音").getAttribute("data-count"),
      }),
    { capture: true },
  );
  await waitFor(() => assert.equal(f.raw().shots[0].sound.musicMood, "平静"));
  await fold("声音", false);
  await waitFor(() => assert.equal(summary("声音").getAttribute("data-count"), "· 2"));
  assert(
    nativeToggle.some((t) => !t.open && t.count === null),
    "Native details.open precedes the React count render",
  );
  assert.equal(summary("声音").getAttribute("data-count"), "· 2");
  await fold("声音", true);
  assert(
    nativeToggle.some((t) => t.open && t.count === "· 2"),
    "Native opening precedes clearing the prior React badge",
  );
  assert.equal(summary("声音").getAttribute("data-count"), null);
  assert.equal(summary("声音").getAttribute("title"), null);
  fireEvent.change(screen.getByLabelText("配乐情绪"), { target: { value: "" } });
  await fold("声音", false);
  assert.equal(summary("声音").getAttribute("data-count"), "· 1");
  await fold("高级", true);
  fireEvent.change(screen.getByLabelText("这一镜的画风"), { target: { value: "保留真实编辑" } });
  await fold("高级", false);
  assert.equal(summary("高级").getAttribute("data-count"), "· 1");
  assert.deepEqual(kept(f.raw()), kept(f.before));
  safe();
});
it("real edit transport keys and Delete/Backspace retain input/menu guards then cut/undo all original media", async () => {
  const f = await open("ui-transport-delete");
  fireEvent.click(tab("剪辑"));
  await waitFor(() => assert.equal(window.__assemblyAudit.artifacts.length, 1));
  assert.equal(window.document.querySelectorAll(".pro-root .ph h3").length, 0);
  fireEvent.click(
    within(window.document.querySelector(".pane.monitor .monitor-tabs")).getByRole("button", {
      name: "预览",
    }),
  );
  const video = window.document.querySelector(".preview-player video.frame");
  const ruler = screen.getByRole("slider", { name: "播放位置" });
  fireEvent.loadedMetadata(video);
  const admissions = observeUiSeekMetadata(video);
  const seek = (target, key) => {
    const before = admissions.registrations;
    fireEvent.keyDown(target, { key });
    assert(admissions.registrations > before || video.readyState >= 1);
    if (admissions.registrations > before) fireEvent.loadedMetadata(video);
  };
  assert.equal(Number(ruler.getAttribute("aria-valuenow")), 0);
  assert.equal(video.currentTime, 0);
  fireEvent.keyDown(window, { key: "l" });
  assert(screen.getByRole("button", { name: "暂停" }));
  fireEvent.keyDown(window, { key: "l" });
  assert(screen.getByText("快放 2×"));
  fireEvent.keyDown(window, { key: "k" });
  assert(screen.getByRole("button", { name: "播放" }));
  ruler.focus();
  seek(ruler, "Home");
  assert.equal(Number(ruler.getAttribute("aria-valuenow")), 0);
  assert.equal(video.currentTime, 0);
  const preview = within(window.document.querySelector(".pane.monitor .monitor-tabs")).getByRole(
    "button",
    { name: "预览" },
  );
  fireEvent.click(preview);
  preview.focus();
  seek(window, "ArrowDown");
  assert(
    Math.abs(video.currentTime - window.__assemblyAudit.artifacts[0].shots[1].startSeconds) < 0.001,
  );
  seek(window, "ArrowUp");
  assert.equal(video.currentTime, 0);
  seek(window, "ArrowLeft");
  assert.equal(video.currentTime, 0);
  seek(window, "ArrowRight");
  assert(Math.abs(video.currentTime - 1 / 30) < 0.0001);
  seek(window, "ArrowDown");
  fireEvent.keyDown(window, { key: "j" });
  assert(screen.getByText("倒放 1×"));
  fireEvent.keyDown(window, { key: "k" });
  fireEvent.click(window.document.querySelector(".clip.v"));
  const field = screen.getByLabelText("改这一镜的描述");
  field.focus();
  fireEvent.keyDown(field, { key: "Delete" });
  assert.equal(window.document.querySelectorAll(".clip.v").length, 6);
  field.blur();
  fireEvent.contextMenu(window.document.querySelector(".clip.v"));
  fireEvent.keyDown(window, { key: "Delete" });
  assert.equal(window.document.querySelectorAll(".clip.v").length, 6);
  fireEvent.keyDown(window, { key: "Escape" });
  let operations = 1;
  for (const key of ["Delete", "Backspace"]) {
    fireEvent.click(window.document.querySelector(".clip.v"));
    fireEvent.keyDown(window, { key });
    assert.equal(window.document.querySelectorAll(".clip.v").length, 5);
    await settled(f, ++operations);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => assert.equal(window.document.querySelectorAll(".clip.v").length, 6));
    await settled(f, ++operations);
  }
  assert.deepEqual(kept(f.raw()), kept(f.before));
  safe(28, 2);
});
