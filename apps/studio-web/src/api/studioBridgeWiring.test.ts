import { afterEach, describe, expect, test, vi } from "vitest";

import { createStudioTransport, type AijianDesktopBridge } from "./studio";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const version = `ver_${"c".repeat(32)}`;
const asset = `ast_${"d".repeat(32)}`;
const operation = "11111111-1111-4111-8111-111111111111";
const hash = `sha256:${"e".repeat(64)}`;
// Opaque frozen sentinels exercise argument identity/order at this forwarding layer.
// DTO validation is tested by the real adapters and main-process contract suites.
const command = Object.freeze({ operationId: operation, expectedRevision: 7 });
const original = Object.freeze({ operationId: operation, sourceHash: hash });
type Route = { bridge: keyof AijianDesktopBridge; path: string; args: unknown[] };
const routes: Route[] = [
  { bridge: "getAppPreferences", path: "getAppPreferences", args: [] },
  { bridge: "saveAppPreferences", path: "saveAppPreferences", args: [command] },
  {
    bridge: "listProjectMediaAssets",
    path: "assetLibrary.listProjectMediaAssets",
    args: [project],
  },
  {
    bridge: "getProjectMediaAsset",
    path: "assetLibrary.getProjectMediaAsset",
    args: [project, asset],
  },
  {
    bridge: "importProjectMediaAssetFromPicker",
    path: "assetLibrary.importProjectMediaAssetFromPicker",
    args: [project],
  },
  {
    bridge: "importProjectMediaAssetVersionFromPicker",
    path: "assetLibrary.importProjectMediaAssetVersionFromPicker",
    args: [project, asset],
  },
  {
    bridge: "readProjectMediaAssetPreview",
    path: "assetLibrary.readProjectMediaAssetPreview",
    args: [project, asset, version],
  },
  {
    bridge: "addProjectMediaAssetEpisodeReference",
    path: "assetLibrary.addProjectMediaAssetEpisodeReference",
    args: [project, asset, command],
  },
  {
    bridge: "removeProjectMediaAssetEpisodeReference",
    path: "assetLibrary.removeProjectMediaAssetEpisodeReference",
    args: [project, asset, command],
  },
  {
    bridge: "deleteProjectMediaAsset",
    path: "assetLibrary.deleteProjectMediaAsset",
    args: [project, asset],
  },
  {
    bridge: "readLatestEpisodeMediaAssembly",
    path: "episodeMediaAssembly.readLatest",
    args: [project, episode],
  },
  {
    bridge: "createEpisodeMediaAssemblyVersion",
    path: "episodeMediaAssembly.createVersion",
    args: [project, episode, command],
  },
  { bridge: "getEpisodeStoryboard", path: "getEpisodeStoryboard", args: [project, episode] },
  {
    bridge: "getEpisodeStoryboardVersion",
    path: "getEpisodeStoryboardVersion",
    args: [project, episode, version],
  },
  {
    bridge: "createEpisodeStoryboardVersion",
    path: "createEpisodeStoryboardVersion",
    args: [project, episode, operation, command],
  },
  { bridge: "getProjectCreativeLibrary", path: "getProjectCreativeLibrary", args: [project] },
  {
    bridge: "getProjectCreativeLibraryVersion",
    path: "getProjectCreativeLibraryVersion",
    args: [project, version],
  },
  {
    bridge: "createProjectCreativeLibraryVersion",
    path: "createProjectCreativeLibraryVersion",
    args: [project, operation, command],
  },
  { bridge: "getEpisodeScript", path: "getEpisodeScript", args: [project, episode] },
  {
    bridge: "getEpisodeScriptVersion",
    path: "getEpisodeScriptVersion",
    args: [project, episode, version],
  },
  {
    bridge: "createEpisodeScriptVersion",
    path: "createEpisodeScriptVersion",
    args: [project, episode, operation, command],
  },
  {
    bridge: "getEpisodeScriptConfirmation",
    path: "getEpisodeScriptConfirmation",
    args: [project, episode],
  },
  {
    bridge: "createEpisodeScriptConfirmation",
    path: "createEpisodeScriptConfirmation",
    args: [project, episode, operation, command],
  },
  {
    bridge: "getEpisodeScriptConfirmationReceipt",
    path: "getEpisodeScriptConfirmationReceipt",
    args: [project, episode, operation],
  },
  {
    bridge: "getSourceProposalAcceptanceForVersion",
    path: "getSourceProposalAcceptanceForVersion",
    args: [project, version],
  },
  { bridge: "updateProject", path: "updateProject", args: [project, command] },
  { bridge: "getSourceText", path: "getSourceText", args: [project, `src_${"f".repeat(32)}`] },
  {
    bridge: "readVersionedSourceExtractionProposal",
    path: "readVersionedSourceExtractionProposal",
    args: [project, `prp_${"1".repeat(32)}`],
  },
  {
    bridge: "createRemoteSourceExtractRun",
    path: "remoteSourceExtract.create",
    args: [project, command],
  },
  {
    bridge: "readOriginalRemoteSourceExtractRun",
    path: "remoteSourceExtract.readOriginal",
    args: [project, original],
  },
  {
    bridge: "createSub2APISourceExtractRun",
    path: "sub2apiSourceExtract.create",
    args: [project, command],
  },
  {
    bridge: "readOriginalSub2APISourceExtractOperation",
    path: "sub2apiSourceExtract.readOriginal",
    args: [project, original],
  },
  {
    bridge: "approveSub2APISourceExtractCall",
    path: "sub2apiSourceExtract.approve",
    args: [project, original, command],
  },
  {
    bridge: "getSub2APISourceExtractApproval",
    path: "sub2apiSourceExtract.readApproval",
    args: [project, original],
  },
  { bridge: "getSourceExtraction", path: "getSourceExtraction", args: [project] },
  {
    bridge: "getSourceExtractionVersion",
    path: "getSourceExtractionVersion",
    args: [project, version],
  },
  { bridge: "createFakeTimelineRun", path: "fakeTimelineRuns.create", args: [project, command] },
  {
    bridge: "queryFakeTimelineRunOperation",
    path: "fakeTimelineRuns.query",
    args: [project, original],
  },
  {
    bridge: "queryFakeTimelineRunOperation",
    path: "queryFakeTimelineRunOperation",
    args: [project, original],
  },
  { bridge: "getProjectTimeline", path: "getProjectTimeline", args: [project] },
  { bridge: "trimTimelineClip", path: "trimTimelineClip", args: [project, command] },
  { bridge: "reorderTimelineClip", path: "reorderTimelineClip", args: [project, command] },
  { bridge: "replaceTimelineClip", path: "replaceTimelineClip", args: [project, command] },
  {
    bridge: "readDevelopmentExportPreview",
    path: "readDevelopmentExportPreview",
    args: [project, operation, version, 7, hash],
  },
  { bridge: "createDevelopmentExport", path: "createDevelopmentExport", args: [project, command] },
  {
    bridge: "getDevelopmentExport",
    path: "getDevelopmentExport",
    args: [project, operation, version, 7],
  },
  {
    bridge: "openDevelopmentExport",
    path: "openDevelopmentExport",
    args: [project, operation, version, 7],
  },
  {
    bridge: "saveDevelopmentExport",
    path: "saveDevelopmentExport",
    args: [project, operation, version, 7],
  },
  {
    bridge: "readSub2APIConfiguredReadiness",
    path: "readSub2APIConfiguredReadiness",
    args: ["connection-1", "model-1"],
  },
  { bridge: "rotateSub2APIKey", path: "rotateSub2APIKey", args: ["connection-1", command] },
  {
    bridge: "readSub2APIKeyRotation",
    path: "readSub2APIKeyRotation",
    args: ["connection-1", operation],
  },
];

