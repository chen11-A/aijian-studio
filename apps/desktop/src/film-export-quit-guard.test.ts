import { expect, it, vi } from "vitest";
import { EXPORT_WRITING_MESSAGE } from "@aijian/contracts/film-export-qc";
import { createExportWriteGuard } from "./film-export-quit-guard";

it("blocks quit only while a folder write is in progress and then releases it", () => {
  const seen: unknown[] = [];
  const guard = createExportWriteGuard((activity) => seen.push(activity));
  expect(guard.refuseQuit()).toBeNull();
  expect(seen).toEqual([]);
  guard.setWriting(true);
  expect(guard.refuseQuit()).toEqual({
    writing: true,
    quitRefused: true,
    message: EXPORT_WRITING_MESSAGE,
  });
  guard.setWriting(false);
  expect(guard.writing()).toBe(false);
  expect(guard.refuseQuit()).toBeNull();
  expect(seen.at(-1)).toEqual({ writing: false });
});

it("ignores a notifier that has already gone away", () => {
  const guard = createExportWriteGuard(() => {
    throw new Error("window closed");
  });
  expect(() => guard.setWriting(true)).not.toThrow();
  expect(guard.writing()).toBe(true);
  expect(guard.refuseQuit()?.quitRefused).toBe(true);
});

it("does not notify again when the write flag is unchanged", () => {
  const notify = vi.fn();
  const guard = createExportWriteGuard(notify);
  guard.setWriting(false);
  guard.setWriting(true);
  guard.setWriting(true);
  expect(notify).toHaveBeenCalledTimes(1);
});
