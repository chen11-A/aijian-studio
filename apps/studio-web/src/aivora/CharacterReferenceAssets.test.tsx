import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CharacterReferenceAssets } from "./CharacterReferenceAssets";
import { createStudioTransport } from "../api/studio";
import { emptyCreativeContent } from "./adapters/creativeLibrary";
import type { CreativeContent } from "./adapters/creativeLibrary";
import type { AssetLibraryGateway } from "./adapters/assetLibrary";
import { useState } from "react";
import { asset } from "./CharacterReferenceAssets.testFixtures";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
const project = `prj_${"a".repeat(32)}`;
const character = `chr_${"b".repeat(32)}`;
let list: ReturnType<typeof vi.fn<AssetLibraryGateway["listProjectMediaAssets"]>>;
let latest: CreativeContent;
function Harness({ locked = false }: { locked?: boolean }) {
  const [content, edit] = useState(() => {
    const initial = emptyCreativeContent(project);
    initial.characters = [
      {
        character_id: character,
        ordinal: 1,
        name: "林舟",
        role: "",
        description: "",
        appearance: "",
        personality: "",
      },
    ];
    return initial;
  });
  latest = content;
  return (
    <CharacterReferenceAssets
      content={content}
      characterId={character}
      locked={locked}
      edit={edit}
      onNotice={vi.fn()}
    />
  );
}
beforeEach(() => {
  list = vi.fn<AssetLibraryGateway["listProjectMediaAssets"]>().mockResolvedValue({
    kind: "LISTED",
    receipt: { data: [asset], request_id: "123e4567-e89b-42d3-a456-426614174000" },
  });
  vi.mocked(createStudioTransport).mockReturnValue({
    assetLibrary: { listProjectMediaAssets: list },
  } as unknown as ReturnType<typeof createStudioTransport>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("requires an explicitly selected registered version and preserves exact asset/version/hash in the shared draft", async () => {
  render(<Harness />);
  await screen.findByText("真实登记参考.png");
  expect(screen.getByRole("button", { name: "关联选中参考" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("参考素材"), { target: { value: asset.id } });
  expect(screen.getByRole("button", { name: "关联选中参考" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("参考素材版本"), {
    target: { value: asset.latest_version.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "关联选中参考" }));
  fireEvent.change(screen.getByLabelText("参考说明"), { target: { value: "正面参考" } });
  expect(latest.schema_version).toBe("1.2.0");
  if (latest.schema_version !== "1.2.0") throw new Error("Missing reference schema");
  expect(latest.references[0]).toMatchObject({
    character_id: character,
    costume_id: null,
    asset_id: asset.id,
    asset_version_id: asset.latest_version.id,
    asset_sha256: asset.latest_version.sha256,
    label: "正面参考",
  });
  expect(list).toHaveBeenCalledWith(project);
  expect(screen.getByText(/未核对权利/)).toBeInTheDocument();
});
it("keeps UNKNOWN asset reads distinct from an empty asset library", async () => {
  list.mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
  render(<Harness />);
  await screen.findByText(/素材读取结果待核对/);
  expect(screen.queryByText("作品素材库为空")).not.toBeInTheDocument();
});
it("rejects cross-project receipts and prevents reference edits during pending writes", async () => {
  list.mockResolvedValueOnce({
    kind: "LISTED",
    receipt: {
      data: [{ ...asset, project_id: `prj_${"f".repeat(32)}` }],
      request_id: "123e4567-e89b-42d3-a456-426614174000",
    },
  });
  const view = render(<Harness />);
  await screen.findByText(/素材回执不一致/);
  view.rerender(<Harness locked />);
  expect(screen.getByRole("button", { name: "关联选中参考" })).toBeDisabled();
});

it("rejects late A asset lists after project A→B→A and requires a fresh explicit version selection", async () => {
  let reply!: (value: Awaited<ReturnType<AssetLibraryGateway["listProjectMediaAssets"]>>) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const edit = vi.fn();
  const content = emptyCreativeContent(project);
  const props = { characterId: character, locked: false, edit, onNotice: vi.fn() };
  const view = render(<CharacterReferenceAssets {...props} content={content} />);
  const second = `prj_${"f".repeat(32)}`;
  list.mockResolvedValueOnce({ kind: "LISTED", receipt: { data: [], request_id: "request-B" } });
  view.rerender(<CharacterReferenceAssets {...props} content={emptyCreativeContent(second)} />);
  await screen.findByText("作品素材库为空");
  view.rerender(<CharacterReferenceAssets {...props} content={content} />);
  await screen.findByText("真实登记参考.png");
  await act(async () => reply({ kind: "LISTED", receipt: { data: [], request_id: "stale-A" } }));
  expect(screen.getByText("真实登记参考.png")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "关联选中参考" })).toBeDisabled();
  expect(edit).not.toHaveBeenCalled();
  expect(list.mock.calls.map(([id]) => id)).toEqual([project, second, project]);
});

it("keeps exact older versions selectable and resets selection after switching assets", async () => {
  const newer = {
    ...asset.latest_version,
    id: `asv_${"f".repeat(32)}`,
    ordinal: 2,
    sha256: "f".repeat(64),
  };
  const second = { ...asset, id: `asset_${"f".repeat(32)}` };
  list.mockResolvedValueOnce({
    kind: "LISTED",
    receipt: {
      data: [{ ...asset, latest_version: newer, versions: [asset.latest_version, newer] }, second],
      request_id: "versions",
    },
  });
  render(<Harness />);
  await screen.findAllByText("真实登记参考.png");
  fireEvent.change(screen.getByLabelText("参考素材"), { target: { value: asset.id } });
  fireEvent.change(screen.getByLabelText("参考素材版本"), {
    target: { value: asset.latest_version.id },
  });
  fireEvent.change(screen.getByLabelText("参考素材"), { target: { value: second.id } });
  expect(screen.getByLabelText("参考素材版本")).toHaveValue("");
  expect(screen.getByRole("button", { name: "关联选中参考" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("参考素材"), { target: { value: asset.id } });
  fireEvent.change(screen.getByLabelText("参考素材版本"), {
    target: { value: asset.latest_version.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "关联选中参考" }));
  expect(latest.schema_version === "1.2.0" && latest.references[0]?.asset_version_id).toBe(
    asset.latest_version.id,
  );
});
