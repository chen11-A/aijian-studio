import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssemblyMediaPreview } from "./AssemblyMediaPreview";
import type { AssetLibraryGateway, AssetVersion } from "./adapters/assetLibrary";
const projectId = `prj_${"a".repeat(32)}`;
const media = {
  asset_id: `asset_${"b".repeat(32)}`,
  asset_version_id: `asv_${"c".repeat(32)}`,
  sha256: "d".repeat(64),
};
const version: AssetVersion = {
  id: media.asset_version_id,
  ordinal: 1,
  filename: "recording.wav",
  kind: "audio",
  mime_type: "audio/wav",
  byte_size: 4,
  sha256: media.sha256,
  rights_status: "PENDING_REVIEW",
  source_kind: "LOCAL_IMPORT",
  technical_metadata: {},
  created_at: "2026-10-11",
  availability: "VERIFIED",
};
const ready = () => ({
  kind: "READY" as const,
  mime_type: version.mime_type,
  sha256: version.sha256,
  bytes: new Uint8Array(4),
});
const onSampleRate = vi.fn();
let read: ReturnType<typeof vi.fn<AssetLibraryGateway["readProjectMediaAssetPreview"]>>;
function gateway(): AssetLibraryGateway {
  return { readProjectMediaAssetPreview: read } as unknown as AssetLibraryGateway;
}
beforeEach(() => {
  read = vi.fn(async () => ready());
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:verified-audio"),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("uses the exact audio identity and releases its URL immediately when decoding fails", async () => {
  render(
    <AssemblyMediaPreview
      projectId={projectId}
      media={media}
      version={version}
      gateway={gateway()}
      onSampleRate={onSampleRate}
    />,
  );
  const audio = await screen.findByLabelText("所选音频原件");
  expect(read).toHaveBeenCalledWith(projectId, media.asset_id, media.asset_version_id);
  fireEvent.error(audio);
  expect(screen.queryByLabelText("所选音频原件")).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:verified-audio");
});
it("discards an old A reply after A to B to A and releases only the current owned URL", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof read>>) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((reply) => {
        resolve = reply;
      }),
  );
  const api = gateway();
  const view = render(
    <AssemblyMediaPreview
      projectId={projectId}
      media={media}
      version={version}
      gateway={api}
      onSampleRate={onSampleRate}
    />,
  );
  view.rerender(
    <AssemblyMediaPreview
      projectId={`prj_${"0".repeat(32)}`}
      media={media}
      version={version}
      gateway={api}
      onSampleRate={onSampleRate}
    />,
  );
  await screen.findByLabelText("所选音频原件");
  view.rerender(
    <AssemblyMediaPreview
      projectId={projectId}
      media={media}
      version={version}
      gateway={api}
      onSampleRate={onSampleRate}
    />,
  );
  await screen.findByLabelText("所选音频原件");
  await act(async () => {
    resolve({ kind: "REMOTE_UNKNOWN" });
  });
  expect(screen.getByLabelText("所选音频原件")).toBeInTheDocument();
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it("removes old playback when the same version becomes unavailable and does not reread it", async () => {
  const api = gateway();
  const view = render(
    <AssemblyMediaPreview
      projectId={projectId}
      media={media}
      version={version}
      gateway={api}
      onSampleRate={onSampleRate}
    />,
  );
  await screen.findByLabelText("所选音频原件");
  view.rerender(
    <AssemblyMediaPreview
      projectId={projectId}
      media={media}
      version={{ ...version, availability: "MISSING" }}
      gateway={api}
      onSampleRate={onSampleRate}
    />,
  );
  expect(screen.queryByLabelText("所选音频原件")).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:verified-audio");
  expect(read).toHaveBeenCalledOnce();
});
it.each(["hash", "size", "unknown"])(
  "refuses %s readback without creating a playback URL",
  async (kind) => {
    read.mockResolvedValueOnce(
      kind === "unknown"
        ? { kind: "REMOTE_UNKNOWN" }
        : kind === "hash"
          ? { ...ready(), sha256: "0".repeat(64) }
          : { ...ready(), bytes: new Uint8Array(3) },
    );
    render(
      <AssemblyMediaPreview
        projectId={projectId}
        media={media}
        version={version}
        gateway={gateway()}
        onSampleRate={onSampleRate}
      />,
    );
    await screen.findByText(kind === "unknown" ? /原素材读取结果未知/ : /字节、大小或哈希身份不符/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  },
);
