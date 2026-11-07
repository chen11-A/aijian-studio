import { expect, it } from "vitest";
import { deliveryQc, deliverySelection, deliveryTechnical } from "./film-delivery-evidence";

it("accepts only curated technical fields and never projects raw paths or tags", () => {
  const facts = {
    durationSeconds: 2,
    durationBasis: "video-stream",
    video: {
      codec: "h264",
      width: 1920,
      height: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
      averageFrameRate: 24000 / 1001,
      pixelFormat: "yuv420p",
      colorSpace: null,
      colorPrimaries: null,
      colorTransfer: null,
      colorRange: "tv",
    },
    audioTracks: [
      { index: 1, codec: "aac", sampleRate: 48000, channels: 2, channelLayout: "stereo" },
    ],
  };
  expect(deliveryTechnical(facts)).toEqual(facts);
  expect(deliveryTechnical({ ...facts, path: "/private/secret.mp4" })).toBeNull();
  expect(
    deliveryTechnical({ ...facts, video: { ...facts.video, tags: { token: "private" } } }),
  ).toBeNull();
  expect(
    deliveryTechnical({ ...facts, audioTracks: [{ ...facts.audioTracks[0], index: -1 }] }),
  ).toBeNull();
  expect(deliveryTechnical(null)).toBeNull();
});

it("keeps unknown tracks distinct from a measured empty audio list and hides unsafe values", () => {
  const facts = { durationSeconds: null, durationBasis: "unknown", video: null, audioTracks: null };
  expect(deliveryTechnical(facts)).toEqual(facts);
  expect(deliveryTechnical({ ...facts, audioTracks: [] })).toEqual({ ...facts, audioTracks: [] });
});

it("projects original severity and audio measurements without arbitrary issue detail", () => {
  const report = {
    schemaVersion: 1,
    issues: [{ severity: "warn", reason: "/private/token" }, { severity: "info" }],
    audio: { integratedLufs: -16.1, truePeakDbtp: -1.2 },
  };
  const summary = deliveryQc(report);
  expect(summary).toEqual({
    schemaVersion: 1,
    status: "warnings",
    counts: { block: 0, warn: 1, info: 1 },
    integratedLufs: -16.1,
    truePeakDbtp: -1.2,
  });
  expect(JSON.stringify(summary)).not.toContain("private");
  expect(deliveryQc({ ...report, issues: [{ severity: "block" }] }).status).toBe("blocked");
  expect(deliveryQc({ ...report, issues: [{ severity: "unsupported" }] }).status).toBe("unknown");
  expect(
    deliveryQc({ schemaVersion: 1, issues: [], audio: { integratedLufs: -Infinity } })
      .integratedLufs,
  ).toBeNull();
});

it("uses actual selected version and clock, never planned seconds or unsafe IDs", () => {
  const result = deliverySelection(
    {
      id: "film",
      seriesId: "series",
      scenes: [{ id: "scene", no: 7 }],
      shots: [
        {
          id: "shot",
          sceneId: "scene",
          no: 4,
          seconds: 99,
          takes: [
            { id: "old", index: 1 },
            { id: "selected", index: 3 },
          ],
        },
      ],
    },
    [{ shotId: "shot", takeId: "selected", label: "unused raw text" }],
    [{ id: "shot", start: 0.4, end: 2.8 }],
  );
  expect(result).toEqual([
    {
      shotId: "shot",
      takeId: "selected",
      label: "第 7 场 · 镜头 4",
      versionLabel: "第 3 版",
      startSeconds: 0.4,
      endSeconds: 2.8,
    },
  ]);
  expect(
    deliverySelection(
      { id: "film", seriesId: "series" },
      [{ shotId: "/private/path", takeId: "take", label: "" }],
      [],
    )[0],
  ).toMatchObject({ shotId: null, versionLabel: null, startSeconds: null, endSeconds: null });
});
