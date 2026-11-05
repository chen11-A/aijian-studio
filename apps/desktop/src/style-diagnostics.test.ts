import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { styleDiagnostics } from "./style-diagnostics";
import { createAgentLog } from "./agent-log";
import { registerStoryFilmHandlers } from "./story-film-ipc";

const style = "冷色雨夜🌧️\n柔和阴影";
const block = `【画风说明】\n${style}\n【画风说明结束】`;
const expected = {
  styleCharacters: Array.from(style).length,
  styleSha256: createHash("sha256").update(style).digest("hex"),
};
it("hashes exact style bytes independently of private scene text", () => {
  expect(styleDiagnostics(`秘密甲\n${block}`)).toEqual(expected);
  expect(styleDiagnostics(`秘密乙\n${block}`)).toEqual(expected);
  expect(styleDiagnostics("plain private text")).toEqual({ styleCharacters: 0 });
  expect(styleDiagnostics(`${block}\n${block}`)).toEqual({ styleCharacters: 0 });
  expect(styleDiagnostics("【画风说明】\nincomplete")).toEqual({ styleCharacters: 0 });
});
it("persists only numeric length and validated SHA256", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "style-log-")), "agents.log");
  const log = createAgentLog(path);
  log.write({
    ...expected,
    agent: "video",
    model: "grok-imagine-video",
    endpoint: "video-submit",
    httpStatus: 0,
    body: block,
  });
  await vi.waitFor(async () =>
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject(expected),
  );
  expect(await readFile(path, "utf8")).not.toContain(style);
  log.write({
    styleCharacters: Number.NaN,
    styleSha256: "private secret",
    model: "grok-test",
    endpoint: "text",
    httpStatus: 0,
  });
  await vi.waitFor(async () => {
    const rows = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ styleCharacters: 0 });
    expect(rows[1]).not.toHaveProperty("styleSha256");
  });
});
it("logs each actual subscription submission shot, never rejected sender or stub", async () => {
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  const log = vi.fn();
  const fetcher = vi.fn(async () =>
    Response.json({
      data: { status: "BLOCKED" },
      request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    }),
  );
  registerStoryFilmHandlers(
    (name, handler) => handlers.set(name, handler),
    (event: boolean) => event,
    () => ({ origin: "http://127.0.0.1:56121", token: "s".repeat(43) }),
    async () => null,
    fetcher,
    undefined,
    log,
  );
  const input = {
    scene_label: "private",
    narration: "private",
    confirmed: false,
    provider: "grok_subscription",
    shots: ["scene one", "scene two"].map((scene) => ({
      narration: scene,
      prompt: `${scene}\n${block}`,
      duration_seconds: 5,
    })),
  };
  const create = handlers.get("story-film:create")!;
  const id = `prj_${"a".repeat(32)}`;
  await expect(create(false, id, input)).rejects.toThrow("not authorized");
  expect(log).not.toHaveBeenCalled();
  await create(true, id, input);
  expect(log.mock.calls).toEqual([[expected], [expected]]);
  await create(true, id, { ...input, provider: "stub" });
  expect(log).toHaveBeenCalledTimes(2);
});
