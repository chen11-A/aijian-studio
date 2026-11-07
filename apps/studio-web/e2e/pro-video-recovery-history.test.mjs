/** Actual settings/recovery consumer; Vitest, not node:test. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { it, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ProWorkspace } from "../src/aivora/pro/ProWorkspace";
import { sampleFilm, FILM_KEY } from "../src/aivora/film/project";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import {
  installVideoRecoveryBridge,
  seedVideoRecoveryProject,
} from "./pro-video-recovery-fixture.mjs";
const timer = window.setTimeout,
  clear = window.clearTimeout;
const fields = [
    "aijian",
    "aijianGrok",
    "__proCreationAudit",
    "__exportQcAudit",
    "__assemblyAudit",
    "__proVideoRecoveryAudit",
  ],
  originals = new Map(fields.map((key) => [key, window[key]]));
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
it("allows only the actual read-only history listing triggered by settings while keeping capture/restore/provider forbidden", async () => {
  window.localStorage.clear();
  installExportQcBridge({ state: "clean", aspect: "16:9" });
  installCreationBridge({ state: "recovery-success" });
  installAssemblyAuditBridge({ mode: "complete" });
  installVideoRecoveryBridge({ state: "recovery-success" });
  const film = sampleFilm();
  window.localStorage.setItem(FILM_KEY, JSON.stringify(film));
  const seed = seedVideoRecoveryProject({ state: "recovery-success" });
  render(createElement(ProWorkspace));
  await screen.findByLabelText("这一场");
  await waitFor(() => assert.equal(window.__proVideoRecoveryAudit.writes.length, 1));
  const before = window.__proCreationAudit.record(seed.projectId);
  const show = () => {
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
    fireEvent.click(screen.getByRole("button", { name: "查看可核对的视频记录" }));
  };
  show();
  await screen.findByText("原素材尚未确认。");
  assert.deepEqual(window.__assemblyAudit.forbidden, []);
  assert.equal(window.__proVideoRecoveryAudit.lists.length, 1);
  assert.equal(window.__proVideoRecoveryAudit.recovers.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  show();
  await screen.findByText("原素材尚未确认。");
  assert.deepEqual(window.__assemblyAudit.forbidden, []);
  assert.deepEqual(window.__proCreationAudit.record(seed.projectId), before);
  assert.deepEqual(window.__proVideoRecoveryAudit.histories, [
    { projectId: seed.projectId },
    { projectId: seed.projectId },
  ]);
  assert.deepEqual(window.__proVideoRecoveryAudit.forbidden, []);
  assert.deepEqual(window.__assemblyAudit.calls, []);
});
