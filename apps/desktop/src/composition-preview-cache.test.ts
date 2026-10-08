import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compositionPreviewFilename,
  prepareCompositionPreviewPath,
} from "./composition-preview-cache";
import { DRAFT_EXPORT_CHANNELS, type DraftExportCommand } from "./draft-export-contract";
import { registerDraftExportHandlers, type DraftExportClient } from "./draft-export-ipc";
const roots: string[] = [];
async function root() {
  const value = await mkdtemp(join(tmpdir(), "aivora-preview-cache-"));
  roots.push(value);
  return value;
}
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { force: true, recursive: true });
});
const project = `prj_${"1".repeat(32)}`;
const episode = `ep_${"2".repeat(32)}`;
const command: DraftExportCommand = {
  operation_id: `dmp_${"3".repeat(32)}`,
  assembly_version_id: `ver_${"4".repeat(32)}`,
  assembly_content_hash: `sha256:${"5".repeat(64)}`,
  rights_declaration: "OWNED_OR_SYNTHETIC",
};
function setup(
  prepare = vi.fn<(id: string) => Promise<string>>().mockResolvedValue("/tmp/preview.mp4"),
) {
  const client: DraftExportClient = {
    listDraftExports: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getDraftExport: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    cancelDraftExport: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    createDraftExport: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
  };
  const handlers = new Map<
    string,
    (event: { top: boolean }, ...args: unknown[]) => Promise<unknown>
  >();
  const picker = vi.fn().mockResolvedValue(null);
  registerDraftExportHandlers<{ top: boolean }>(
    (name, handle) => handlers.set(name, handle),
    () => client,
    (event) => event.top,
    picker,
    prepare,
  );
  const event = { top: true };
  const invoke = (action: keyof typeof DRAFT_EXPORT_CHANNELS, ...args: unknown[]) =>
    handlers.get(DRAFT_EXPORT_CHANNELS[action])!(event, project, episode, ...args);
  return { prepare, client, picker, event, invoke };
}
describe("trusted native saved-composition cache", () => {
  it("creates only a canonical private directory and never overwrites or deletes a completed output", async () => {
    const base = await root();
    const path = await prepareCompositionPreviewPath(base, command.operation_id);
    expect(path).toBe(
      join(base, "composition-previews", compositionPreviewFilename(command.operation_id)),
    );
    await writeFile(path, "authoritative output");
    expect(await prepareCompositionPreviewPath(base, command.operation_id)).toBe(path);
    expect(await readFile(path, "utf8")).toBe("authoritative output");
    expect(await prepareCompositionPreviewPath(base, `dmp_${"6".repeat(32)}`)).not.toBe(path);
  });
  it("rejects symlinked cache roots and ancestors before touching a redirected directory", async () => {
    const base = await root();
    const outside = await root();
    await symlink(outside, join(base, "composition-previews"), "dir");
    await expect(prepareCompositionPreviewPath(base, command.operation_id)).rejects.toThrow(
      "plain local",
    );
    const linked = join(base, "linked");
    await symlink(outside, linked, "dir");
    await mkdir(join(outside, "child"));
    await expect(
      prepareCompositionPreviewPath(join(linked, "child"), command.operation_id),
    ).rejects.toThrow("plain local");
  });
  it("rejects traversal, network paths, invalid IDs and non-directory cache entries", async () => {
    const base = await root();
    for (const bad of ["relative", `${base}/../escape`, "//server/cache", `${base}\0suffix`])
      await expect(prepareCompositionPreviewPath(bad, command.operation_id)).rejects.toThrow();
    await expect(prepareCompositionPreviewPath(base, "../../escape")).rejects.toThrow("operation");
    await writeFile(join(base, "composition-previews"), "keep me");
    await expect(prepareCompositionPreviewPath(base, command.operation_id)).rejects.toThrow(
      "plain local",
    );
    expect(await readFile(join(base, "composition-previews"), "utf8")).toBe("keep me");
  });
  it("only passes an authenticated path-free saved-version command to a main-generated destination", async () => {
    const env = setup();
    await expect(
      env.invoke("createPreview", { ...command, output_path: "/tmp/attack.mp4" }),
    ).rejects.toThrow("path-free");
    expect(env.prepare).not.toHaveBeenCalled();
    env.event.top = false;
    await expect(env.invoke("createPreview", command)).rejects.toThrow("not authorized");
    env.event.top = true;
    expect(await env.invoke("createPreview", command)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(env.prepare).toHaveBeenCalledExactlyOnceWith(command.operation_id);
    expect(env.client.createDraftExport).toHaveBeenCalledExactlyOnceWith(project, episode, {
      ...command,
      output_path: "/tmp/preview.mp4",
    });
    expect(env.picker).not.toHaveBeenCalled();
  });
  it("shares busy and unknown recovery with Save-dialog jobs during cache preparation", async () => {
    let finish!: (value: string) => void;
    const env = setup(
      vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const pending = env.invoke("createPreview", command);
    expect(await env.invoke("create", command)).toEqual({ kind: "PICKER_BUSY" });
    expect(await env.invoke("createPreview", command)).toEqual({ kind: "PICKER_BUSY" });
    expect(await env.invoke("get", command.operation_id)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await env.invoke("cancel", command.operation_id)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(env.client.getDraftExport).not.toHaveBeenCalled();
    expect(env.client.cancelDraftExport).not.toHaveBeenCalled();
    finish("/tmp/preview.mp4");
    await pending;
    await env.invoke("get", command.operation_id);
    expect(env.client.getDraftExport).toHaveBeenCalledWith(project, episode, command.operation_id);
  });
  it("treats cache failure as pre-claim and rechecks frame identity before backend submit", async () => {
    const env = setup(vi.fn().mockRejectedValue(new Error("unsafe cache")));
    expect(await env.invoke("createPreview", command)).toEqual({ kind: "CACHE_UNAVAILABLE" });
    expect(env.client.createDraftExport).not.toHaveBeenCalled();
    env.prepare.mockImplementation(async () => {
      env.event.top = false;
      return "/tmp/preview.mp4";
    });
    await expect(env.invoke("createPreview", command)).rejects.toThrow("sender changed");
    expect(env.client.createDraftExport).not.toHaveBeenCalled();
  });
});
