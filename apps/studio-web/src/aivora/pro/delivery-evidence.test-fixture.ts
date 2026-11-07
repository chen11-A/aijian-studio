import type { FilmDeliveryEvidenceResult } from "@aijian/contracts/film-delivery-evidence";
export function writtenDelivery(
  status: "complete" | "partial" = "complete",
): Extract<FilmDeliveryEvidenceResult, { kind: "WRITTEN" }> {
  return {
    kind: "WRITTEN",
    fileName: "合成交付清单.json",
    manifestSha256: "a".repeat(64),
    manifest: {
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      status,
      selection: [
        {
          shotId: "private-shot-id",
          takeId: "private-take-id",
          label: "第 1 场 · 镜头 1",
          versionLabel: "第 2 版",
          startSeconds: 0,
          endSeconds: 2.25,
        },
      ],
      settings: {
        aspects: ["16:9"],
        quality: "720p",
        subtitles: "none",
        style: "white",
        aiMark: true,
      },
      files: [
        {
          role: "video",
          aspectRatio: "16:9",
          fileName: "合成成片.mp4",
          sha256: "b".repeat(64),
          bytes: 1234,
          technical: {
            durationSeconds: 2.25,
            durationBasis: "video-stream",
            video: {
              codec: "h264",
              width: 1920,
              height: 1080,
              displayWidth: 1920,
              displayHeight: 1080,
              averageFrameRate: 29.97,
              pixelFormat: "yuv420p",
              colorSpace: null,
              colorPrimaries: null,
              colorTransfer: null,
              colorRange: null,
            },
            audioTracks: null,
          },
          qc: {
            schemaVersion: 1,
            status: "warnings",
            counts: { block: 0, warn: 1, info: 0 },
            integratedLufs: null,
            truePeakDbtp: null,
          },
        },
      ],
      unverified: ["对白完整性与口型需要完整播放核对。", "全部音轨实际听感尚未核验。"],
    },
  };
}
