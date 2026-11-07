/** Actual Pro consumer of this synthetic browser ABI. Not main/probe/codec evidence. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createElement } from "react";
import { afterEach, it, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as persistence from "../src/aivora/pro/film-persistence";
import { ProWorkspace } from "../src/aivora/pro/ProWorkspace";
import { sampleFilm, FILM_KEY } from "../src/aivora/film/project";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { waitAssemblyIdle } from "./pro-assembly-assertions.mjs";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import { installActualTrialBridge, seedActualTrialProject } from "./pro-actual-trial-fixture.mjs";
const originalQueue = persistence.createFilmPersistence;
const queues = [];
const fields = [
    "aijian",
    "aijianGrok",
    "__exportQcAudit",
    "__proCreationAudit",
    "__assemblyAudit",
    "__actualTrialAudit",
    "TextEncoder",
    "setTimeout",
    "clearTimeout",
  ],
  originals = new Map(fields.map((key) => [key, window[key]])),
  create = window.URL.createObjectURL,
  revoke = window.URL.revokeObjectURL;
afterEach(async () => {
  cleanup();
  for (const queue of queues.splice(0)) await queue.flushAll();
  vi.restoreAllMocks();
  for (const [key, value] of originals) {
    if (value === undefined) delete window[key];
    else window[key] = value;
  }
  window.URL.createObjectURL = create;
  window.URL.revokeObjectURL = revoke;
  window.localStorage.clear();
});
async function open(state) {
  window.localStorage.clear();
  window.TextEncoder = globalThis.TextEncoder;
  installExportQcBridge({ state: "clean", aspect: "16:9" });
  installCreationBridge({ state });
  installAssemblyAuditBridge({ mode: "complete" });
  installActualTrialBridge({ state, mediaBytes: [1, 2, 3] });
  const film = sampleFilm();
  film.shots = film.shots.map((shot) => ({
    ...shot,
    selectedTakeId: `${shot.id}-layout-1`,
    takes: Array.from({ length: 3 }, (_, i) => ({
      id: `${shot.id}-layout-${i + 1}`,
      shotId: shot.id,
      index: i + 1,
      status: "done",
      videoPath: `/synthetic/${shot.id}-${i + 1}.mp4`,
      videoUrl: "data:video/mp4;base64,AAAA",
      prompt: "synthetic",
      createdAt: "",
    })),
  }));
  window.localStorage.setItem(FILM_KEY, JSON.stringify(film));
  const seed = await seedActualTrialProject({
    state,
    controllerUrl: resolve("src/aivora/pro/film-pipeline-controller.ts"),
    pipelineUrl: resolve("src/aivora/film/production-pipeline.ts"),
  });
  window.URL.createObjectURL = () => "blob:actual-trial-audit";
  window.URL.revokeObjectURL = () => undefined;
  vi.spyOn(persistence, "createFilmPersistence").mockImplementation((value) => {
    const queue = originalQueue(value);
    queues.push(queue);
    return queue;
  });
  render(createElement(ProWorkspace));
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    assert(window.__actualTrialAudit.writes.some((value) => value.projectId === seed.projectId)),
  );
  for (const key of ["prepares", "media", "records", "checks"])
    assert.equal(window.__actualTrialAudit[key].length, 0);
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剪辑/,
    }),
  );
  await waitFor(() => assert.equal(window.__assemblyAudit.artifacts.length, 1));
  // A native artifact precedes Pro's adoption/save; review only the settled edit input.
  await waitAssemblyIdle(
    {
      evaluate: async (fn, arg) => fn(arg),
      waitForFunction: async (fn, arg) => waitFor(() => assert.equal(fn(arg), true)),
    },
    seed.projectId,
  );
  fireEvent.click(screen.getByRole("button", { name: "审核实际版本试片" }));
  const dialog = await screen.findByRole("dialog", { name: "实际版本试片审核" });
  if (state === "trial-stale-source") await within(dialog).findByText("正在读取本次核对的素材…");
  else await within(dialog).findByText("实际素材时长：2.25 秒");
  return {
    seed,
    dialog,
    audit: window.__actualTrialAudit,
    raw: (id) => window.__proCreationAudit.record(id ?? seed.projectId),
  };
}
it("the default accepted fixture reaches the real checkpoint and closes final main check with one record and no provider", async () => {
  const f = await open("trial-accepted-checkpoint");
  assert.equal(f.audit.records.length, 0);
  fireEvent.click(within(f.dialog).getByRole("radio", { name: "接受这个实际版本" }));
  fireEvent.click(within(f.dialog).getByRole("checkbox"));
  fireEvent.click(within(f.dialog).getByRole("button", { name: "保存本次人工决定" }));
  await within(f.dialog).findByText("人工决定已记录：接受。");
  assert.equal(f.audit.records.length, 1);
  assert.equal(f.audit.checks.length, 0);
  const next = within(f.dialog).getByRole("button", { name: "继续生成" });
  assert.equal(next.disabled, false);
  fireEvent.click(next);
  await waitFor(() => assert.equal(f.audit.checks.length, 1));
  assert.equal(f.audit.checks[0].matched, true);
  assert.equal(f.audit.captures.length, 1);
  assert.deepEqual(
    [
      ...f.audit.forbidden,
      ...window.__proCreationAudit.forbidden,
      ...window.__assemblyAudit.forbidden,
    ],
    [],
  );
});

it("the default needs-changes fixture preserves the untrimmed decision and complete original non-record raw", async () => {
  const f = await open("trial-needs-changes"),
    before = f.raw(),
    note = "  人工原文🙂\n保留空白  ";
  fireEvent.change(within(f.dialog).getByRole("textbox"), { target: { value: note } });
  fireEvent.click(within(f.dialog).getByRole("radio", { name: "这个实际版本需要修改" }));
  fireEvent.click(within(f.dialog).getByRole("button", { name: "保存本次人工决定" }));
  await within(f.dialog).findByText("人工决定已记录：需修改。");
  const saved = f.raw();
  assert.equal(saved.riskTrialDecisions.length, 1);
  assert.equal(saved.riskTrialDecisions[0].note, note);
  delete saved.riskTrialDecisions;
  saved.savedAt = before.savedAt;
  assert.deepEqual(saved, before);
  assert.equal(f.audit.records.length, 1);
  assert.equal(f.audit.checks.length, 0);
  assert.deepEqual(f.audit.forbidden, []);
});
it("the default held media fixture can close and discard its late reply without any record", async () => {
  const f = await open("trial-stale-source"),
    before = f.raw();
  assert.equal(f.audit.pending.length, 1);
  assert.equal(f.audit.pending[0].kind, "media");
  fireEvent.click(within(f.dialog).getByRole("button", { name: "关闭" }));
  await f.audit.release(0);
  await waitFor(() =>
    assert.equal(screen.queryByRole("dialog", { name: "实际版本试片审核" }), null),
  );
  assert.deepEqual(f.raw(), before);
  assert.equal(f.audit.records.length, 0);
  assert.equal(f.audit.checks.length, 0);
  assert.deepEqual(f.audit.forbidden, []);
});
it("the default lost-ACK fixture keeps real Pro unknown until one explicit BUSY then settled global recovery", async () => {
  const f = await open("trial-unknown-global"),
    before = f.raw();
  fireEvent.click(within(f.dialog).getByRole("radio", { name: "接受这个实际版本" }));
  fireEvent.click(within(f.dialog).getByRole("checkbox"));
  fireEvent.click(within(f.dialog).getByRole("button", { name: "保存本次人工决定" }));
  // First observe the real queue's unknown-write accounting after the lost native ACK.
  await waitFor(() =>
    assert.equal(queues.at(-1).externalWriteState(f.seed.projectId)?.status, "unknown"),
  );
  await screen.findByRole("button", { name: "试片记录待核对（1）" });
  assert.equal(f.audit.pending.length, 1);
  assert.equal(f.audit.records.length, 1);
  fireEvent.click(within(f.dialog).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "合成试片第2集" }));
  await waitFor(() =>
    assert.match(window.document.querySelector(".topbar .ep").textContent, /合成试片第2集/),
  );
  await waitFor(() =>
    assert(window.__assemblyAudit.calls.some((call) => call.input.projectId === f.seed.otherId)),
  );
  await waitAssemblyIdle(
    {
      evaluate: async (fn, arg) => fn(arg),
      waitForFunction: async (fn, arg) => waitFor(() => assert.equal(fn(arg), true)),
    },
    f.seed.otherId,
  );
  const otherBefore = f.raw(f.seed.otherId),
    otherWrites = f.audit.writes.filter((write) => write.projectId === f.seed.otherId).length;
  fireEvent.click(screen.getByRole("button", { name: "试片记录待核对（1）" }));
  const panel = screen.getByRole("dialog", { name: "试片记录保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对试片保存结果" }));
  await within(panel).findByText("本机记录还在处理中，请稍后手动核对，不要重复记录。");
  assert.deepEqual(f.raw(), before);
  await f.audit.release(0);
  fireEvent.click(within(panel).getByRole("button", { name: "核对试片保存结果" }));
  await within(panel).findByText("人工决定已记录。继续仍须重新确认生成范围、数量与费用。");
  assert.equal(screen.queryByRole("button", { name: "试片记录待核对（1）" }), null);
  const saved = f.raw();
  assert.equal(saved.riskTrialDecisions.length, 1);
  delete saved.riskTrialDecisions;
  saved.savedAt = before.savedAt;
  assert.deepEqual(saved, before);
  assert.deepEqual(f.raw(f.seed.otherId), otherBefore);
  assert.equal(
    f.audit.writes.filter((write) => write.projectId === f.seed.otherId).length,
    otherWrites,
  );
  assert.match(window.document.querySelector(".topbar .ep").textContent, /合成试片第2集/);
  assert.equal(f.audit.records.length, 1);
  assert.equal(f.audit.checks.length, 0);
  assert.deepEqual(f.audit.forbidden, []);
});
