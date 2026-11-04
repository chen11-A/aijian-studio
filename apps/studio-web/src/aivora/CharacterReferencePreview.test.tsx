import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CharacterReferencePreview } from "./CharacterReferencePreview";
import { asset } from "./CharacterReferenceAssets.testFixtures";
import type { AssetLibraryGateway } from "./adapters/assetLibrary";

type Result = Awaited<ReturnType<AssetLibraryGateway["readProjectMediaAssetPreview"]>>;
let read: ReturnType<typeof vi.fn<AssetLibraryGateway["readProjectMediaAssetPreview"]>>;
let gateway: AssetLibraryGateway;
const ready = (): Result => ({
  kind: "READY",
  bytes: new Uint8Array(68),
  mime_type: asset.latest_version.mime_type,
  sha256: asset.latest_version.sha256,
});
beforeEach(() => {
  read = vi.fn<AssetLibraryGateway["readProjectMediaAssetPreview"]>().mockResolvedValue(ready());
  gateway = { readProjectMediaAssetPreview: read } as unknown as AssetLibraryGateway;
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:reference"),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const props = () => ({
  projectId: asset.project_id,
  assetId: asset.id,
  version: asset.latest_version,
  gateway,
});
const click = () => fireEvent.click(screen.getByRole("button", { name: "读取此参考预览" }));

it("only reads the explicitly requested exact native version and revokes URLs on unmount", async () => {
  const view = render(<CharacterReferencePreview {...props()} />);
  expect(read).not.toHaveBeenCalled();
  click();
  await screen.findByRole("img");
  expect(read).toHaveBeenCalledWith(asset.project_id, asset.id, asset.latest_version.id);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reference");
});

it.each(["project", "asset", "version", "hash"])(
  "discards old A replies across %s A→B→A without showing a stale image",
  async (field) => {
    let resolve!: (value: Result) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((reply) => {
          resolve = reply;
        }),
    );
    const view = render(<CharacterReferencePreview {...props()} />);
    click();
    const changed = { ...props() };
    if (field === "project") changed.projectId = `prj_${"f".repeat(32)}`;
    if (field === "asset") changed.assetId = `asset_${"f".repeat(32)}`;
    if (field === "version") changed.version = { ...changed.version, id: `asv_${"f".repeat(32)}` };
    if (field === "hash") changed.version = { ...changed.version, sha256: "f".repeat(64) };
    view.rerender(<CharacterReferencePreview {...changed} />);
    expect(screen.getByText("尚未读取预览")).toBeInTheDocument();
    view.rerender(<CharacterReferencePreview {...props()} />);
    await act(async () => resolve(ready()));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    click();
    await screen.findByRole("img");
    expect(read).toHaveBeenCalledTimes(2);
  },
);

it.each(["hash", "mime", "size", "missing", "throw"])(
  "clears previously displayed bytes before a %s reread failure",
  async (fault) => {
    render(<CharacterReferencePreview {...props()} />);
    click();
    await screen.findByRole("img");
    if (fault === "throw") read.mockRejectedValueOnce(new Error("disconnected"));
    else if (fault === "missing") read.mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
    else
      read.mockResolvedValueOnce({
        kind: "READY",
        bytes: new Uint8Array(fault === "size" ? 1 : 68),
        mime_type: fault === "mime" ? "video/mp4" : "image/png",
        sha256: fault === "hash" ? "f".repeat(64) : asset.latest_version.sha256,
      });
    click();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await screen.findByText(fault === "throw" ? /预览读取结果未知/ : /预览未通过核对/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reference");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
  },
);

it("revokes an undecodable image without removing its reference or retrying", async () => {
  render(<CharacterReferencePreview {...props()} />);
  click();
  fireEvent.error(await screen.findByRole("img"));
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/参考图片无法解码/)).toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reference");
  expect(read).toHaveBeenCalledTimes(1);
});
