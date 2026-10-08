import { describe, expect, test, vi } from "vitest";

import type {
  FakeTimelineRunCapability,
  ProjectData,
  SourceDocumentResponse,
  SourceManifestResponse,
} from "./api/studio";
import { createFakeTimelineRunOperationJournal } from "./fake-timeline-run-operation-journal";
import { createFakeTimelineDevelopmentCoordinator } from "./fake-timeline-run-development";

const projectId = `prj_${"1".repeat(32)}`;
const secondProjectId = `prj_${"4".repeat(32)}`;
const sourceId = `src_${"2".repeat(32)}`;
const versionId = `ver_${"3".repeat(32)}`;
const operationId = "7e0df32e-299a-4bb7-b77e-b85f20c41d61";
type FakeTimelineCreate = FakeTimelineRunCapability["create"];
type FakeTimelineCreateResult = Awaited<ReturnType<FakeTimelineCreate>>;
const project = { id: projectId } as ProjectData;
const source = { data: { id: sourceId, project_id: projectId } } as SourceDocumentResponse;
const manifest = {
  data: {
    project_id: projectId,
    head: { accepted_version_id: versionId },
    accepted_version: {
      id: versionId,
      content: { documents: [{ source_document_id: sourceId }] },
    },
  },
} as SourceManifestResponse;

function journal(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  const entries = new Map<string, string>();
  return createFakeTimelineRunOperationJournal(
    storage ?? {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    },
    { operationId: () => operationId, now: () => "2026-08-11T10:00:00.000Z" },
  );
}

describe("fake timeline development coordinator", () => {
  test("serializes same-tick create and recovery, then permits a completed recovery to submit again", async () => {
    const resolves: Array<(value: FakeTimelineCreateResult) => void> = [];
    const create = vi.fn<FakeTimelineCreate>(
      (_projectId, _command) =>
        new Promise<FakeTimelineCreateResult>((resolve) => {
          resolves.push(resolve);
        }),
    );
    const coordinator = createFakeTimelineDevelopmentCoordinator({
      journal: journal(),
      capability: { create } as FakeTimelineRunCapability,
      loadManifest: vi.fn().mockResolvedValue(manifest),
    });
    const scope = coordinator.activate(projectId);
    const first = coordinator.submit(scope, project, source);
    const duplicate = coordinator.submit(scope, project, source);
    expect(first).toBe(duplicate);
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    resolves.shift()!({ kind: "REMOTE_UNKNOWN" });
    await expect(first).resolves.toMatchObject({ kind: "submission", deliver: true });

    const recover = coordinator.submit(scope, project, source);
    const duplicateRecover = coordinator.submit(scope, project, source);
    expect(recover).toBe(duplicateRecover);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[1]).toEqual({
      operation_id: operationId,
      input: { source_manifest_version_id: versionId, source_document_id: sourceId },
    });
    resolves.shift()!({ kind: "REMOTE_UNKNOWN" });
    await expect(recover).resolves.toMatchObject({ kind: "submission", deliver: true });

    const afterRecovery = coordinator.submit(scope, project, source);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    resolves.shift()!({ kind: "REMOTE_UNKNOWN" });
    await expect(afterRecovery).resolves.toMatchObject({ kind: "submission", deliver: true });
  });

  test("rejects project-mismatched and stale scopes before manifest, journal, or capability side effects", async () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const loadManifest = vi.fn().mockResolvedValue(manifest);
    const create = vi.fn<FakeTimelineCreate>();
    const coordinator = createFakeTimelineDevelopmentCoordinator({
      journal: journal({ getItem, setItem, removeItem }),
      capability: { create } as FakeTimelineRunCapability,
      loadManifest,
    });
    const scopeA = coordinator.activate(projectId);
    const projectB = { id: secondProjectId } as ProjectData;
    const sourceB = {
      data: { id: `src_${"5".repeat(32)}`, project_id: secondProjectId },
    } as SourceDocumentResponse;

    await expect(coordinator.submit(scopeA, projectB, sourceB)).resolves.toEqual({
      kind: "scope-unavailable",
      reason: "scope-project-mismatch",
      projectId,
      deliver: false,
    });
    coordinator.activate(secondProjectId);
    await expect(coordinator.submit(scopeA, project, source)).resolves.toEqual({
      kind: "scope-unavailable",
      reason: "stale-scope",
      projectId,
      deliver: false,
    });
    expect(loadManifest).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("does not deliver an old project result into an activated new project scope", async () => {
    let resolveCreate!: (value: FakeTimelineCreateResult) => void;
    const create = vi.fn<FakeTimelineCreate>(
      (_projectId, _command) =>
        new Promise<FakeTimelineCreateResult>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const coordinator = createFakeTimelineDevelopmentCoordinator({
      journal: journal(),
      capability: { create },
      loadManifest: vi.fn().mockResolvedValue(manifest),
    });
    const scopeA = coordinator.activate(projectId);
    const pending = coordinator.submit(scopeA, project, source);
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    coordinator.activate(secondProjectId);
    resolveCreate({ kind: "REMOTE_UNKNOWN" });

    await expect(pending).resolves.toMatchObject({ kind: "submission", projectId, deliver: false });
  });

  test("distinguishes manifest transport failure from a corrupt development journal", async () => {
    const unavailable = createFakeTimelineDevelopmentCoordinator({
      journal: journal(),
      capability: { create: vi.fn() },
      loadManifest: vi.fn().mockRejectedValue(new Error("sidecar unavailable")),
    });
    const unavailableScope = unavailable.activate(projectId);
    await expect(unavailable.submit(unavailableScope, project, source)).resolves.toEqual({
      kind: "manifest-unavailable",
      projectId,
      deliver: true,
    });

    const corruptStorage = {
      getItem: () => "{not-json",
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const corrupt = createFakeTimelineDevelopmentCoordinator({
      journal: createFakeTimelineRunOperationJournal(corruptStorage),
      capability: { create: vi.fn() },
      loadManifest: vi.fn().mockResolvedValue(manifest),
    });
    const corruptScope = corrupt.activate(projectId);
    await expect(corrupt.submit(corruptScope, project, source)).resolves.toEqual({
      kind: "journal-corrupt",
      projectId,
      deliver: true,
    });
  });
});
