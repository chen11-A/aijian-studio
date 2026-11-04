import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioTransport, type AijianDesktopBridge } from "./studio";

const scope = [`prj_${"1".repeat(32)}`, `ep_${"2".repeat(32)}`, `dmp_${"3".repeat(32)}`] as const;
function setup() {
  return {
    listDraftExports: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getDraftExport: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    createDraftExportFromPicker: vi.fn().mockResolvedValue({ kind: "PICKER_CANCELLED" }),
    createDraftCompositionPreview: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    cancelDraftExport: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    readDraftExportPreview: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    revealDraftExportOutput: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
  };
}
afterEach(() => {
  delete window.aijian;
  vi.unstubAllGlobals();
});
describe("optional verified output native transport", () => {
  it("forwards exact IDs only without fetching or rewriting replies", async () => {
    const bridge = setup();
    window.aijian = bridge as unknown as AijianDesktopBridge;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const gateway = createStudioTransport().draftExports;
    expect(gateway).toBeDefined();
    await expect(gateway?.preview?.(...scope)).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    await expect(gateway?.reveal?.(...scope)).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(bridge.readDraftExportPreview).toHaveBeenCalledWith(...scope);
    expect(bridge.revealDraftExportOutput).toHaveBeenCalledWith(...scope);
    await gateway?.list(scope[0], scope[1]);
    await gateway?.get(...scope);
    await gateway?.cancel(...scope);
    const command = {
      operation_id: scope[2],
      assembly_version_id: `ver_${"4".repeat(32)}`,
      assembly_content_hash: `sha256:${"5".repeat(64)}`,
      rights_declaration: "OWNED_OR_SYNTHETIC" as const,
    };
    await gateway?.createFromPicker(scope[0], scope[1], command);
    await gateway?.createPreview?.(scope[0], scope[1], command);
    expect(bridge.createDraftCompositionPreview).toHaveBeenCalledWith(scope[0], scope[1], command);
    expect(bridge.listDraftExports).toHaveBeenCalledWith(scope[0], scope[1]);
    expect(bridge.getDraftExport).toHaveBeenCalledWith(...scope);
    expect(bridge.cancelDraftExport).toHaveBeenCalledWith(...scope);
    expect(bridge.createDraftExportFromPicker).toHaveBeenCalledWith(scope[0], scope[1], command);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["readDraftExportPreview", "revealDraftExportOutput"] as const)(
    "preserves export and the other action when %s is absent",
    (capability) => {
      const bridge = setup();
      window.aijian = { ...bridge, [capability]: undefined } as unknown as AijianDesktopBridge;
      const gateway = createStudioTransport().draftExports;
      expect(gateway?.createFromPicker).toBeTypeOf("function");
      expect(
        gateway?.[capability === "readDraftExportPreview" ? "preview" : "reveal"],
      ).toBeUndefined();
      expect(gateway?.[capability === "readDraftExportPreview" ? "reveal" : "preview"]).toBeTypeOf(
        "function",
      );
    },
  );
  it.each([
    "listDraftExports",
    "getDraftExport",
    "createDraftExportFromPicker",
    "cancelDraftExport",
  ] as const)("does not expose a partial export workflow without %s", (capability) => {
    window.aijian = { ...setup(), [capability]: undefined } as unknown as AijianDesktopBridge;
    expect(createStudioTransport().draftExports).toBeUndefined();
  });
  it("keeps older export clients usable when cache creation is absent", () => {
    window.aijian = {
      ...setup(),
      createDraftCompositionPreview: undefined,
    } as unknown as AijianDesktopBridge;
    const gateway = createStudioTransport().draftExports;
    expect(gateway?.createPreview).toBeUndefined();
    expect(gateway?.createFromPicker).toBeTypeOf("function");
    expect(gateway?.preview).toBeTypeOf("function");
  });
  it("keeps native output actions absent in browser mode", () => {
    expect(createStudioTransport().draftExports).toBeUndefined();
  });
});
