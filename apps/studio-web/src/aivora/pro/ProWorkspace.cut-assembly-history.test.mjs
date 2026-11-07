/** Actual Pro + original persistence/native assembly consumer; synthetic native ABI, no media decode. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { it, afterEach, vi } from "vitest";
import { act, render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { sampleFilm, FILM_KEY } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";
import { assemblyClock, assemblyClockState } from "./assembly";
import * as persistence from "./film-persistence";
import * as editor from "./actions/editor-host";
import { installExportQcBridge } from "../../../e2e/pro-export-qc-fixture.mjs";
import { installCreationBridge } from "../../../e2e/pro-creation-fixture.mjs";
import { installAssemblyAuditBridge } from "../../../e2e/pro-assembly-fixture.mjs";
import { waitAssemblyIdle, assertAssemblyRequests } from "../../../e2e/pro-assembly-assertions.mjs";
import {
  installEvidenceLegacyBridge,
  seedEvidenceLegacyProject,
} from "../../../e2e/pro-evidence-legacy-fixture.mjs";
const window = globalThis.window;
const create = persistence.createFilmPersistence,
  createEditor = editor.createEditorHost,
  queues = [];
const keys = [
    "aijian",
    "aijianGrok",
    "__exportQcAudit",
    "__proCreationAudit",
    "__assemblyAudit",
    "__proEvidenceLegacyAudit",
    "TextEncoder",
    "setTimeout",
    "clearTimeout",
  ],
  originals = new Map(keys.map((k) => [k, window[k]]));
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
it("cuts and restores all six original shots across native reassembly, retires the five-shot clock and rebuilds it", async () => {
  window.localStorage.clear();
  window.TextEncoder = globalThis.TextEncoder;
  installExportQcBridge({ state: "clean", aspect: "16:9" });
  installCreationBridge({ state: "legacy-timeline-range" });
  installAssemblyAuditBridge({ mode: "complete" });
  installEvidenceLegacyBridge({ state: "legacy-timeline-range" });
  // removeShot deliberately retains audio references for undo. Real native analysis
  // rejects an absent owner as SOURCE_CHANGED; it is not a paid/unknown capability.
  const wave = window.aijian.readFilmAudioWaveform;
  const orphanRefusals = [];
  window.aijian.readFilmAudioWaveform = async (input) => {
    const raw = window.__proCreationAudit.record(input.projectId);
    const clip = raw.audioClips.filter((c) => c.id === input.clipId);
    if (clip.length === 1 && !raw.shots.some((s) => s.id === clip[0].shotId)) {
      assert.deepEqual(Object.keys(input).sort(), ["clipId", "expectedSourceKey", "projectId"]);
      assert.equal(input.projectId, raw.id);
      assert.match(input.expectedSourceKey, /^[a-f0-9]{64}$/);
      assert.equal(clip[0].path, `/synthetic/voice-0.wav`);
      orphanRefusals.push(input);
      return { kind: "FAILED", code: "SOURCE_CHANGED" };
    }
    return wave(input);
  };

  const film = sampleFilm();
  film.shots = film.shots.map((s) => ({
    ...s,
    selectedTakeId: `${s.id}-layout-1`,
    takes: Array.from({ length: 3 }, (_, i) => ({
      id: `${s.id}-layout-${i + 1}`,
      shotId: s.id,
      index: i + 1,
      status: "done",
      videoPath: `/synthetic/${s.id}-${i + 1}.mp4`,
      videoUrl: "data:video/mp4;base64,AAAA",
      createdAt: "",
      prompt: "synthetic",
    })),
  }));
  window.localStorage.setItem(FILM_KEY, JSON.stringify(film));
  const seed = seedEvidenceLegacyProject({ state: "legacy-timeline-range" });
  let host;
  vi.spyOn(editor, "createEditorHost").mockImplementation((v) => {
    host = v;
    return createEditor(v);
  });
  vi.spyOn(persistence, "createFilmPersistence").mockImplementation((v) => {
    const q = create(v);
    queues.push(q);
    return q;
  });
  render(createElement(ProWorkspace));
  await screen.findByLabelText("这一场");
  await waitFor(() => assert(window.__proEvidenceLegacyAudit.filmWrites.length));
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剪辑/,
    }),
  );
  const audit = window.__assemblyAudit,
    page = {
      evaluate: async (fn, arg) => fn(arg),
      waitForFunction: async (fn, arg) => waitFor(() => assert.equal(fn(arg), true)),
    };
  async function settled(count) {
    await waitFor(() => assert.equal(audit.artifacts.length, count));
    await waitAssemblyIdle(page, seed.projectId);
  }
  await settled(1);
  const before = globalThis.structuredClone(host.current()),
    expected = [before];
  assert.equal(assemblyClockState(before), "verified");
  assert.equal(assemblyClock(before).shots.length, 6);
  for (const [index, key] of ["Delete", "Backspace"].entries()) {
    fireEvent.click(window.document.querySelector(".clip.v"));
    fireEvent.keyDown(window, { key });
    assert.equal(window.document.querySelectorAll(".clip.v").length, 5);
    await settled(2 + index * 2);
    const cut = globalThis.structuredClone(host.current());
    expected.push(cut);
    assert.equal(assemblyClockState(cut), "verified");
    assert.equal(assemblyClock(cut).shots.length, 5);
    audit.mode = "hold";
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    assert.equal(window.document.querySelectorAll(".clip.v").length, 6);
    assert.deepEqual(host.current().shots, before.shots);
    assert.deepEqual(host.current().audioClips, before.audioClips);
    assert.equal(host.current().assemblyPath, cut.assemblyPath);
    assert.equal(assemblyClockState(host.current()), "stale");
    assert.equal(assemblyClock(host.current()), undefined);
    await waitFor(() => assert.equal(audit.calls.length, 3 + index * 2));
    assert.equal(audit.calls.at(-1).input.expectedSelection.length, 6);
    assert.equal(audit.calls.at(-1).matched, true);
    await act(async () => {
      audit.finish(audit.calls.at(-1).operationId);
    });
    await settled(3 + index * 2);
    const restored = globalThis.structuredClone(host.current());
    expected.push(restored);
    assert.equal(assemblyClockState(restored), "verified");
    assert.equal(assemblyClock(restored).shots.length, 6);
    assert.notEqual(restored.assemblyPath, cut.assemblyPath);
    audit.mode = "complete";
  }
  assertAssemblyRequests(audit.calls, expected);
  assert.equal(orphanRefusals.length, 2);
  assert.deepEqual(audit.cancels, []);
  assert.deepEqual(
    [
      ...audit.forbidden,
      ...window.__proEvidenceLegacyAudit.forbidden,
      ...window.__proCreationAudit.forbidden,
      ...window.__exportQcAudit.forbidden,
    ],
    [],
  );
});
