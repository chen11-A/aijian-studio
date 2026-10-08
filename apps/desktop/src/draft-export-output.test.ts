import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_EXPORT_CHANNELS,
  type DraftExportJob,
  type DraftExportResult,
} from "./draft-export-contract";
import type { DraftExportClient } from "./draft-export-ipc";
import { registerDraftExportOutputHandlers } from "./draft-export-output-ipc";
import {
  accessDraftExportOutput,
  DRAFT_OUTPUT_LIMIT,
  DRAFT_PREVIEW_LIMIT,
  DRAFT_VERIFY_TIMEOUT_MS,
} from "./draft-export-output";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const operation = `dmp_${"c".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";
function mp4(size = 64) {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftypisom", 4, "ascii");
  bytes.write("isommp41", 16, "ascii");
  return bytes;
}
let directory: string;
let path: string;
let bytes: Buffer;
let job: DraftExportJob;
beforeEach(async () => {
  directory = await mkdtemp(join(await realpath(tmpdir()), "aivora-output-"));
  path = join(directory, "test-DRAFT.mp4");
  bytes = mp4();
  await writeFile(path, bytes);
  job = {
    operation_id: operation,
    project_id: project,
    episode_id: episode,
    assembly_version_id: `ver_${"d".repeat(32)}`,
    assembly_content_hash: `sha256:${"e".repeat(64)}`,
    status: "SUCCEEDED",
    progress_frames: 50,
    total_frames: 50,
    output_filename: basename(path),
    output_path: path,
    output_sha256: createHash("sha256").update(bytes).digest("hex"),
    output_bytes: bytes.length,
    error_code: null,
    error_message: null,
    created_at: "2026-10-08T00:00:00Z",
    updated_at: "2026-10-08T00:00:00Z",
    toolchain_profile_id: "test-pinned",
    draft: true,
    rights_declaration: "OWNED_OR_SYNTHETIC",
  };
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
function setup(result?: DraftExportResult) {
  const client: DraftExportClient = {
    listDraftExports: vi.fn(),
    createDraftExport: vi.fn(),
    cancelDraftExport: vi.fn(),
    getDraftExport: vi.fn().mockImplementation(
      async () =>
        result ?? {
          kind: "FOUND",
          receipt: { data: job, request_id: requestId },
        },
    ),
  };
  const reveal = vi.fn<(path: string) => void>();
  const access = (action: "preview" | "reveal" = "preview") =>
    accessDraftExportOutput(client, project, episode, operation, action, reveal);
  return { client, access, reveal };
}
const unavailable = (code: string) => ({ kind: "OUTPUT_UNAVAILABLE", code });

describe("verified DRAFT output access", () => {
  it("reads bounded verified bytes with receipt identity and fetches fresh on each access", async () => {
    const env = setup();
    const result = await env.access();
    expect(result).toEqual({
      kind: "READY",
      mime_type: "video/mp4",
      bytes: new Uint8Array(bytes),
      identity: {
        project_id: project,
        episode_id: episode,
        operation_id: operation,
        output_sha256: job.output_sha256,
        output_bytes: bytes.length,
      },
    });
    expect(result).not.toHaveProperty("output_path");
    expect(env.reveal).not.toHaveBeenCalled();
    expect((await env.access("reveal")).kind).toBe("REVEALED");
    expect(env.reveal).toHaveBeenCalledExactlyOnceWith(path);
    expect(env.client.getDraftExport).toHaveBeenCalledTimes(2);
    expect(env.client.getDraftExport).toHaveBeenCalledWith(project, episode, operation);
  });
  it("does not turn unknown, missing or rejected receipt reads into success", async () => {
    for (const result of [
      { kind: "REMOTE_UNKNOWN" },
      { kind: "NOT_FOUND", request_id: requestId },
      { kind: "DEFINITE_SERVER_ERROR", status: 403, code: "DENIED", request_id: requestId },
    ] as const) {
      const env = setup(result);
      expect(await env.access("reveal")).toEqual(result);
      expect(env.reveal).not.toHaveBeenCalled();
    }
    const env = setup();
    vi.mocked(env.client.getDraftExport).mockRejectedValue(new Error("offline"));
    expect(await env.access()).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  it("requires a scoped successful receipt with canonical hash, size and request identity", async () => {
    for (const patch of [
      { project_id: `prj_${"f".repeat(32)}` },
      { episode_id: `ep_${"f".repeat(32)}` },
      { operation_id: `dmp_${"f".repeat(32)}` },
      { output_sha256: "sha256:" + "a".repeat(64) },
      { output_bytes: 0 },
      { draft: false },
    ]) {
      const env = setup({
        kind: "FOUND",
        receipt: {
          data: { ...job, ...patch } as DraftExportJob,
          request_id: requestId,
        },
      });
      expect(await env.access()).toEqual(unavailable("RECEIPT_MISMATCH"));
    }
    const invalidRequest = setup({ kind: "FOUND", receipt: { data: job, request_id: "bad" } });
    expect(await invalidRequest.access()).toEqual(unavailable("RECEIPT_MISMATCH"));
    for (const status of [
      "QUEUED",
      "RUNNING",
      "VERIFYING",
      "FAILED",
      "INTERRUPTED",
      "CANCELLED",
    ] as const) {
      const env = setup({
        kind: "FOUND",
        receipt: {
          data: { ...job, status, output_path: null, output_sha256: null, output_bytes: null },
          request_id: requestId,
        },
      });
      expect(await env.access("reveal")).toEqual(unavailable("NOT_SUCCEEDED"));
      expect(env.reveal).not.toHaveBeenCalled();
    }
  });
  it("rejects absent, changed-sized, corrupted and non-MP4 output files", async () => {
    const env = setup();
    await rm(path);
    expect(await env.access()).toEqual(unavailable("FILE_UNAVAILABLE"));
    await writeFile(path, bytes.subarray(1));
    expect(await env.access()).toEqual(unavailable("FILE_CHANGED"));
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] = 42;
    await writeFile(path, changed);
    expect(await env.access("reveal")).toEqual(unavailable("HASH_MISMATCH"));
    changed.write("webm", 4, "ascii");
    await writeFile(path, changed);
    job.output_sha256 = createHash("sha256").update(changed).digest("hex");
    expect(await env.access()).toEqual(unavailable("INVALID_MP4"));
    expect(env.reveal).not.toHaveBeenCalled();
  });
  it("rejects untrusted path forms without substituting normalized locations", async () => {
    const env = setup();
    for (const candidate of [
      "relative.mp4",
      `${directory}/../test-DRAFT.mp4`,
      `${directory}/./test-DRAFT.mp4`,
      `${directory}//test-DRAFT.mp4`,
      "//server/share/test-DRAFT.mp4",
      "\\\\server\\share\\test-DRAFT.mp4",
      "\\\\?\\C:\\test-DRAFT.mp4",
      "/dev/test-DRAFT.mp4",
      "/proc/test-DRAFT.mp4",
      "/sys/test-DRAFT.mp4",
      "C:\\test-DRAFT.mp4",
      `${directory}/test\n-DRAFT.mp4`,
    ]) {
      job.output_path = candidate;
      expect(await env.access()).toEqual(unavailable("UNSAFE_PATH"));
    }
    job.output_path = path;
    job.output_filename = "another-DRAFT.mp4";
    expect(await env.access()).toEqual(unavailable("UNSAFE_PATH"));
    expect(env.reveal).not.toHaveBeenCalled();
  });
  it("rejects final symlinks and linked ancestors rather than following them", async () => {
    const env = setup();
    const target = join(directory, "actual.mp4");
    await writeFile(target, bytes);
    await rm(path);
    await symlink(target, path, "file");
    expect(await env.access()).toEqual(unavailable("UNSAFE_PATH"));
    const actualDirectory = join(directory, "actual");
    const alias = join(directory, "alias");
    await mkdir(actualDirectory);
    await writeFile(join(actualDirectory, job.output_filename), bytes);
    await symlink(actualDirectory, alias, process.platform === "win32" ? "junction" : "dir");
    job.output_path = join(alias, job.output_filename);
    expect(await env.access("reveal")).toEqual(unavailable("UNSAFE_PATH"));
    expect(env.reveal).not.toHaveBeenCalled();
  });
  it("rejects a directory even if its name ends in mp4", async () => {
    await rm(path);
    await mkdir(path);
    expect(await setup().access()).toEqual(unavailable("UNSAFE_PATH"));
  });
  it("refuses oversized previews but hashes and reveals the same bounded larger output", async () => {
    const large = mp4(DRAFT_PREVIEW_LIMIT + 1);
    await writeFile(path, large);
    job.output_bytes = large.length;
    job.output_sha256 = createHash("sha256").update(large).digest("hex");
    const env = setup();
    expect(await env.access()).toEqual({
      kind: "PREVIEW_TOO_LARGE",
      output_bytes: large.length,
      limit_bytes: DRAFT_PREVIEW_LIMIT,
    });
    expect(env.reveal).not.toHaveBeenCalled();
    expect((await env.access("reveal")).kind).toBe("REVEALED");
    expect(env.reveal).toHaveBeenCalledExactlyOnceWith(path);
    job.output_bytes = DRAFT_OUTPUT_LIMIT + 1;
    expect(await env.access("reveal")).toEqual(unavailable("OUTPUT_TOO_LARGE"));
  });
  it("rejects growth and path replacement during a bounded read", async () => {
    for (const mutate of [
      () => appendFileSync(path, new Uint8Array([1])),
      () => {
        renameSync(path, join(directory, "replaced.mp4"));
        writeFileSync(path, bytes);
      },
    ]) {
      await writeFile(path, bytes);
      let calls = 0;
      const clock = vi.spyOn(performance, "now").mockImplementation(() => {
        if (++calls === 2) mutate();
        return 0;
      });
      try {
        const env = setup();
        expect(await env.access("reveal")).toEqual(unavailable("FILE_CHANGED"));
        expect(env.reveal).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
      }
    }
  });
  it("fails closed when read verification exceeds its wall-time limit", async () => {
    let calls = 0;
    const clock = vi
      .spyOn(performance, "now")
      .mockImplementation(() => (++calls === 1 ? 0 : DRAFT_VERIFY_TIMEOUT_MS + 1));
    try {
      const env = setup();
      expect(await env.access("reveal")).toEqual(unavailable("FILE_UNAVAILABLE"));
      expect(env.reveal).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it("reports a failed OS reveal instead of silently claiming success", async () => {
    const env = setup();
    env.reveal.mockImplementation(() => {
      throw new Error("no file manager");
    });
    expect(await env.access("reveal")).toEqual(unavailable("REVEAL_FAILED"));
  });
});

describe("DRAFT output IPC boundary", () => {
  function ipcSetup() {
    const env = setup();
    const clientFor = vi.fn(() => env.client);
    const handlers = new Map<
      string,
      (event: { top: boolean }, ...args: unknown[]) => Promise<unknown>
    >();
    registerDraftExportOutputHandlers(
      (channel, handler) => handlers.set(channel, handler),
      clientFor,
      (event: { top: boolean }) => event.top,
      env.reveal,
    );
    return { ...env, clientFor, handlers };
  }
  it("authorizes the top frame before any receipt request and accepts only three canonical IDs", async () => {
    const env = ipcSetup();
    for (const action of ["preview", "reveal"] as const) {
      const handler = env.handlers.get(DRAFT_EXPORT_CHANNELS[action])!;
      await expect(handler({ top: false }, project, episode, operation)).rejects.toThrow(
        "not authorized",
      );
      for (const args of [
        ["../escape", episode, operation],
        [project, "/tmp/escape", operation],
        [project, episode, path],
        [project, episode, { operation_id: operation, path }],
        [project, episode, operation, path],
        [project, episode],
      ])
        await expect(handler({ top: true }, ...args)).rejects.toThrow("only canonical");
    }
    expect(env.client.getDraftExport).not.toHaveBeenCalled();
    expect(env.reveal).not.toHaveBeenCalled();
    const result = await env.handlers.get(DRAFT_EXPORT_CHANNELS.preview)!(
      { top: true },
      project,
      episode,
      operation,
    );
    expect(result).toMatchObject({ kind: "READY", mime_type: "video/mp4" });
  });
  it("serializes output verification across operations and releases the slot after failure", async () => {
    const env = ipcSetup();
    let finish!: (result: DraftExportResult) => void;
    vi.mocked(env.client.getDraftExport).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const preview = env.handlers.get(DRAFT_EXPORT_CHANNELS.preview)!;
    const reveal = env.handlers.get(DRAFT_EXPORT_CHANNELS.reveal)!;
    const pending = preview({ top: true }, project, episode, operation);
    expect(await preview({ top: true }, project, episode, operation)).toEqual(
      unavailable("OUTPUT_BUSY"),
    );
    expect(await reveal({ top: true }, project, episode, `dmp_${"f".repeat(32)}`)).toEqual(
      unavailable("OUTPUT_BUSY"),
    );
    expect(env.client.getDraftExport).toHaveBeenCalledTimes(1);
    expect(env.reveal).not.toHaveBeenCalled();
    finish({ kind: "REMOTE_UNKNOWN" });
    expect(await pending).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await reveal({ top: true }, project, episode, operation)).toMatchObject({
      kind: "REVEALED",
    });
    expect(env.client.getDraftExport).toHaveBeenCalledTimes(2);
  });
  it("rechecks authorization after async verification and before revealing", async () => {
    for (const action of ["preview", "reveal"] as const) {
      const env = ipcSetup();
      const event = { top: true };
      vi.mocked(env.client.getDraftExport).mockImplementation(async () => {
        event.top = false;
        return { kind: "FOUND", receipt: { data: job, request_id: requestId } };
      });
      await expect(
        env.handlers.get(DRAFT_EXPORT_CHANNELS[action])!(event, project, episode, operation),
      ).rejects.toThrow("sender changed");
      expect(env.reveal).not.toHaveBeenCalled();
    }
  });
});
