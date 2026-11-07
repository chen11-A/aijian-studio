/** Actual Pro host consumers for legacy audit oracles; Vitest, not node:test. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { it, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ProWorkspace } from "../src/aivora/pro/ProWorkspace";
import { sampleFilm, FILM_KEY } from "../src/aivora/film/project";
import { audioSourceKey } from "../src/aivora/pro/actions/audio-waveforms";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import {
  installAssemblyAuditBridge,
  installAssemblyMediaRequests,
} from "./pro-assembly-fixture.mjs";
import {
  installEvidenceLegacyBridge,
  seedEvidenceLegacyProject,
} from "./pro-evidence-legacy-fixture.mjs";
const originalTimer = window.setTimeout,
  originalClear = window.clearTimeout,
  originalEncoder = window.TextEncoder;
const fields = [
  "aijian",
  "aijianGrok",
  "__proCreationAudit",
  "__exportQcAudit",
  "__assemblyAudit",
  "__proEvidenceLegacyAudit",
];
const originals = new Map(fields.map((key) => [key, window[key]]));
const play = window.HTMLMediaElement.prototype.play,
  pause = window.HTMLMediaElement.prototype.pause;
afterEach(() => {
  cleanup();
  window.setTimeout = originalTimer;
  window.clearTimeout = originalClear;
  window.TextEncoder = originalEncoder;
  window.HTMLMediaElement.prototype.play = play;
  window.HTMLMediaElement.prototype.pause = pause;
  for (const [key, value] of originals) {
    if (value === undefined) delete window[key];
    else window[key] = value;
  }
  window.localStorage.clear();
});
async function open(state) {
  window.localStorage.clear();
  window.TextEncoder = globalThis.TextEncoder;
  installExportQcBridge({ state: "clean", aspect: "16:9" });
  installCreationBridge({ state });
  installAssemblyAuditBridge({ mode: "complete" });
  installAssemblyMediaRequests();
  installEvidenceLegacyBridge({ state });
  const film = sampleFilm();
  film.title = "布局核验合成作品";
  film.seriesTitle = film.title;
  film.scenes = [film.scenes[1], film.scenes[0], film.scenes[2]];
  film.shots = film.shots.map((shot) => ({
    ...shot,
    selectedTakeId: `${shot.id}-layout-1`,
    takes: Array.from({ length: 3 }, (_, i) => ({
      id: `${shot.id}-layout-${i + 1}`,
      index: i + 1,
      status: "done",
      videoPath: `/synthetic/${shot.id}-${i + 1}.mp4`,
      videoUrl: "data:video/mp4;base64,AAAA",
    })),
  }));
  window.localStorage.setItem(FILM_KEY, JSON.stringify(film));
  const seed = seedEvidenceLegacyProject({ state });
  render(createElement(ProWorkspace));
  await screen.findByLabelText("这一场");
  await waitFor(() => assert.equal(window.__proEvidenceLegacyAudit.filmWrites.length, 1));
  return {
    seed,
    record: () => window.__proCreationAudit.record(seed.projectId),
    nav: (label) =>
      fireEvent.click(
        within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
          name: new RegExp(label),
        }),
      ),
  };
}
it("confirms exactly the two selected shots with full scene/shot names and preserves every media reference", async () => {
  const f = await open("legacy-board-drag-bulk"),
    before = f.record();
  f.nav("分镜");
  fireEvent.click(screen.getByRole("button", { name: "全部镜头" }));
  const cards = document.querySelectorAll(".grid .card");
  assert.equal(cards.length, 6);
  fireEvent.click(cards[0]);
  fireEvent.click(cards[2], { ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: /^(重新)?生成这 2 个$/ }));
  const dialog = screen.getByRole("dialog", { name: "生成前确认" });
  const names = [...dialog.querySelectorAll("tbody tr td:first-child")].map((el) =>
    el.textContent.trim(),
  );
  assert.equal(names.length, 2);
  assert.deepEqual(
    names,
    [1, 3].map((no) => `第 ${before.scenes[0].no} 场第 ${no} 个镜头`),
  );
  assert.deepEqual(f.record().shots, before.shots);
  assert.deepEqual(window.__proEvidenceLegacyAudit.forbidden, []);
});
it("delivers metadata to the real seek effect after the ruler request without faking currentTime or readyState", async () => {
  const f = await open("legacy-timeline-range");
  f.nav("剪辑");
  await waitFor(() => assert.equal(window.__assemblyAudit.artifacts.length, 1));
  const artifact = window.__assemblyAudit.artifacts[0];
  await waitFor(() => assert.equal(f.record().assemblyPath, artifact.path));
  const video = document.querySelector(".preview-player video.frame");
  assert(video);
  Object.defineProperty(video, "duration", { configurable: true, value: artifact.durationSeconds });
  fireEvent.loadedMetadata(video);
  const ruler = screen.getByRole("slider", { name: "播放位置" });
  ruler.focus();
  fireEvent.keyDown(ruler, { key: "ArrowRight" });
  assert.equal(video.currentTime, 0);
  fireEvent.loadedMetadata(video);
  await waitFor(() => assert.equal(video.currentTime, 1));
  assert.equal(window.__assemblyAudit.calls.length, 1);
});
it("selects the unique actual searched person button despite its name and portrait-status subtree", async () => {
  const f = await open("legacy-cast-search");
  f.nav("角色");
  const search = screen.getByRole("searchbox", { name: "找人物" });
  fireEvent.change(search, { target: { value: "12" } });
  const rows = [...document.querySelectorAll(".pb.scenes button.scene")];
  assert.equal(rows.length, 1);
  const name = rows[0].querySelector(".t");
  assert.notEqual(name.textContent.replace(/\s+/g, " ").trim(), f.seed.person);
  assert.equal(
    [...name.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join("")
      .trim(),
    f.seed.person,
  );
  fireEvent.click(rows[0]);
  assert.equal(screen.getByLabelText("人物名字").value, f.seed.person);
});
it("distinguishes real local waveform admission from paid dispatch while preserving the original audio and take metadata", async () => {
  const f = await open("legacy-empty-fullscreen"),
    before = f.record();
  f.nav("剪辑");
  await waitFor(() => assert.equal(window.__proEvidenceLegacyAudit.waveforms.length, 6));
  assert.deepEqual(window.__proCreationAudit.forbidden, []);
  const calls = window.__proEvidenceLegacyAudit.waveforms;
  for (const call of calls) {
    const clip = f.record().audioClips.find((c) => c.id === call.input.clipId);
    assert.equal(call.input.expectedSourceKey, await audioSourceKey(f.record(), clip));
    assert.equal(call.input.projectId, f.seed.projectId);
    assert.equal(call.matched, true);
  }
  assert.deepEqual(window.__proEvidenceLegacyAudit.forbidden, []);
  assert.deepEqual(f.record().audioClips, before.audioClips);
  assert.equal(typeof audioSourceKey, "function");
});
