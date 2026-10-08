import { describe, expect, it } from "vitest";
import {
  readSourceImportMarker as read,
  writeSourceImportMarker as write,
  clearSourceImportMarker as clear,
  type SourceImportMarker,
} from "./sourceImportJournal";
const project = `prj_${"1".repeat(32)}`,
  other = `prj_${"2".repeat(32)}`;
const marker: SourceImportMarker = {
  operationId: "123e4567-e89b-42d3-a456-426614174000",
  rawSha256: "a".repeat(64),
  filename: "中文.txt",
  sourceId: null,
  state: "PENDING",
};
function storage(map = new Map<string, string>()) {
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
describe("source import journal independent boundaries", () => {
  it("retains UNKNOWN across a new storage wrapper and isolates projects", () => {
    const map = new Map<string, string>();
    const s = storage(map);
    expect(write(s, project, marker)).toBe(true);
    expect(write(s, project, { ...marker, state: "UNKNOWN" })).toBe(true);
    expect(read(storage(map), project)).toEqual({
      kind: "READY",
      marker: { ...marker, state: "UNKNOWN" },
    });
    expect(read(s, other)).toEqual({ kind: "READY", marker: null });
    expect(write(s, project, marker)).toBe(false);
  });
  it("rejects identity drift and stale clear without deleting a newer operation", () => {
    const s = storage();
    expect(write(s, project, marker)).toBe(true);
    expect(write(s, project, { ...marker, rawSha256: "b".repeat(64) })).toBe(false);
    expect(clear(s, project, marker.operationId)).toBe(true);
    const next = { ...marker, operationId: "123e4567-e89b-42d3-a456-426614174001" };
    expect(write(s, project, next)).toBe(true);
    expect(clear(s, project, marker.operationId)).toBe(false);
    expect(read(s, project)).toEqual({ kind: "READY", marker: next });
  });
  it("fails closed on corrupt data and storage exceptions", () => {
    const s = storage();
    s.setItem(`aivora.source-import.v1:${project}`, "{broken");
    expect(read(s, project)).toEqual({ kind: "CORRUPT" });
    expect(write(s, project, marker)).toBe(false);
    expect(clear(s, project, marker.operationId)).toBe(false);
    const fail = () => {
      throw Error("storage unavailable");
    };
    expect(read({ getItem: fail }, project)).toEqual({ kind: "UNAVAILABLE" });
    expect(write({ getItem: () => null, setItem: fail }, project, marker)).toBe(false);
    const good = storage();
    write(good, project, marker);
    expect(clear({ ...good, removeItem: fail }, project, marker.operationId)).toBe(false);
    expect(read(good, project)).toEqual({ kind: "READY", marker });
  });
});
