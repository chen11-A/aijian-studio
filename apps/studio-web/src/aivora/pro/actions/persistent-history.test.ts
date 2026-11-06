import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { historyRecordHash, historyEntryView } from "./persistent-history";
it("matches the main's stable SHA identity across Unicode, paths, numbers and differently ordered keys", async () => {
  const first = { z: [1, null, { 文: "台词\n/素材/片段.mp4", a: true }], a: { b: 2, a: "old" } },
    second = { a: { a: "old", b: 2 }, z: [1, null, { a: true, 文: "台词\n/素材/片段.mp4" }] };
  const expected = createHash("sha256")
    .update('{"a":{"a":"old","b":2},"z":[1,null,{"a":true,"文":"台词\\n/素材/片段.mp4"}]}')
    .digest("hex");
  expect(await historyRecordHash(first)).toBe(expected);
  expect(await historyRecordHash(second)).toBe(expected);
});
it("projects real time, whitelisted reason and counts without rendering internal identities", () => {
  const row = historyEntryView({
    id: "hst_" + "a".repeat(32),
    createdAt: "2026-11-05T10:11:12.000Z",
    reason: "before-restore",
    summary: { scenes: 2, shots: 4, done: 3 },
  });
  expect(row.why).toBe("恢复历史前保留的当前版本");
  expect(row.when).toMatch(/2026/);
  expect(row.summary).toBe("2 场 · 4 个镜头 · 3 个做好了");
  expect([row.when, row.why, row.summary].join()).not.toContain("hst_");
});
