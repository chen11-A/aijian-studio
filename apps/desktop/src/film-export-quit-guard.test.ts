import { expect, it, vi } from "vitest";
import { EXPORT_WRITING_MESSAGE } from "@aijian/contracts/film-export-qc";
import { createExportWriteGuard, isExportReloadShortcut } from "./film-export-quit-guard";

it("blocks quit only while a folder write is in progress and then releases it", () => {
  const seen: unknown[] = [];
  const guard = createExportWriteGuard((activity) => seen.push(activity));
  expect(guard.refuseQuit()).toBeNull();
  expect(seen).toEqual([]);
  guard.hold("one");
  expect(guard.refuseQuit()).toEqual({
    writing: true,
    quitRefused: true,
    message: EXPORT_WRITING_MESSAGE,
  });
  guard.release("one");
  expect(guard.writing()).toBe(false);
  expect(guard.refuseQuit()).toBeNull();
  expect(seen.at(-1)).toEqual({ writing: false });
});

it("keeps the guard while another export is still writing", () => {
  const guard = createExportWriteGuard(() => undefined);
  guard.hold("one");
  guard.hold("two");
  guard.release("one");
  expect(guard.writing()).toBe(true);
  expect(guard.refuseQuit()?.writing).toBe(true);
  guard.release("two");
  expect(guard.writing()).toBe(false);
  guard.release("two");
  expect(guard.writing()).toBe(false);
});

it("ignores a notifier that has already gone away", () => {
  const guard = createExportWriteGuard(() => {
    throw new Error("window closed");
  });
  expect(() => guard.hold("one")).not.toThrow();
  expect(guard.writing()).toBe(true);
  expect(guard.refuseQuit()?.quitRefused).toBe(true);
});

it("does not notify again when the same export is held twice", () => {
  const notify = vi.fn();
  const guard = createExportWriteGuard(notify);
  guard.hold("one");
  guard.hold("one");
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith({ writing: true, message: EXPORT_WRITING_MESSAGE });
});

it("recognizes reload and force-reload shortcuts", () => {
  expect(isExportReloadShortcut({ key: "F5", type: "keyDown" })).toBe(true);
  expect(isExportReloadShortcut({ key: "r", control: true, type: "keyDown" })).toBe(true);
  expect(isExportReloadShortcut({ key: "R", meta: true, type: "keyDown" })).toBe(true);
  expect(isExportReloadShortcut({ key: "r", control: true, type: "keyUp" })).toBe(false);
  expect(isExportReloadShortcut({ key: "s", control: true, type: "keyDown" })).toBe(false);
});
