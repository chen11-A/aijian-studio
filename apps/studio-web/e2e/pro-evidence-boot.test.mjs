/** Vitest actual-Pro host test (not node:test); contracts remain *.contract.mjs. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { it, afterEach } from "vitest";
import { ProWorkspace } from "../src/aivora/pro/ProWorkspace";
import { sampleFilm, FILM_KEY } from "../src/aivora/film/project";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import {
  seedEvidenceLegacyProject,
  installEvidenceLegacyBridge,
} from "./pro-evidence-legacy-fixture.mjs";
import { waitAssemblyIdle } from "./pro-assembly-assertions.mjs";
const timer = window.setTimeout,
  clear = window.clearTimeout;
const fields = [
  "aijian",
  "aijianGrok",
  "__proCreationAudit",
  "__exportQcAudit",
  "__assemblyAudit",
  "__proEvidenceLegacyAudit",
];
const originals = new Map(fields.map((key) => [key, window[key]]));
afterEach(() => {
  cleanup();
  window.setTimeout = timer;
  window.clearTimeout = clear;
  for (const [key, value] of originals) {
    if (value === undefined) delete window[key];
    else window[key] = value;
  }
  window.localStorage.clear();
});
it("observes real Pro/script autosave generation and completed write before any native assembly exists", async () => {
  window.localStorage.clear();
  installExportQcBridge({ state: "clean", aspect: "16:9" });
  installCreationBridge({ state: "evidence-written" });
  installAssemblyAuditBridge({ mode: "complete" });
  installEvidenceLegacyBridge({ state: "evidence-written" });
  const film = sampleFilm();
  film.title = "布局核验合成作品";
  film.seriesTitle = film.title;
  film.shots = film.shots.map((shot) => ({
    ...shot,
    selectedTakeId: `${shot.id}-layout-1`,
    takes: [
      {
        id: `${shot.id}-layout-1`,
        index: 1,
        status: "done",
        videoPath: `/synthetic/${shot.id}.mp4`,
      },
    ],
  }));
  window.localStorage.setItem(FILM_KEY, JSON.stringify(film));
  const seed = seedEvidenceLegacyProject({ state: "evidence-written" });
  render(createElement(ProWorkspace));
  await screen.findByLabelText("这一场");
  await waitFor(() => assert.equal(window.__proEvidenceLegacyAudit.filmWrites.length, 1));
  const audit = window.__assemblyAudit;
  assert.deepEqual(audit.scope(), { projectId: seed.projectId, stage: "script" });
  assert.equal(audit.calls.length, 0);
  assert(
    audit.saveTimers.some(
      (entry) =>
        entry.projectId === seed.projectId &&
        entry.stage === "script" &&
        entry.generation > 0 &&
        entry.status === "fired",
    ),
  );
  assert.equal(audit.pendingWrites[seed.projectId], 0);
  const page = {
    evaluate: async (fn, arg) => fn(arg),
    waitForFunction: async (fn, marker) => {
      assert.equal(marker.operationId, null);
      await waitFor(() => assert.equal(fn(marker), true));
    },
  };
  await waitAssemblyIdle(page, seed.projectId);
  assert.equal(audit.lastReadiness.operationId, null);
  assert.equal(audit.calls.length, 0);
  assert.equal(window.__proEvidenceLegacyAudit.filmWrites.length, 1);
  assert.deepEqual(audit.forbidden, []);
  assert.deepEqual(window.__proEvidenceLegacyAudit.forbidden, []);
});
