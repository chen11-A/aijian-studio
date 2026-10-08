import { expect, test, vi } from "vitest";
import { readAssetDetail, readAssetLibrary } from "@qa-web/adapters/assetLibrary.ts";

const projectId = `prj_${"a".repeat(32)}`;
const otherProject = `prj_${"b".repeat(32)}`;
const assetId = `asset_${"c".repeat(32)}`;
const versionId = `asv_${"d".repeat(32)}`;
const version = {
  id: versionId, ordinal: 1, filename: "shot.png", kind: "image",
  mime_type: "image/png", byte_size: 12, sha256: "e".repeat(64),
  rights_status: "PENDING_REVIEW", source_kind: "LOCAL_IMPORT",
  technical_metadata: { width: 1, height: 1 },
  created_at: "2026-09-28T09:00:00+08:00", availability: "PRESENT_UNVERIFIED",
};
const asset = {
  id: assetId, project_id: projectId,
  created_at: "2026-09-28T09:00:00+08:00",
  latest_version: version, versions: [version], episode_references: [],
};

test("P17 returns the selected project's version and pending rights as data", async () => {
  const gateway = {
    listProjectMediaAssets: vi.fn(async () => ({
      kind: "LISTED", receipt: { data: [asset], request_id: "request-list" },
    })),
    getProjectMediaAsset: vi.fn(async () => ({
      kind: "FOUND", receipt: { data: asset, request_id: "request-detail" },
    })),
  };
  const list = await readAssetLibrary(gateway, projectId);
  expect(list.kind).toBe("READY");
  expect(list.assets[0].latest_version.rights_status).toBe("PENDING_REVIEW");
  expect(list.assets[0].latest_version.availability).toBe("PRESENT_UNVERIFIED");
  const detail = await readAssetDetail(gateway, projectId, assetId);
  expect(detail.kind).toBe("READY");
  expect(detail.asset.latest_version.id).toBe(versionId);
  expect(gateway.listProjectMediaAssets).toHaveBeenCalledWith(projectId);
  expect(gateway.getProjectMediaAsset).toHaveBeenCalledWith(projectId, assetId);
});

test("P17 foreign project receipt stays invalid instead of empty or ready", async () => {
  const gateway = { listProjectMediaAssets: vi.fn(async () => ({
    kind: "LISTED", receipt: { data: [{ ...asset, project_id: otherProject }],
      request_id: "request-foreign" },
  })) };
  expect((await readAssetLibrary(gateway, projectId)).kind).toBe("INVALID_RESPONSE");
  expect(gateway.listProjectMediaAssets).toHaveBeenCalledTimes(1);
});

test("P17 malformed version or dangling episode reference cannot enter detail", async () => {
  const malformed = { ...asset, latest_version: { ...version, sha256: "unverified" } };
  const dangling = { ...asset, episode_references: [{
    episode_id: "ep_001", version_id: `asv_${"f".repeat(32)}`,
    role: "project-reference", created_at: "2026-09-28T09:00:00+08:00",
  }] };
  const gateway = { getProjectMediaAsset: vi.fn()
    .mockResolvedValueOnce({ kind: "FOUND", receipt: { data: malformed, request_id: "r1" } })
    .mockResolvedValueOnce({ kind: "FOUND", receipt: { data: dangling, request_id: "r2" } }) };
  expect((await readAssetDetail(gateway, projectId, assetId)).kind).toBe("INVALID_RESPONSE");
  expect((await readAssetDetail(gateway, projectId, assetId)).kind).toBe("INVALID_RESPONSE");
});
