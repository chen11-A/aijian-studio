import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MediaPages } from "./MediaPages";
import type * as Model from "./model";

const state = vi.hoisted(() => ({
  page: "assembly",
  isFixture: false,
  backendProjectId: `prj_${"a".repeat(32)}`,
  selectedEpisodeId: `ep_${"b".repeat(32)}`,
  shots: [],
  total: 0,
  annotations: [],
  go: vi.fn(),
  setNavigationGuard: vi.fn(),
}));
vi.mock("./model", async (load) => ({
  ...(await load<typeof Model>()),
  useDemo: () => state,
}));
afterEach(() => {
  cleanup();
  delete window.aijian;
  localStorage.clear();
});

it("uses the production MediaPages route and existing desktop script gateway for the selected real episode", async () => {
  const getEpisodeScript = vi.fn().mockResolvedValue({ kind: "EMPTY" });
  const readLatestEpisodeMediaAssembly = vi
    .fn()
    .mockResolvedValue({ kind: "NOT_FOUND", request_id: "assembly-empty" });
  window.aijian = {
    getEpisodeScript,
    getEpisodeScriptVersion: vi.fn(),
    readLatestEpisodeMediaAssembly,
    createEpisodeMediaAssemblyVersion: vi.fn(),
    listProjectMediaAssets: vi
      .fn()
      .mockResolvedValue({ kind: "LISTED", receipt: { data: [], request_id: "assets" } }),
    getProjectMediaAsset: vi.fn(),
    importProjectMediaAssetFromPicker: vi.fn(),
    importProjectMediaAssetVersionFromPicker: vi.fn(),
    readProjectMediaAssetPreview: vi.fn(),
    addProjectMediaAssetEpisodeReference: vi.fn(),
    removeProjectMediaAssetEpisodeReference: vi.fn(),
    deleteProjectMediaAsset: vi.fn(),
  } as unknown as Window["aijian"];
  render(<MediaPages />);
  expect(screen.getByLabelText("导入音频对白绑定")).toBeInTheDocument();
  await waitFor(() =>
    expect(getEpisodeScript).toHaveBeenCalledWith(state.backendProjectId, state.selectedEpisodeId),
  );
  expect(readLatestEpisodeMediaAssembly).toHaveBeenCalledWith(
    state.backendProjectId,
    state.selectedEpisodeId,
  );
  expect(window.aijian?.createEpisodeMediaAssemblyVersion).not.toHaveBeenCalled();
});
