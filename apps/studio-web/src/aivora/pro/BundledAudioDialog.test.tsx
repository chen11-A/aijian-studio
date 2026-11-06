import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BundledAudioAsset } from "@aijian/contracts/film-audio-library";
import { BundledAudioDialog } from "./BundledAudioDialog";
afterEach(cleanup);
const asset: BundledAudioAsset = {
  id: "library-test",
  name: "雨声",
  type: "sfx",
  category: "天气",
  tags: ["雨"],
  scene: "室外",
  durationSeconds: 10,
  loopable: false,
  loudness: -20,
  source: "https://example.org/audio",
  author: "素材作者",
  license: "CC0",
  sha256: "a".repeat(64),
};
function props() {
  return {
    assets: [asset],
    loading: false,
    target: { key: "verified-target", durationSeconds: 2.25 },
    targetBusy: false,
    busy: false,
    locked: false,
    message: "",
    versionLabel: "第2版",
    onRefreshTarget: vi.fn(),
    onRetryCatalog: vi.fn(),
    onAdd: vi.fn(),
    onClose: vi.fn(),
  };
}
it("uses the verified actual version duration for a single explicit placement and exposes source metadata", () => {
  const p = props();
  render(<BundledAudioDialog {...p} />);
  expect(p.onAdd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: /雨声/ }));
  expect(screen.getByLabelText("使用时长（秒）")).toHaveValue(2.25);
  expect(screen.getByText("素材作者")).toBeInTheDocument();
  expect(screen.getByText("CC0")).toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", asset.source);
  expect(screen.getByRole("checkbox", { name: "循环到所选时长" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "加入当前版本" }));
  expect(p.onAdd).toHaveBeenCalledExactlyOnceWith({
    assetId: asset.id,
    lane: "sfx",
    placement: { startSeconds: 0, durationSeconds: 2.25, offsetSeconds: 0, gainDb: 0, loop: false },
  });
});
it("does not invent a default or allow adding before actual target timing is known", () => {
  const p = props();
  const view = render(<BundledAudioDialog {...p} target={null} />);
  fireEvent.click(screen.getByRole("radio", { name: /雨声/ }));
  expect(screen.getByLabelText("使用时长（秒）")).toHaveValue(null);
  expect(screen.getByRole("button", { name: "加入当前版本" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "核对当前版本时长" }));
  expect(p.onRefreshTarget).toHaveBeenCalledOnce();
  view.rerender(<BundledAudioDialog {...p} />);
  expect(screen.getByLabelText("使用时长（秒）")).toHaveValue(2.25);
});
it("rejects out-of-target and source trim bounds; only an explicitly loopable asset may repeat", () => {
  const p = props();
  const view = render(<BundledAudioDialog {...p} />);
  fireEvent.click(screen.getByRole("radio", { name: /雨声/ }));
  fireEvent.change(screen.getByLabelText("使用时长（秒）"), { target: { value: "3" } });
  expect(screen.getByRole("button", { name: "加入当前版本" })).toBeDisabled();
  view.rerender(
    <BundledAudioDialog
      {...p}
      target={{ key: "long-verified", durationSeconds: 8 }}
      assets={[{ ...asset, durationSeconds: 1.5, loopable: true }]}
    />,
  );
  fireEvent.change(screen.getByLabelText("使用时长（秒）"), { target: { value: "6" } });
  expect(screen.getByRole("button", { name: "加入当前版本" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "循环到所选时长" }));
  expect(screen.getByRole("button", { name: "加入当前版本" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("素材起点（秒）"), { target: { value: "1.5" } });
  expect(screen.getByRole("button", { name: "加入当前版本" })).toBeDisabled();
  expect(p.onAdd).not.toHaveBeenCalled();
});
it("locks add and close while busy and keeps catalog loading failure separate from an empty filtered list", () => {
  const p = props();
  const view = render(<BundledAudioDialog {...p} assets={null} />);
  fireEvent.click(screen.getByRole("button", { name: "重读素材目录" }));
  expect(p.onRetryCatalog).toHaveBeenCalledOnce();
  view.rerender(<BundledAudioDialog {...p} />);
  fireEvent.click(screen.getByRole("radio", { name: /雨声/ }));
  view.rerender(<BundledAudioDialog {...p} busy />);
  fireEvent.click(screen.getByRole("button", { name: "正在加入…" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(p.onAdd).not.toHaveBeenCalled();
  expect(p.onClose).not.toHaveBeenCalled();
});
it("renders catalog text as React text and never opens a non-HTTP source as a link", () => {
  const p = props();
  render(
    <BundledAudioDialog
      {...p}
      assets={[{ ...asset, name: "<script>不执行</script>", source: "javascript:alert(1)" }]}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: /不执行/ }));
  expect(screen.queryByRole("link")).toBeNull();
  expect(document.querySelector("script")).toBeNull();
});

it("never exposes credential-bearing source links as visible fallback text", () => {
  const p = props();
  render(
    <BundledAudioDialog
      {...p}
      assets={[{ ...asset, source: "https://private-user:private-secret@example.org/" }]}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: /雨声/ }));
  expect(screen.queryByRole("link")).toBeNull();
  expect(document.body.textContent).not.toContain("private-secret");
  expect(screen.getByText("未提供可安全打开的来源链接")).toBeInTheDocument();
});
