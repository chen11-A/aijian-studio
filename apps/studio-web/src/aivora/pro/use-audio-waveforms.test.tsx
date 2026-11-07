import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sampleFilm, upgradeFilm, type FilmProject } from "../film/project";
import { useAudioWaveforms } from "./use-audio-waveforms";
afterEach(() => {
  cleanup();
  delete window.aijian;
});
function fixture() {
  let current = upgradeFilm(sampleFilm())!,
    disk = structuredClone(current);
  current.audioClips = [
    {
      id: "one",
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
  disk = structuredClone(current);
  const releases: (() => void)[] = [];
  const read = vi.fn(async () => {
    await new Promise<void>((done) => releases.push(done));
    return { kind: "EMPTY", code: "NO_AUDIO" };
  });
  window.aijian = {
    readFilmProject: vi.fn(async () => structuredClone(disk)),
    readFilmAudioWaveform: read,
  } as unknown as Window["aijian"];
  const host = {
    current: () => current,
    apply: (film: FilmProject) => {
      current = film;
    },
    save: async (film: FilmProject) => {
      if (current !== film) return null;
      disk = structuredClone(film);
      return structuredClone(disk);
    },
  };
  return {
    current: () => current,
    set: (next: FilmProject) => {
      current = next;
    },
    host,
    read,
    releases,
    releaseAll: () => releases.forEach((done) => done()),
  };
}
it("keeps primed admission during a controlled same-source refresh while the new waveform remains unsettled", async () => {
  const f = fixture();
  const { result } = renderHook(() => useAudioWaveforms(f.current(), true, f.host));
  try {
    expect(result.current.primed).toBe(false);
    await waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    await act(async () => f.releases[0]!());
    await waitFor(() => expect(result.current.primed).toBe(true));
    await act(async () => result.current.refresh());
    await waitFor(() => expect(f.read).toHaveBeenCalledTimes(2));
    expect(result.current).toMatchObject({ primed: true, settled: false, busy: true });
    await act(async () => f.releases[1]!());
    await waitFor(() => expect(result.current.settled).toBe(true));
  } finally {
    await act(async () => f.releaseAll());
  }
});
it("requires a new first waveform on every edit visit and cannot borrow a prior source's prime when switching away and back", async () => {
  const f = fixture();
  const { result, rerender } = renderHook(
    ({ active, value }) => useAudioWaveforms(value, active, f.host),
    { initialProps: { active: true, value: f.current() } },
  );
  try {
    await waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    await act(async () => f.releases[0]!());
    await waitFor(() => expect(result.current.primed).toBe(true));
    rerender({ active: false, value: f.current() });
    rerender({ active: true, value: f.current() });
    expect(result.current.primed).toBe(false);
    await waitFor(() => expect(f.read).toHaveBeenCalledTimes(2));
    await act(async () => f.releases[1]!());
    await waitFor(() => expect(result.current.primed).toBe(true));
    const original = f.current();
    f.set({
      ...original,
      audioClips: original.audioClips.map((c) => ({ ...c, path: "/trusted/other.wav" })),
    });
    rerender({ active: true, value: f.current() });
    expect(result.current.primed).toBe(false);
    await waitFor(() => expect(f.read).toHaveBeenCalledTimes(3));
    f.set(original);
    rerender({ active: true, value: f.current() });
    expect(result.current.primed).toBe(false);
    await waitFor(() => expect(f.read).toHaveBeenCalledTimes(4));
    await act(async () => f.releases[2]!());
    expect(result.current.primed).toBe(false);
    await act(async () => f.releases[3]!());
    await waitFor(() => expect(result.current.primed).toBe(true));
  } finally {
    await act(async () => f.releaseAll());
  }
});
it("does not prime another project from a late old-project waveform", async () => {
  const f = fixture();
  const { result, rerender } = renderHook(({ value }) => useAudioWaveforms(value, true, f.host), {
    initialProps: { value: f.current() },
  });
  try {
    await waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    f.set({ ...f.current(), id: "film_cccccccccccccccc" });
    rerender({ value: f.current() });
    expect(result.current.primed).toBe(false);
    await waitFor(() => expect(f.read).toHaveBeenCalledTimes(2));
    await act(async () => f.releases[0]!());
    expect(result.current.primed).toBe(false);
    await act(async () => f.releases[1]!());
    await waitFor(() => expect(result.current.primed).toBe(true));
  } finally {
    await act(async () => f.releaseAll());
  }
});
