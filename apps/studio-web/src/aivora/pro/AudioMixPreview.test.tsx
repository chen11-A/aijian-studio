import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildAudioMixPlan } from "@aijian/contracts/film-audio-mix-plan";
import type { AudioMixPreviewResult } from "@aijian/contracts/film-audio-mix";
import { AudioMixPreview } from "./AudioMixPreview";
afterEach(() => {
  cleanup();
  delete window.aijian;
  vi.unstubAllGlobals();
});
function fixture() {
  let frame: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const sources: {
    buffer: { label: number } | null;
    loop?: boolean;
    loopStart?: number;
    loopEnd?: number;
    playbackRate: { value: number };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const gains: {
    gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    state: "running",
    destination: {},
    close: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => ({
      label: new Uint8Array(bytes)[0],
      duration: 8,
      length: 384000,
      numberOfChannels: 1,
    })),
    createBufferSource: vi.fn(() => {
      const value = {
        buffer: null,
        playbackRate: { value: 1 },
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      sources.push(value);
      return value;
    }),
    createGain: vi.fn(() => {
      const value = {
        gain: { value: 0, setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(value);
      return value;
    }),
  };
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        return context;
      }
    },
  );
  const bytes: Record<string, Uint8Array> = {
    voice: new Uint8Array([1, 2, 3, 4]),
    score: new Uint8Array([2, 3, 4, 5]),
    sfx: new Uint8Array([3, 4, 5, 6]),
  };
  const read = vi.fn(async (path: string) => bytes[path.split("/").at(-1)!]!);
  window.aijian = { readFilmMedia: read } as unknown as Window["aijian"];
  const info = Object.fromEntries(
    Object.keys(bytes).map((key) => [
      key,
      { durationSeconds: 8, hasAudio: true, channels: 1, byteLength: 4 },
    ]),
  );
  const plan = buildAudioMixPlan({
    projectId: "project",
    durationSeconds: 8,
    shots: [],
    sources: info,
    clips: [
      {
        id: "voice",
        sourceKey: "voice",
        lane: "dialogue",
        label: "旁白",
        shotId: "",
        takeId: "",
        startSeconds: 1,
        durationSeconds: 2,
        offsetSeconds: 0.5,
        gainDb: 0,
      },
      {
        id: "score",
        sourceKey: "score",
        lane: "score",
        label: "",
        shotId: "",
        takeId: "",
        startSeconds: 0,
        durationSeconds: 8,
        offsetSeconds: 0,
        gainDb: -6,
      },
      {
        id: "sfx",
        sourceKey: "sfx",
        lane: "sfx",
        label: "",
        shotId: "",
        takeId: "",
        startSeconds: 6,
        durationSeconds: 1,
        offsetSeconds: 0,
        gainDb: 0,
      },
    ],
  });
  const result: Extract<AudioMixPreviewResult, { kind: "READY" }> = {
    kind: "READY",
    plan,
    sourcePaths: Object.fromEntries(Object.keys(bytes).map((key) => [key, `/verified/${key}`])),
    sourceSha256: Object.fromEntries(
      Object.entries(bytes).map(([key, value]) => [
        key,
        createHash("sha256").update(value).digest("hex"),
      ]),
    ),
    sourceInfo: info,
    fingerprint: "known",
  };
  let clock = 1.5;
  return {
    result,
    context,
    sources,
    gains,
    read,
    bytes,
    clock: () => clock,
    seek: (time: number, audioTime: number) => {
      clock = time;
      context.currentTime = audioTime;
    },
    tick: () =>
      act(() => {
        const next = frame;
        frame = null;
        next?.(0);
      }),
  };
}
it("reads only active verified sources, follows real seek/rate and gain, and makes solo score un-ducked", async () => {
  const f = fixture();
  const view = render(<AudioMixPreview result={f.result} clock={f.clock} playing audible />);
  await waitFor(() => expect(f.context.decodeAudioData).toHaveBeenCalledTimes(2));
  f.tick();
  const voice = f.sources.find((source) => source.buffer?.label === 1)!;
  expect(voice.start).toHaveBeenCalledWith(0, 1, 1.5);
  expect(f.read.mock.calls.some(([path]) => path === "/verified/sfx")).toBe(false);
  for (const call of f.read.mock.calls)
    expect(call).toEqual([
      expect.any(String),
      { maxBytes: 16 * 1024 * 1024, expectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
  f.seek(2.5, 0.1);
  f.tick();
  expect(voice.stop).toHaveBeenCalledOnce();
  const later = f.sources.filter((source) => source.buffer?.label === 1).at(-1)!;
  expect(later.start).toHaveBeenCalledWith(0.1, 2, 0.5);
  view.rerender(<AudioMixPreview result={f.result} clock={f.clock} playing audible rate={2} />);
  f.tick();
  expect(f.sources.filter((source) => source.buffer?.label === 1).at(-1)!.playbackRate.value).toBe(
    2,
  );
  view.rerender(<AudioMixPreview result={f.result} clock={f.clock} playing audible solo="score" />);
  f.tick();
  expect(f.gains.at(-1)!.gain.setValueAtTime).toHaveBeenLastCalledWith(10 ** (-6 / 20), 0.1);
  view.unmount();
  expect(f.context.close).toHaveBeenCalledOnce();
});
it("does not decode or play changed bytes, over-budget sources or late reads after unmount", async () => {
  const changed = fixture();
  changed.read.mockResolvedValue(new Uint8Array([9, 9, 9, 9]));
  render(<AudioMixPreview result={changed.result} clock={changed.clock} playing audible />);
  await screen.findByText(/未播放未核验的声音/);
  expect(changed.context.decodeAudioData).not.toHaveBeenCalled();
  expect(changed.sources).toHaveLength(0);
  cleanup();
  const large = fixture();
  large.result.sourceInfo.voice!.byteLength = 20 * 1024 * 1024;
  render(<AudioMixPreview result={large.result} clock={large.clock} playing audible />);
  await screen.findByText(/受控容量/);
  expect(large.read.mock.calls.some(([path]) => path === "/verified/voice")).toBe(false);
  cleanup();
  const late = fixture();
  let release!: (value: Uint8Array) => void;
  late.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = render(<AudioMixPreview result={late.result} clock={late.clock} playing audible />);
  view.unmount();
  await act(async () => release(late.bytes.voice!));
  expect(late.context.decodeAudioData).not.toHaveBeenCalled();
  expect(late.context.close).toHaveBeenCalledOnce();
});

it("uses the same looping source window after seek without restarting at each wrap", async () => {
  const f = fixture();
  const track = f.result.plan.tracks.find((row) => row.key === "score")!;
  track.loopSeconds = 1;
  track.offsetSeconds = 1;
  f.result.plan.tracks = [track];
  f.seek(4.5, 0);
  render(<AudioMixPreview result={f.result} clock={f.clock} playing audible />);
  await waitFor(() => expect(f.context.decodeAudioData).toHaveBeenCalledOnce());
  f.tick();
  expect(f.sources).toHaveLength(1);
  expect(f.sources[0]).toMatchObject({ loop: true, loopStart: 1, loopEnd: 2 });
  expect(f.sources[0]!.start).toHaveBeenCalledWith(0, 1.5, 3.5);
  f.seek(5.7, 1.2);
  f.tick();
  expect(f.sources).toHaveLength(1);
  expect(f.sources[0]!.stop).not.toHaveBeenCalled();
});
