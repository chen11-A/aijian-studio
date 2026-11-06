import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import type { FilmHistoryGateway } from "@aijian/contracts/film-history";
import { registerFilmHistory } from "./film-history-ipc";
import { filmHistoryRecordHash } from "./film-history";
import { writeProject, readProject } from "./film-library";
it("runs actual preload to authorized IPC and real append/list/restore files after bridge restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "history-bridge-"));
  try {
    const film = await writeProject(root, {
      id: "film_historybridge001",
      seriesId: "film_historyseries001",
      title: "baseline",
      scenes: [],
      shots: [],
    });
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    registerFilmHistory<boolean>(
      (name, handler) => handlers.set(name, handler),
      (allowed) => allowed,
      root,
    );
    await expect(handlers.get("film:history-list")!(false, film.id)).rejects.toThrow(
      "not authorized",
    );
    await expect(handlers.get("film:history-capture")!(true, {}, "path")).rejects.toThrow(
      "Invalid",
    );
    const bridge = () => {
      let value!: FilmHistoryGateway;
      runInNewContext(
        ts.transpileModule(readFileSync(resolve("src/preload.ts"), "utf8"), {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText,
        {
          exports: {},
          require: (name: string) => {
            expect(name).toBe("electron");
            return {
              contextBridge: {
                exposeInMainWorld: (_name: string, api: FilmHistoryGateway) => {
                  value = api;
                },
              },
              ipcRenderer: {
                invoke: (channel: string, ...args: unknown[]) =>
                  handlers.get(channel)!(true, ...args),
              },
            };
          },
        },
      );
      return value;
    };
    const captured = await bridge().captureFilmHistory({
      projectId: film.id,
      expectedHash: filmHistoryRecordHash(film),
      reason: "manual",
    });
    expect(captured.kind).toBe("CAPTURED");
    if (captured.kind !== "CAPTURED") throw new Error("not captured");
    const restart = bridge();
    expect(await restart.listFilmHistory(film.id)).toMatchObject({
      kind: "LIST",
      entries: [captured.entry],
    });
    const changed = await writeProject(root, { ...film, title: "after" });
    const restored = await restart.restoreFilmHistory({
      projectId: film.id,
      historyId: captured.entry.id,
      expectedHash: filmHistoryRecordHash(changed),
    });
    expect(restored.kind).toBe("RESTORED");
    expect((await readProject(root, film.id))!.title).toBe("baseline");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