function propertyAt(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null) return undefined;
    return Reflect.get(current, key);
  }, value);
}

const previousBridge = Object.getOwnPropertyDescriptor(window, "aijian");
function installBridge(bridge: object) {
  // Simulates preload capability negotiation, including intentionally incomplete bridges.
  Object.defineProperty(window, "aijian", { configurable: true, value: bridge });
}

afterEach(() => {
  if (previousBridge) Object.defineProperty(window, "aijian", previousBridge);
  else Reflect.deleteProperty(window, "aijian");
  vi.unstubAllGlobals();
});

describe("desktop studio forwarding boundary", () => {
  test.each(routes)(
    "$path preserves all pins, results and ambiguous rejection without retry",
    async ({ bridge: method, path, args }) => {
      const bridge = Object.fromEntries(routes.map(({ bridge: name }) => [name, vi.fn()]));
      const response = Object.freeze({ kind: "REMOTE_UNKNOWN", operationId: operation });
      const lostResponse = new Error("IPC reply lost after possible commit");
      const handler = vi.fn().mockResolvedValueOnce(response).mockRejectedValueOnce(lostResponse);
      bridge[method] = handler;
      const fetch = vi.fn(() => {
        throw new Error("desktop must not fall back to HTTP");
      });
      vi.stubGlobal("fetch", fetch);
      installBridge(bridge);
      const callable = propertyAt(createStudioTransport(), path);
      expect(typeof callable).toBe("function");
      if (typeof callable !== "function") throw new Error(`Missing ${path}`);

      expect(await Reflect.apply(callable, undefined, args)).toBe(response);
      expect(handler).toHaveBeenCalledExactlyOnceWith(...args);
      args.forEach((arg, index) => expect(handler.mock.calls[0]?.[index]).toBe(arg));
      await expect(Reflect.apply(callable, undefined, args)).rejects.toBe(lostResponse);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(fetch).not.toHaveBeenCalled();
      for (const [name, other] of Object.entries(bridge)) {
        if (name !== method) expect(other).not.toHaveBeenCalled();
      }
    },
  );

  const optionalGroups = [
    "assetLibrary",
    "episodeMediaAssembly",
    "remoteSourceExtract",
    "sub2apiSourceExtract",
  ];
  test.each(routes.filter(({ path }) => optionalGroups.includes(path.split(".")[0]!)))(
    "missing $bridge prevents exposing a partial capability",
    ({ bridge: missing, path }) => {
      const bridge = Object.fromEntries(routes.map(({ bridge: name }) => [name, vi.fn()]));
      Reflect.deleteProperty(bridge, missing);
      installBridge(bridge);
      expect(propertyAt(createStudioTransport(), path.split(".")[0]!)).toBeUndefined();
    },
  );
});
