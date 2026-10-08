import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, open, realpath, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { shell, type IpcMainInvokeEvent } from "electron";

import { DevelopmentExportGetError, type LocalApiClient } from "./api-client";
import {
  isDevelopmentExportCreateInput,
  isDevelopmentExportIdentity,
  isDevelopmentExportSha256,
  type DevelopmentExportOpenResult,
  type DevelopmentExportPreviewResult,
  type DevelopmentExportSaveResult,
  type DevelopmentExportResponse,
} from "./development-export-contract";

type Registrar = (
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
) => void;
type ClientFor = (event: IpcMainInvokeEvent) => LocalApiClient;
type SelectOutput = (suggestedName: string) => Promise<string | null>;
const MAX_DEVELOPMENT_EXPORT_PREVIEW_BYTES = 64 * 1024 * 1024;

function within(root: string, path: string): boolean {
  const remainder = relative(resolve(root), resolve(path));
  return remainder.length > 0 && !isAbsolute(remainder) &&
    remainder !== ".." && !remainder.startsWith(`..${sep}`);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

async function verifiedFile(
  response: DevelopmentExportResponse,
  workspaceRoot: string,
): Promise<string | null> {
  if (response.data.status !== "SUCCEEDED") return null;
  const output = response.data.output;
  const expected = `exports/development-timeline/${response.data.project_id}/${response.data.export_id}.mp4`;
  if (output.relative_path !== expected) return null;
  const candidate = resolve(workspaceRoot, ...expected.split("/"));
  if (!within(workspaceRoot, candidate)) return null;
  try {
    const realRoot = await realpath(workspaceRoot);
    const realFile = await realpath(candidate);
    if (!within(realRoot, realFile)) return null;
    const metadata = await stat(realFile);
    if (!metadata.isFile() || metadata.size !== output.byte_length) return null;
    return (await sha256File(realFile)) === output.sha256 ? realFile : null;
  } catch {
    return null;
  }
}

async function verifiedPreviewBytes(
  response: DevelopmentExportResponse,
  workspaceRoot: string,
): Promise<ArrayBuffer | null> {
  if (response.data.status !== "SUCCEEDED") return null;
  const { output, project_id: projectId, export_id: exportId } = response.data;
  const expected = `exports/development-timeline/${projectId}/${exportId}.mp4`;
  if (output.workspace_scope !== "SIDECAR_WORKSPACE" || output.relative_path !== expected ||
      output.mime_type !== "video/mp4" || !isDevelopmentExportSha256(output.sha256) ||
      !Number.isSafeInteger(output.byte_length) || output.byte_length <= 0 ||
      output.byte_length > MAX_DEVELOPMENT_EXPORT_PREVIEW_BYTES) return null;
  const candidate = resolve(workspaceRoot, ...expected.split("/"));
  if (!within(workspaceRoot, candidate)) return null;
  try {
    const realRoot = await realpath(workspaceRoot);
    const realFile = await realpath(candidate);
    if (!within(realRoot, realFile)) return null;
    const handle = await open(realFile, "r");
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== output.byte_length) return null;
      const bytes = new ArrayBuffer(output.byte_length);
      const view = Buffer.from(bytes);
      const hash = createHash("sha256");
      let offset = 0;
      while (offset < view.byteLength) {
        const length = Math.min(1024 * 1024, view.byteLength - offset);
        const { bytesRead } = await handle.read(view, offset, length, offset);
        if (bytesRead === 0) return null;
        hash.update(view.subarray(offset, offset + bytesRead));
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== output.byte_length ||
          `sha256:${hash.digest("hex")}` !== output.sha256) return null;
      return bytes;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function identity(args: unknown[]): [string, string, string, number] {
  if (args.length !== 4 ||
      !isDevelopmentExportIdentity(args[0], args[1], args[2], args[3])) {
    throw new Error("Invalid development export identity");
  }
  return args as [string, string, string, number];
}

async function receiptForAction(
  client: LocalApiClient,
  projectId: string,
  operationId: string,
  timelineVersionId: string,
  expectedRevision: number,
): Promise<DevelopmentExportResponse | { kind: "REMOTE_UNKNOWN" | "UNAVAILABLE" }> {
  try {
    return await client.getDevelopmentExport(projectId, operationId,
      timelineVersionId, expectedRevision);
  } catch (error) {
    if (error instanceof DevelopmentExportGetError) return { kind: error.kind };
    throw error;
  }
}

export function registerDevelopmentExportHandlers(
  register: Registrar,
  clientFor: ClientFor,
  workspaceRoot: () => string,
  selectOutput: SelectOutput,
): void {
  let previewInProgress = false;
  register("development-exports:create", async (event, ...args) => {
    const client = clientFor(event);
    if (args.length !== 2 || typeof args[0] !== "string" ||
        !/^prj_[0-9a-f]{32}$/.test(args[0]) || !isDevelopmentExportCreateInput(args[1])) {
      throw new Error("Invalid development export create command");
    }
    return client.createDevelopmentExport(args[0], args[1]);
  });
  register("development-exports:get", async (event, ...args) => {
    const client = clientFor(event);
    return client.getDevelopmentExport(...identity(args));
  });
  register("development-exports:read-preview", async (event, ...args): Promise<DevelopmentExportPreviewResult> => {
    const client = clientFor(event);
    if (args.length !== 5 || !isDevelopmentExportSha256(args[4])) {
      throw new Error("Invalid development export preview identity");
    }
    const [projectId, operationId, timelineVersionId, expectedRevision] = identity(args.slice(0, 4));
    if (previewInProgress) return { kind: "UNAVAILABLE", operation_id: operationId };
    previewInProgress = true;
    try {
      const response = await receiptForAction(client, projectId, operationId,
        timelineVersionId, expectedRevision);
      if ("kind" in response) return { kind: response.kind, operation_id: operationId };
      if (response.data.status === "UNKNOWN") {
        return { kind: "REMOTE_UNKNOWN", operation_id: operationId };
      }
      if (response.data.output.sha256 !== args[4]) {
        return { kind: "UNAVAILABLE", operation_id: operationId };
      }
      if (response.data.output.byte_length > MAX_DEVELOPMENT_EXPORT_PREVIEW_BYTES) {
        return { kind: "PREVIEW_TOO_LARGE", operation_id: operationId };
      }
      const bytes = await verifiedPreviewBytes(response, workspaceRoot());
      return bytes === null
        ? { kind: "UNAVAILABLE", operation_id: operationId }
        : { kind: "READY", export_id: response.data.export_id,
            sha256: response.data.output.sha256, mime_type: "video/mp4", bytes };
    } finally {
      previewInProgress = false;
    }
  });
  register("development-exports:open", async (event, ...args): Promise<DevelopmentExportOpenResult> => {
    const client = clientFor(event);
    const [projectId, operationId, timelineVersionId, expectedRevision] = identity(args);
    const response = await receiptForAction(client, projectId, operationId,
      timelineVersionId, expectedRevision);
    if ("kind" in response) return { kind: response.kind, operation_id: operationId };
    if (response.data.status === "UNKNOWN") return { kind: "REMOTE_UNKNOWN", operation_id: operationId };
    const path = await verifiedFile(response, workspaceRoot());
    if (path === null) return { kind: "UNAVAILABLE", operation_id: operationId };
    try {
      return (await shell.openPath(path)) === ""
        ? { kind: "OPENED", export_id: response.data.export_id }
        : { kind: "UNAVAILABLE", operation_id: operationId };
    } catch {
      return { kind: "UNAVAILABLE", operation_id: operationId };
    }
  });
  register("development-exports:save", async (event, ...args): Promise<DevelopmentExportSaveResult> => {
    const client = clientFor(event);
    const [projectId, operationId, timelineVersionId, expectedRevision] = identity(args);
    const response = await receiptForAction(client, projectId, operationId,
      timelineVersionId, expectedRevision);
    if ("kind" in response) return { kind: response.kind, operation_id: operationId };
    if (response.data.status === "UNKNOWN") return { kind: "REMOTE_UNKNOWN", operation_id: operationId };
    const source = await verifiedFile(response, workspaceRoot());
    if (source === null) return { kind: "UNAVAILABLE", operation_id: operationId };
    const selected = await selectOutput(`${response.data.export_id}.mp4`);
    if (selected === null) return { kind: "CANCELLED", operation_id: operationId };
    let createdDestination: string | null = null;
    try {
      if (!isAbsolute(selected) || !selected.toLowerCase().endsWith(".mp4")) {
        return { kind: "UNAVAILABLE", operation_id: operationId };
      }
      const parent = await realpath(dirname(selected));
      const destination = resolve(parent, basename(selected));
      if (destination === source || within(await realpath(workspaceRoot()), destination)) {
        return { kind: "UNAVAILABLE", operation_id: operationId };
      }
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      createdDestination = destination;
      const copied = await stat(destination);
      if (copied.size !== response.data.output.byte_length ||
          (await sha256File(destination)) !== response.data.output.sha256) {
        throw new Error("Development export copy verification failed");
      }
      return { kind: "SAVED", export_id: response.data.export_id };
    } catch {
      if (createdDestination !== null) {
        try {
          await unlink(createdDestination);
        } catch {
          throw new Error("DEVELOPMENT_EXPORT_SAVE_CLEANUP_FAILED");
        }
      }
      return { kind: "UNAVAILABLE", operation_id: operationId };
    }
  });
}
