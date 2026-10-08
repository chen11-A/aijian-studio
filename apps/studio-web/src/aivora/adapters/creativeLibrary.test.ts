import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyCreativeContent,
  readCreativeJournal,
  readCreativeLibrary,
  saveCreativeLibrary,
  validCreativeContent,
} from "./creativeLibrary";
import type { CreativeGateway, CreativeVersion, CreativeWriteCommand } from "./creativeLibrary";

const project = `prj_${"a".repeat(32)}`;
const other = `prj_${"b".repeat(32)}`;
const operation = "123e4567-e89b-42d3-a456-426614174000";
function command(): CreativeWriteCommand {
  const content = emptyCreativeContent(project);
  content.characters = [
    {
      character_id: `chr_${"c".repeat(32)}`,
      ordinal: 1,
      name: "林澈",
      role: "调查员",
      description: "",
      appearance: "",
      personality: "",
    },
  ];
  return {
    operation_id: operation,
    payload: {
      content,
      parent_version_id: null,
      expected_revision: null,
      change_summary: "人工草稿",
    },
  };
}
function version(input = command()): CreativeVersion {
  return {
    version_id: `ver_${"d".repeat(32)}`,
    project_id: project,
    episode_id: null,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content: input.payload.content,
    content_hash: `sha256:${"e".repeat(64)}`,
    author_actor_id: "local-user",
    change_summary: "人工草稿",
    created_at: "2026-10-08T03:00:00Z",
  };
}
function gateway(saved = version()): CreativeGateway {
  return {
    getProjectCreativeLibrary: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: saved, request_id: operation } }),
    createProjectCreativeLibraryVersion: vi.fn().mockResolvedValue({
      kind: "CREATED",
      receipt: {
        data: { version: saved, replayed: false },
        request_id: operation,
      },
    }),
    getProjectCreativeLibraryVersion: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: saved, request_id: operation } }),
  };
}
beforeEach(() => localStorage.clear());
describe("project creative draft boundary", () => {
  it("validates canonical project IDs, scoped content, contiguous order and unique opaque identities", () => {
    expect(validCreativeContent(command().payload.content, project)).toBe(true);
    expect(validCreativeContent(command().payload.content, other)).toBe(false);
    const invalid = command().payload.content;
    invalid.characters.push({ ...invalid.characters[0]!, ordinal: 2 });
    expect(validCreativeContent(invalid, project)).toBe(false);
    invalid.characters = [{ ...invalid.characters[0]!, ordinal: 2 }];
    expect(validCreativeContent(invalid, project)).toBe(false);
  });
  it("requires immutable readback before clearing the operation journal or reporting saved", async () => {
    const api = gateway();
    vi.mocked(api.getProjectCreativeLibraryVersion).mockResolvedValueOnce({
      kind: "REMOTE_UNKNOWN",
    });
    expect((await saveCreativeLibrary(api, localStorage, project, command())).kind).toBe("UNKNOWN");
    expect(readCreativeJournal(localStorage, project).kind).toBe("PENDING");
    expect((await saveCreativeLibrary(api, localStorage, project, command())).kind).toBe("BLOCKED");
    expect(api.createProjectCreativeLibraryVersion).toHaveBeenCalledTimes(1);
    expect((await saveCreativeLibrary(api, localStorage, project, command(), true)).kind).toBe(
      "SAVED",
    );
    expect(api.createProjectCreativeLibraryVersion).toHaveBeenNthCalledWith(
      2,
      project,
      operation,
      command().payload,
    );
    expect(readCreativeJournal(localStorage, project).kind).toBe("EMPTY");
  });
  it("never acknowledges different content returned in a valid-looking create receipt", async () => {
    const wrong = version();
    wrong.content = { ...wrong.content, world: { ...wrong.content.world, premise: "外部改动" } };
    expect((await saveCreativeLibrary(gateway(wrong), localStorage, project, command())).kind).toBe(
      "UNKNOWN",
    );
    expect(readCreativeJournal(localStorage, project).kind).toBe("PENDING");
  });
  it("allows an original operation's immutable version with a newer mutable head revision", async () => {
    const saved = { ...version(), head_revision: 3 };
    const api = gateway(saved);
    vi.mocked(api.getProjectCreativeLibraryVersion).mockResolvedValue({
      kind: "FOUND",
      receipt: {
        data: { ...saved, head_revision: 4 },
        request_id: operation,
      },
    });
    const result = await saveCreativeLibrary(api, localStorage, project, command());
    expect(result.kind).toBe("SAVED");
    if (result.kind === "SAVED") expect(result.version.head_revision).toBe(4);
  });
  it("fails closed for unreadable journal storage and never submits", async () => {
    const storage = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const api = gateway();
    expect((await saveCreativeLibrary(api, storage, project, command())).kind).toBe("BLOCKED");
    expect(api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
  });
  it("separates an empty collection, read errors and cross-project responses", async () => {
    const api = gateway();
    expect((await readCreativeLibrary(api, other)).kind).toBe("UNKNOWN");
    vi.mocked(api.getProjectCreativeLibrary).mockResolvedValueOnce({ kind: "EMPTY" });
    expect((await readCreativeLibrary(api, project)).kind).toBe("EMPTY");
    vi.mocked(api.getProjectCreativeLibrary).mockResolvedValueOnce({
      kind: "DEFINITE_SERVER_ERROR",
      status: 403,
      code: "FORBIDDEN",
      request_id: operation,
    });
    expect((await readCreativeLibrary(api, project)).kind).toBe("REJECTED");
  });
});
