import { filmAudioSourceIdentity } from "../film/audio-waveform-data";
import { audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import { historyRecordHash } from "./actions/persistent-history";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AudioMixPreviewResult } from "@aijian/contracts/film-audio-mix";
import { upgradeFilm, sampleFilm } from "../film/project";
import { useAudioMixPreview } from "./use-audio-mix-preview";
afterEach(() => {
  cleanup();
  delete window.aijian;
});
it("waits for the existing save lease and never probes until the current snapshot is actually stored", async () => {
  const film = upgradeFilm(sampleFilm())!;
  const save = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(film),
    preview = vi.fn().mockResolvedValue({ kind: "FAILED", code: "TOOLS_UNAVAILABLE" });
  window.aijian = {
    readFilmProject: vi.fn(async () => film),
    getFilmAudioMixPreview: preview,
  } as unknown as Window["aijian"];
  const { result } = renderHook(() =>
    useAudioMixPreview(film, true, { current: () => film, save }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(preview).not.toHaveBeenCalled();
  await waitFor(() => expect(preview).toHaveBeenCalledOnce());
  expect(result.current.busy).toBe(false);
});
it("rejects a late trusted plan after a newer edit and exposes a wrong-project read without remaining busy", async () => {
  const film = upgradeFilm(sampleFilm())!;
  let current = film,
    finish!: (result: AudioMixPreviewResult) => void;
  const preview = vi.fn(
    () =>
      new Promise<AudioMixPreviewResult>((resolve) => {
        finish = resolve;
      }),
  );
  const read = vi.fn(async () => current);
  window.aijian = {
    readFilmProject: read,
    getFilmAudioMixPreview: preview,
  } as unknown as Window["aijian"];
  const host = { current: () => current, save: vi.fn(async () => current) };
  const { result, rerender } = renderHook(({ value }) => useAudioMixPreview(value, true, host), {
    initialProps: { value: film },
  });
  await waitFor(() => expect(preview).toHaveBeenCalledOnce());
  const changedMix = audioMixSettings(film.audioMix);
  changedMix.lanes.score.gainDb = -6;
  current = { ...film, audioMix: changedMix };
  rerender({ value: current });
  read.mockResolvedValue({ ...current, id: "wrong-project" });
  await act(async () => finish({ kind: "FAILED", code: "TOOLS_UNAVAILABLE" }));
  await waitFor(() =>
    expect(result.current.result).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" }),
  );
  expect(result.current.busy).toBe(false);
  expect(preview).toHaveBeenCalledOnce();
});

it("uses only the latest live object for a delayed metadata save and keeps the same-input view after assembly adoption", async () => {
  let current = upgradeFilm(sampleFilm())!,
    disk = structuredClone(current),
    release!: () => void;
  const hold = new Promise<void>((done) => {
      release = done;
    }),
    written: (typeof current)[] = [];
  let saves = 0;
  const save = vi.fn(async (snapshot: typeof current, guard: () => boolean) => {
    if (++saves === 1) await hold;
    if (!guard()) return null;
    disk = structuredClone(snapshot);
    written.push(snapshot);
    return structuredClone(disk);
  });
  const preview = vi.fn(async (input: { expectedHash: string }) => {
    expect(input.expectedHash).toBe(await historyRecordHash(disk));
    return { kind: "FAILED", code: "TOOLS_UNAVAILABLE" };
  });
  window.aijian = {
    readFilmProject: vi.fn(async () => structuredClone(disk)),
    getFilmAudioMixPreview: preview,
  } as unknown as Window["aijian"];
  const { result, rerender } = renderHook(
    ({ value }) => useAudioMixPreview(value, true, { current: () => current, save }),
    { initialProps: { value: current } },
  );
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  current = {
    ...current,
    title: "latest metadata",
    assemblyPath: "/private/new.mp4",
    assemblyUrl: "aijian-media:///private/new.mp4",
  };
  rerender({ value: current });
  await act(async () => release());
  await waitFor(() => expect(preview).toHaveBeenCalledOnce());
  expect(written).toEqual([current]);
  expect(disk.title).toBe("latest metadata");
  expect(result.current).toMatchObject({
    busy: false,
    settled: true,
    result: { kind: "FAILED", code: "TOOLS_UNAVAILABLE" },
  });
  current = { ...current, assemblyPath: "/private/another.mp4" };
  rerender({ value: current });
  expect(result.current).toMatchObject({
    busy: false,
    settled: true,
    result: { kind: "FAILED", code: "TOOLS_UNAVAILABLE" },
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(preview).toHaveBeenCalledOnce();
});
it("rechecks a changed consumed input and explicit retry with fresh raw hashes, but never requests a mismatched canonical projection", async () => {
  let current = upgradeFilm(sampleFilm())!,
    disk = structuredClone(current);
  const preview = vi.fn(async (input: { expectedHash: string }) => {
    expect(input.expectedHash).toBe(await historyRecordHash(disk));
    return { kind: "FAILED", code: "TOOLS_UNAVAILABLE" };
  });
  const read = vi.fn(async () => structuredClone(disk));
  window.aijian = {
    readFilmProject: read,
    getFilmAudioMixPreview: preview,
  } as unknown as Window["aijian"];
  const save = vi.fn(async (snapshot: typeof current, guard: () => boolean) => {
    if (!guard()) return null;
    disk = structuredClone(snapshot);
    return structuredClone(disk);
  });
  const { result, rerender } = renderHook(
    ({ value }) => useAudioMixPreview(value, true, { current: () => current, save }),
    { initialProps: { value: current } },
  );
  await waitFor(() => expect(preview).toHaveBeenCalledOnce());
  const changedMix = audioMixSettings(current.audioMix);
  changedMix.lanes.score.gainDb = -6;
  current = { ...current, audioMix: changedMix };
  rerender({ value: current });
  expect(result.current.result).toBeNull();
  expect(result.current.settled).toBe(false);
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  await act(async () => result.current.retry?.());
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(3));
  read.mockImplementation(async () => {
    const externalMix = audioMixSettings(disk.audioMix);
    externalMix.lanes.score.gainDb = -12;
    return { ...disk, audioMix: externalMix };
  });
  await act(async () => result.current.retry?.());
  await waitFor(() =>
    expect(result.current.result).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" }),
  );
  expect(preview).toHaveBeenCalledTimes(3);
});

it("rechecks changed measured bytes with fresh main inputs while same-source peaks do not reopen admission", async () => {
  let current = upgradeFilm(sampleFilm())!;
  current.audioClips = [
    {
      id: "score",
      lane: "score",
      shotId: "",
      takeId: "",
      label: "Music",
      path: "/trusted/music.wav",
      startSeconds: 0,
      durationSeconds: 2,
      offsetSeconds: 0,
      gainDb: 0,
    },
  ];
  const clip = current.audioClips[0]!;
  clip.waveform = {
    schemaVersion: 1,
    sourceKey: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    identity: filmAudioSourceIdentity(current, clip),
    offsetSeconds: 0,
    durationSeconds: 2,
    analyzedSeconds: 2,
    peaks: [0.1, 0.2],
  };
  let disk = structuredClone(current);
  const preview = vi.fn(async (input: { expectedHash: string }) => {
    expect(input.expectedHash).toBe(await historyRecordHash(disk));
    return { kind: "FAILED", code: "TOOLS_UNAVAILABLE" };
  });
  window.aijian = {
    readFilmProject: vi.fn(async () => structuredClone(disk)),
    getFilmAudioMixPreview: preview,
  } as unknown as Window["aijian"];
  const save = async (snapshot: typeof current, guard: () => boolean) => {
    if (!guard()) return null;
    disk = structuredClone(snapshot);
    return structuredClone(disk);
  };
  const { result, rerender } = renderHook(
    ({ value }) => useAudioMixPreview(value, true, { current: () => current, save }),
    { initialProps: { value: current } },
  );
  await waitFor(() => expect(preview).toHaveBeenCalledOnce());
  current = {
    ...current,
    audioClips: current.audioClips.map((c) => ({
      ...c,
      waveform: { ...c.waveform!, peaks: [0.3, 0.4] },
    })),
  };
  rerender({ value: current });
  expect(result.current.settled).toBe(true);
  expect(preview).toHaveBeenCalledOnce();
  current = {
    ...current,
    audioClips: current.audioClips.map((c) => ({
      ...c,
      waveform: { ...c.waveform!, sourceSha256: "c".repeat(64) },
    })),
  };
  rerender({ value: current });
  expect(result.current.settled).toBe(false);
  expect(result.current.result).toBeNull();
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  expect(preview.mock.calls[0]![0].expectedHash).not.toBe(preview.mock.calls[1]![0].expectedHash);
});
