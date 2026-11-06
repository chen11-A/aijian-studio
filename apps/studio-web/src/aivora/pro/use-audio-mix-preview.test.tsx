import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AudioMixPreviewResult } from "@aijian/contracts/film-audio-mix";
import { sampleFilm } from "../film/project";
import { useAudioMixPreview } from "./use-audio-mix-preview";
afterEach(() => {
  cleanup();
  delete window.aijian;
});
it("waits for the existing save lease and never probes until the current snapshot is actually stored", async () => {
  const film = sampleFilm();
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
  const film = sampleFilm();
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
  current = { ...film, title: "new input" };
  rerender({ value: current });
  read.mockResolvedValue({ ...current, id: "wrong-project" });
  await act(async () => finish({ kind: "FAILED", code: "TOOLS_UNAVAILABLE" }));
  await waitFor(() =>
    expect(result.current.result).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" }),
  );
  expect(result.current.busy).toBe(false);
  expect(preview).toHaveBeenCalledOnce();
});
