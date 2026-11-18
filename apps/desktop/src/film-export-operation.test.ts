import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createExportOperations } from "./film-export-operation";
import { loadQcRunner } from "./film-export-qc-runtime";
import { copyExportFile } from "./film-export-io";
import type { FilmExportProgressEvent } from "@aijian/contracts/film-export-qc";
const roots: string[] = [];
async function root() {
  const value = await mkdtemp(join(tmpdir(), "export-operation-"));
  roots.push(value);
  return value;
}
afterEach(async () => {
  for (const value of roots.splice(0)) await rm(value, { recursive: true, force: true });
});
describe("real export operation lifetime", () => {
  it("does not confirm stopped until a real child exits and private state is cleaned", async () => {
    const folder = await root(),
      pidPath = join(folder, "pid"),
      staged = join(folder, "incomplete.mp4");
    await writeFile(staged, "partial");
    const events: FilmExportProgressEvent[] = [];
    const operations = createExportOperations((_owner, event) => events.push(event));
    const operation = operations.begin("owner", "film-project", "operation-one")!;
    const runner = await loadQcRunner(resolve("../../packages/aivora-qc"));
    const code =
      "const fs=require('node:fs');fs.writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),150));setInterval(()=>{},1000);";
    const child = operation.work.track(
      runner(process.execPath, ["-e", code, pidPath], {
        signal: operation.work.signal,
        timeoutMs: 10000,
      }),
    );
    const outcome = child.catch((error) => error);
    await expect
      .poll(async () => {
        try {
          return Number(await readFile(pidPath, "utf8"));
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(0);
    const pid = Number(await readFile(pidPath, "utf8"));
    expect(operations.cancel("other", "operation-one").kind).toBe("NOT_FOUND");
    const ack = operations.cancel("owner", "operation-one");
    expect(ack.kind).toBe("REQUESTED");
    expect(ack.snapshot?.cancelState).toBe("requested");
    expect(events.at(-1)?.cancelState).toBe("requested");
    expect((await outcome).code).toBe("ABORT_ERR");
    expect(() => process.kill(pid, 0)).toThrow();
    expect(events.at(-1)?.cancelState).toBe("requested");
    await rm(staged);
    await operation.finish("failed");
    expect(events.at(-1)?.cancelState).toBe("stopped");
    await expect(stat(staged)).rejects.toThrow();
    expect(operations.cancel("owner", "operation-one").kind).toBe("STOPPED");
  }, 15000);
  it("rejects stop during a commit but accepts a new request at the next cancellable copy", async () => {
    const events: FilmExportProgressEvent[] = [];
    const manager = createExportOperations((_owner, event) => events.push(event));
    const op = manager.begin("owner", "project", "execution")!;
    op.work.phase("publishing");
    op.work.cancellable(false);
    const denied = manager.cancel("owner", "execution");
    expect(denied.kind).toBe("UNAVAILABLE");
    expect(op.work.signal.aborted).toBe(false);
    op.work.published("16:9");
    op.work.cancellable(true);
    const accepted = manager.cancel("owner", "execution");
    expect(accepted.kind).toBe("REQUESTED");
    expect(accepted.snapshot!.seq).toBeGreaterThan(denied.snapshot!.seq);
    op.work.cancellable(false);
    expect(events.at(-1)?.cancelState).toBe("requested");
    await op.finish("partial");
    expect(events.at(-1)).toMatchObject({
      phase: "partial",
      cancelState: "stopped",
      published: [{ aspectRatio: "16:9", label: "横屏成片" }],
    });
    expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index + 1));
    expect(manager.begin("owner", "project", "execution")).toBeNull();
    expect(manager.begin("owner", "project", "new-execution")).not.toBeNull();
  });
  it("does not accept a late stop after work has determined its result while tracked closures drain", async () => {
    const manager = createExportOperations(() => undefined);
    const operation = manager.begin("owner", "project", "draining")!;
    let release!: () => void;
    operation.work.track(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const finishing = operation.finish("completed");
    expect(manager.cancel("owner", "draining").kind).toBe("UNAVAILABLE");
    expect(operation.work.signal.aborted).toBe(false);
    release();
    await finishing;
    expect(manager.cancel("owner", "draining").snapshot).toMatchObject({
      phase: "completed",
      cancelState: "unavailable",
    });
  });
  it("aborts actual stream copies, waits for descriptors, and leaves source bytes unchanged", async () => {
    const folder = await root(),
      source = join(folder, "source"),
      target = join(folder, "partial");
    const bytes = Buffer.alloc(4 * 1024 * 1024, 7);
    await writeFile(source, bytes);
    const controller = new AbortController();
    const copying = copyExportFile(source, target, controller.signal);
    controller.abort();
    await expect(copying).rejects.toThrow();
    expect(
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    ).toBe(createHash("sha256").update(bytes).digest("hex"));
    await rm(target, { force: true });
  });
});

it("retracts an announced aspect from the published progress list", () => {
  const events: FilmExportProgressEvent[] = [];
  const manager = createExportOperations((_owner, event) => events.push(structuredClone(event)));
  const op = manager.begin("owner", "project", "retract-aspect")!;
  op.work.published("16:9");
  expect(events.at(-1)?.published).toEqual([{ aspectRatio: "16:9", label: "横屏成片" }]);
  op.work.retract("16:9");
  expect(events.at(-1)?.published).toEqual([]);
});

it("does not confirm stopped when private cleanup could not be established", async () => {
  const events: FilmExportProgressEvent[] = [];
  const manager = createExportOperations((_owner, event) => events.push(event));
  const op = manager.begin("owner", "project", "unclean")!;
  expect(manager.cancel("owner", "unclean").kind).toBe("REQUESTED");
  await op.finish("unknown", false);
  expect(events.at(-1)).toMatchObject({ phase: "unknown", cancelState: "unavailable" });
  expect(manager.cancel("owner", "unclean").kind).toBe("UNAVAILABLE");
});

it("does not confirm stopped when main-owned cleanup is explicitly unconfirmed", async () => {
  const events: FilmExportProgressEvent[] = [];
  const operations = createExportOperations((_owner, value) => events.push(value));
  const operation = operations.begin("owner", "project", "cleanup-unconfirmed");
  if (!operation) throw new Error("operation required");
  expect(operations.cancel("owner", "cleanup-unconfirmed").kind).toBe("REQUESTED");
  operation.work.cleanupUnconfirmed?.();
  await operation.finish("partial");
  expect(events.at(-1)).toMatchObject({ phase: "partial", cancelState: "unavailable" });
  expect(operations.cancel("owner", "cleanup-unconfirmed")).toMatchObject({
    kind: "UNAVAILABLE",
    snapshot: { cancelState: "unavailable" },
  });
});
