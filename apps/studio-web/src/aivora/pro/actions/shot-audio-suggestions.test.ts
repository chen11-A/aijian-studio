import { beforeEach, expect, it, vi } from "vitest";
import type { SuggestBundledFilmShotAudioInput } from "@aijian/contracts/film-audio-library";
import { upgradeFilm } from "../../film/project";
import { createFilmPersistence } from "../film-persistence";
import {
  deferred,
  soundFilm,
  soundPlan,
  type SoundReply,
} from "../shot-audio-suggestions.test-fixture";
import { historyRecordHash } from "./persistent-history";
import {
  readShotAudioSuggestions,
  shotAudioInputKey,
  validShotAudioPlan,
} from "./shot-audio-suggestions";
import type { LibrarySelection } from "./audio-library";
beforeEach(() => {
  delete window.aijian;
});
function setup() {
  let live = soundFilm(),
    raw: Record<string, unknown> = structuredClone(live) as unknown as Record<string, unknown>;
  let selection: LibrarySelection = {
    projectId: live.id,
    page: "edit",
    shotId: live.shots[0]!.id,
    takeId: live.shots[0]!.selectedTakeId!,
  };
  const write = vi.fn(async (value: typeof live) => {
    raw = {
      ...structuredClone(value),
      savedAt: "saved-on-disk",
      assemblyUrl: "aivora-media://native/preview.mp4",
    };
    return upgradeFilm(raw)!;
  });
  const persistence = createFilmPersistence({ current: () => live, write });
  const read = vi.fn(async () => structuredClone(raw));
  const suggest = vi.fn(async (input: SuggestBundledFilmShotAudioInput): Promise<SoundReply> => {
    expect(Object.keys(input).sort()).toEqual([
      "expectedProjectHash",
      "projectId",
      "shotId",
      "takeId",
    ]);
    expect(input.expectedProjectHash).toBe(await historyRecordHash(raw));
    return soundPlan(input);
  });
  window.aijian = {
    readFilmProject: read,
    suggestBundledFilmShotAudio: suggest,
  } as unknown as Window["aijian"];
  const host = { current: () => live, selection: () => selection, persistence };
  return {
    host,
    write,
    read,
    suggest,
    persistence,
    get live() {
      return live;
    },
    get raw() {
      return raw;
    },
    setRaw: (value: Record<string, unknown>) => {
      raw = value;
    },
    setLive: (value: typeof live) => {
      live = value;
    },
    setSelection: (value: LibrarySelection) => {
      selection = value;
    },
  };
}
it("uses full raw canonical hash, preserves exact plan and clips, and never adopts metadata into live", async () => {
  const f = setup(),
    before = structuredClone(f.live),
    result = await readShotAudioSuggestions(f.host, () => true);
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw Error("missing plan");
  expect(result.plan.clips).toHaveLength(4);
  expect(result.plan.clips[0]!.placement.startSeconds).toBe(0.123456789);
  expect(f.live).toEqual(before);
  expect(f.write).toHaveBeenCalledOnce();
  expect(f.suggest).toHaveBeenCalledOnce();
  expect(await historyRecordHash(f.raw)).not.toBe(await historyRecordHash(upgradeFilm(f.raw)));
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it("releases the real save lease before a held read-only RPC and review, allowing quit flush", async () => {
  const f = setup(),
    hold = deferred<SoundReply>();
  f.suggest.mockImplementationOnce(() => hold.promise);
  const run = readShotAudioSuggestions(f.host, () => true);
  await vi.waitFor(() => expect(f.suggest).toHaveBeenCalledOnce());
  expect((await f.persistence.flushAll()).status).toBe("saved");
  const lease = await f.persistence.acquire(f.live.id);
  await lease.release();
  hold.resolve(soundPlan(f.suggest.mock.calls[0]![0]));
  expect((await run).kind).toBe("ready");
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it("a failed preflight never calls native suggest and leaves real save failure visible to quit", async () => {
  const f = setup();
  f.write.mockRejectedValue(Error("PRIVATE_DISK_PATH"));
  expect(await readShotAudioSuggestions(f.host, () => true)).toMatchObject({
    kind: "failed",
    message: expect.stringContaining("没保存上"),
  });
  expect(f.suggest).not.toHaveBeenCalled();
  expect((await f.persistence.flushAll()).status).toBe("failed");
});
it("retries once only for proved save metadata drift, using fresh raw CAS and no extra writes", async () => {
  const f = setup();
  f.suggest.mockImplementationOnce(async () => {
    f.setRaw({ ...f.raw, savedAt: "new-time", directory: "/trusted/materialized" });
    return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
  });
  const result = await readShotAudioSuggestions(f.host, () => true);
  expect(result).toMatchObject({ kind: "ready", attempts: 2 });
  expect(f.suggest).toHaveBeenCalledTimes(2);
  expect(f.write).toHaveBeenCalledOnce();
  expect(f.suggest.mock.calls[0]![0].expectedProjectHash).not.toBe(
    f.suggest.mock.calls[1]![0].expectedProjectHash,
  );
});
it("does not authorize creative raw drift or loop on repeated CAS failure", async () => {
  const f = setup();
  f.suggest.mockImplementationOnce(async () => {
    f.setRaw({ ...f.raw, title: "another author edit" });
    return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
  });
  expect((await readShotAudioSuggestions(f.host, () => true)).kind).toBe("failed");
  expect(f.suggest).toHaveBeenCalledOnce();
  const g = setup();
  let savedVersion = 0;
  g.suggest.mockImplementation(async () => {
    g.setRaw({ ...g.raw, savedAt: String(++savedVersion) });
    return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
  });
  expect((await readShotAudioSuggestions(g.host, () => true)).kind).toBe("failed");
  expect(g.suggest).toHaveBeenCalledTimes(2);
});
it.each(["creative", "take", "project", "page", "closed"])(
  "drops a late reply after %s change",
  async (change) => {
    const f = setup(),
      hold = deferred<SoundReply>();
    f.suggest.mockImplementationOnce(() => hold.promise);
    let current = true;
    const run = readShotAudioSuggestions(f.host, () => current);
    await vi.waitFor(() => expect(f.suggest).toHaveBeenCalledOnce());
    if (change === "creative")
      f.setLive({
        ...f.live,
        shots: f.live.shots.map((s, i) => (i ? s : { ...s, action: "changed" })),
      });
    if (change === "take")
      f.setLive({
        ...f.live,
        shots: f.live.shots.map((s, i) => (i ? s : { ...s, selectedTakeId: s.takes[1]!.id })),
      });
    if (change === "project") f.setLive({ ...f.live, id: "other-project" });
    if (change === "page") f.setSelection({ ...f.host.selection(), page: "board" });
    if (change === "closed") current = false;
    hold.resolve(soundPlan(f.suggest.mock.calls[0]![0]));
    expect(await run).toEqual({ kind: "stale" });
  },
);
it("save metadata alone keeps the display input binding; creative/source/mix changes do not", () => {
  const f = setup(),
    key = shotAudioInputKey(f.live, f.host.selection());
  expect(
    shotAudioInputKey(
      { ...f.live, savedAt: "tomorrow", directory: "elsewhere" },
      f.host.selection(),
    ),
  ).toBe(key);
  for (const next of [
    { ...f.live, styleZh: "different" },
    {
      ...f.live,
      shots: f.live.shots.map((s, i) =>
        i
          ? s
          : { ...s, takes: s.takes.map((t, j) => (j ? t : { ...t, videoPath: "/changed.mp4" })) },
      ),
    },
  ])
    expect(shotAudioInputKey(next, f.host.selection())).not.toBe(key);
});
it.each(["empty", "limit", "library", "transport", "invalid"])(
  "returns finite safe %s outcome and can be explicitly reread",
  async (mode) => {
    const f = setup();
    f.suggest.mockImplementationOnce(async (input) => {
      if (mode === "empty") return { ...soundPlan(input), clips: [] };
      if (mode === "transport") throw Error("PRIVATE_TOKEN_PATH");
      if (mode === "invalid")
        return {
          ...soundPlan(input),
          clips: [
            {
              ...soundPlan(input).clips[0]!,
              placement: { ...soundPlan(input).clips[0]!.placement, durationSeconds: NaN },
            },
          ],
        };
      return {
        kind: "FAILED",
        code: mode === "limit" ? "PLAN_UNSUPPORTED" : "LIBRARY_UNAVAILABLE",
        unchanged: true,
        ...(mode === "limit"
          ? { reason: "TRACK_LIMIT", maxSegments: 128, minimumRequiredSegments: 129 }
          : {}),
      };
    });
    const result = await readShotAudioSuggestions(f.host, () => true);
    expect(result.kind).toBe(mode === "empty" ? "ready" : "failed");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(f.suggest).toHaveBeenCalledOnce();
    expect((await readShotAudioSuggestions(f.host, () => true)).kind).toBe("ready");
  },
);
it("rejects a whole malformed plan without filtering segments or silently normalizing envelopes", () => {
  const input = { projectId: "p", shotId: "s", takeId: "t", expectedProjectHash: "e".repeat(64) },
    p = soundPlan(input);
  expect(validShotAudioPlan(p, input)).toBe(true);
  const bad = [
    { ...p, takeId: "other" },
    { ...p, clips: Array.from({ length: 129 }, (_, i) => ({ ...p.clips[0]!, key: String(i) })) },
    { ...p, clips: [{ ...p.clips[0]!, envelope: { schemaVersion: 1, baseGainDb: Infinity } }] },
    { ...p, warnings: [{ code: "UNKNOWN", message: "raw" }] },
    { ...p, clips: [p.clips[0], p.clips[0]] },
  ];
  for (const value of bad) expect(validShotAudioPlan(value, input)).toBe(false);
});
