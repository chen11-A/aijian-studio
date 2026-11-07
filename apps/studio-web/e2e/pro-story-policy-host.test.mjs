/** Actual Pro with the same default synthetic browser ABI; not API persistence evidence. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { it, afterEach, vi } from "vitest";
import { act, render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { sampleFilm, FILM_KEY } from "../src/aivora/film/project";
import { ProWorkspace } from "../src/aivora/pro/ProWorkspace";
import * as persistence from "../src/aivora/pro/film-persistence";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { seedRiskPolicyProject } from "./pro-risk-policy-fixture.mjs";
import { installStoryPolicyBridge } from "./pro-story-policy-fixture.mjs";
const create = persistence.createFilmPersistence,
  queues = [];
const keys = [
    "aijian",
    "aijianGrok",
    "__exportQcAudit",
    "__proCreationAudit",
    "__storyPolicyAudit",
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
async function open(state, mode) {
  window.localStorage.clear();
  installExportQcBridge({ state: "clean", aspect: "16:9" });
  installCreationBridge({ state });
  installStoryPolicyBridge({ state });
  const film = sampleFilm();
  film.scenes = [film.scenes[1], film.scenes[0], film.scenes[2]];
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
      prompt: "synthetic",
      createdAt: "",
    })),
  }));
  window.localStorage.setItem(FILM_KEY, JSON.stringify(film));
  const seed = seedRiskPolicyProject({ state });
  if (mode === "missing-id") {
    const raw = window.__proCreationAudit.record(seed.projectId);
    raw.backendProjectId = "";
    window.localStorage.setItem(FILM_KEY, JSON.stringify(raw));
    window.localStorage.setItem(`aivora.film.v1.${raw.id}`, JSON.stringify(raw));
  }
  if (mode === "unsupported") {
    delete window.aijian.getStoryCreationFailurePolicy;
    delete window.aijian.configureStoryCreationFailurePolicy;
  }
  vi.spyOn(persistence, "createFilmPersistence").mockImplementation((v) => {
    const q = create(v);
    queues.push(q);
    return q;
  });
  render(createElement(ProWorkspace));
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    assert.notEqual(
      window.__proCreationAudit.record(seed.projectId).characters[0].gender,
      undefined,
    ),
  );
  const before = window.__proCreationAudit.record(seed.projectId),
    audit = window.__storyPolicyAudit;
  assert.deepEqual([audit.reads, audit.writes], [[], []]);
  function show() {
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
    fireEvent.click(screen.getByRole("button", { name: "设置创作流程失败上限" }));
    return screen.getByRole("dialog", { name: "创作流程失败保护" });
  }
  const dialog = show();
  if (!mode) await within(dialog).findByText("尚未配置创作流程上限。");
  return { seed, before, audit, dialog, show, writeBaseline: audit.filmWrites.length };
}
const fill = (d, v) => fireEvent.change(within(d).getByRole("textbox"), { target: { value: v } }),
  save = (d) => fireEvent.click(within(d).getByRole("button", { name: "保存创作流程上限" })),
  refresh = (d) => fireEvent.click(within(d).getByRole("button", { name: "重新核对创作流程上限" }));
function unchanged(f) {
  assert.equal(f.audit.filmWrites.length, f.writeBaseline);
  assert.deepEqual(window.__proCreationAudit.record(f.seed.projectId), f.before);
  assert.deepEqual(
    [
      ...f.audit.forbidden,
      ...window.__proCreationAudit.forbidden,
      ...window.__exportQcAudit.forbidden,
    ],
    [],
  );
}
it("default values mode stays blank and independent of video77 then persists explicit0/1000", async () => {
  const f = await open("story-policy-values");
  assert.equal(within(f.dialog).getByRole("textbox").value, "");
  for (const v of ["", "-1", "1.5", "1e2", "1001"]) {
    fill(f.dialog, v);
    save(f.dialog);
    assert.equal(f.audit.writes.length, 0);
  }
  for (const v of ["0", "1000"]) {
    fill(f.dialog, v);
    save(f.dialog);
    await within(f.dialog).findByText(`已保存的创作流程上限：${v} 次。`);
  }
  assert.deepEqual(
    f.audit.writes.map((c) => c.input),
    [
      { expected_revision: 0, failure_limit: 0 },
      { expected_revision: 1, failure_limit: 1000 },
    ],
  );
  assert.equal(
    (await window.aijian.getGenerationFailurePolicy(`prj_${"a".repeat(32)}`)).policy.failure_limit,
    77,
  );
  unchanged(f);
});
it("default conflict really returns fresh revision and retains the draft until a second explicit PUT", async () => {
  const f = await open("story-policy-conflict");
  fill(f.dialog, "7");
  save(f.dialog);
  await within(f.dialog).findByText("设置已被修改，请核对已保存的值，再次提交你的创作流程上限。");
  assert.equal(within(f.dialog).getByRole("textbox").value, "7");
  assert.equal(f.audit.writes.length, 1);
  save(f.dialog);
  await within(f.dialog).findByText("已保存的创作流程上限：7 次。");
  assert.equal(f.audit.writes[1].input.expected_revision, 1);
  unchanged(f);
});
it("default unknown stays GET-only through an unresolved read then confirms without another PUT", async () => {
  const f = await open("story-policy-unknown");
  fill(f.dialog, "3");
  save(f.dialog);
  await within(f.dialog).findByText("创作流程上限的保存结果尚未确认，请重新核对。不要重复提交。");
  assert.equal(within(f.dialog).queryByRole("button", { name: "保存创作流程上限" }), null);
  refresh(f.dialog);
  await within(f.dialog).findByText("创作流程上限暂时没有读到，请重新核对。");
  assert.equal(f.audit.writes.length, 1);
  refresh(f.dialog);
  await within(f.dialog).findByText("已保存的创作流程上限：3 次。");
  assert.equal(f.audit.reads.length, 3);
  assert.equal(f.audit.writes.length, 1);
  unchanged(f);
});
it("default session actually holds a native PUT, permits real menu navigation, and retires account-held GET", async () => {
  const f = await open("story-policy-session");
  fill(f.dialog, "3");
  save(f.dialog);
  assert.equal(f.audit.pending.length, 1);
  assert.equal(f.audit.writes.length, 1);
  fireEvent.click(within(f.dialog).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "合成配置第2集" }));
  await screen.findByText("/ 合成配置第2集");
  await waitFor(() =>
    assert.notEqual(
      window.__proCreationAudit.record(f.seed.otherId).characters[0].gender,
      undefined,
    ),
  );
  const otherBefore = window.__proCreationAudit.record(f.seed.otherId);
  f.writeBaseline = f.audit.filmWrites.length;
  await act(async () => {
    f.audit.release(0);
  });
  const d = f.show();
  await within(d).findByText("尚未配置创作流程上限。");
  assert.equal(f.audit.reads.at(-1).projectId, `prj_${"b".repeat(32)}`);
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  f.audit.heldReads = true;
  f.show();
  assert.equal(f.audit.pending.length, 2);
  await act(async () => {
    window.dispatchEvent(new window.Event("aivora-grok-changed"));
  });
  await waitFor(() =>
    assert.equal(screen.queryByRole("dialog", { name: "创作流程失败保护" }), null),
  );
  f.audit.heldReads = false;
  await act(async () => {
    f.audit.release(1);
  });
  const next = f.show();
  await within(next).findByText("尚未配置创作流程上限。");
  assert.equal(f.audit.writes.length, 1);
  assert.deepEqual(window.__proCreationAudit.record(f.seed.otherId), otherBefore);
  unchanged(f);
});

it.each(["missing-id", "unsupported"])(
  "%s is genuinely unavailable, with zero policy/provider/project creation calls",
  async (mode) => {
    const f = await open("story-policy-values", mode);
    await within(f.dialog).findByText(
      mode === "missing-id"
        ? "本集尚未关联可配置的作品，不能保存创作流程上限。"
        : "当前环境不支持设置创作流程失败保护，请使用支持此功能的桌面版。",
    );
    assert.equal(within(f.dialog).queryByRole("button", { name: "保存创作流程上限" }), null);
    assert.deepEqual([f.audit.reads, f.audit.writes], [[], []]);
    unchanged(f);
  },
);
