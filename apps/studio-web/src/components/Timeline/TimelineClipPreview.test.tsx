import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TimelineClipPreview } from "./TimelineClipPreview";

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
const play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const pause = vi.fn();
const load = vi.fn();

Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: load });

function selection(
  overrides: Partial<ComponentProps<typeof TimelineClipPreview>["selection"]> = {},
) {
  return {
    timelineVersionId: "ver_11111111111111111111111111111111",
    clipId: "clip-rain",
    sourceInFrame: 25,
    durationFrames: 50,
    frameRate: { num: 25, den: 1 },
    ...overrides,
  };
}

function media(
  overrides: Partial<NonNullable<ComponentProps<typeof TimelineClipPreview>["media"]>> = {},
) {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  return {
    bytes,
    byteLength: bytes.byteLength,
    mimeType: "video/webm" as const,
    previewFrameCount: 125,
    previewKind: "DEVELOPMENT_FAKE" as const,
    ...overrides,
  };
}

function previewVideo(): HTMLVideoElement {
  const video = document.querySelector("video");
  if (!(video instanceof HTMLVideoElement)) throw new Error("preview video is missing");
  return video;
}

afterEach(() => {
  createObjectURL.mockReset();
  revokeObjectURL.mockReset();
  play.mockReset();
  play.mockResolvedValue(undefined);
  pause.mockReset();
  load.mockReset();
});

describe("TimelineClipPreview", () => {
  test("honestly reports when no bounded media has been supplied", () => {
    render(<TimelineClipPreview media={null} selection={selection()} />);

    expect(screen.getByText("已选择镜头，尚未接入受控媒体。")).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("binds the bounded object URL to video src and labels development engineering media", () => {
    createObjectURL.mockReturnValue("blob:clip-rain");
    render(<TimelineClipPreview media={media()} selection={selection()} />);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(previewVideo()).toHaveAttribute("src", "blob:clip-rain");
    expect(screen.getByText("开发工程媒体")).toBeInTheDocument();
  });

  test("starts at and stops at the selected edit-frame interval", async () => {
    createObjectURL.mockReturnValue("blob:clip-rain");
    render(<TimelineClipPreview media={media()} selection={selection()} />);
    const video = previewVideo();
    Object.defineProperty(video, "duration", { configurable: true, value: 5 });

    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "播放区间" }));
    expect(play).toHaveBeenCalledTimes(1);

    video.currentTime = 3;
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(3);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByText("仅播放当前镜头的编辑帧区间。")).toBeInTheDocument();
  });

  test("rejects zero-byte, oversized and non-webm input before object URL creation", () => {
    const cases = [
      media({ bytes: new ArrayBuffer(0), byteLength: 0 }),
      media({ bytes: new ArrayBuffer(16 * 1024 * 1024 + 1), byteLength: 16 * 1024 * 1024 + 1 }),
      media({ mimeType: "video/mp4" as unknown as "video/webm" }),
    ];

    for (const candidate of cases) {
      const view = render(<TimelineClipPreview media={candidate} selection={selection()} />);
      expect(screen.getByRole("alert")).toHaveTextContent("16 MiB 以内的 video/webm");
      view.unmount();
    }
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("rejects an interval beyond the media frame count before object URL creation", () => {
    render(
      <TimelineClipPreview media={media({ previewFrameCount: 60 })} selection={selection()} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("编辑帧区间和媒体帧数");
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("releases the URL when metadata shows the media is shorter than the clip interval", () => {
    createObjectURL.mockReturnValue("blob:short");
    render(<TimelineClipPreview media={media()} selection={selection()} />);
    const video = previewVideo();
    Object.defineProperty(video, "duration", { configurable: true, value: 2 });

    fireEvent.loadedMetadata(video);

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:short");
    expect(screen.getByRole("alert")).toHaveTextContent("无法解码");
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("stops, unbinds and revokes the old source on a version or clip change and on unmount", () => {
    createObjectURL.mockReturnValueOnce("blob:old").mockReturnValueOnce("blob:new");
    const view = render(<TimelineClipPreview media={media()} selection={selection()} />);

    view.rerender(
      <TimelineClipPreview
        media={media()}
        selection={selection({
          timelineVersionId: "ver_22222222222222222222222222222222",
          clipId: "clip-letter",
        })}
      />,
    );

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:old");
    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(previewVideo()).toHaveAttribute("src", "blob:new");

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:new");
  });

  test("ignores a late rejected play promise after selection has changed", async () => {
    let rejectPlay: ((reason?: unknown) => void) | undefined;
    play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject;
        }),
    );
    createObjectURL.mockReturnValueOnce("blob:old").mockReturnValueOnce("blob:new");
    const view = render(<TimelineClipPreview media={media()} selection={selection()} />);

    fireEvent.click(screen.getByRole("button", { name: "播放区间" }));
    view.rerender(
      <TimelineClipPreview
        media={media()}
        selection={selection({
          timelineVersionId: "ver_22222222222222222222222222222222",
          clipId: "clip-letter",
        })}
      />,
    );
    rejectPlay?.(new Error("late play failure"));

    await waitFor(() => expect(previewVideo()).toHaveAttribute("src", "blob:new"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
