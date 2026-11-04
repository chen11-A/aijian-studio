import { describe, expect, it, vi } from "vitest";
import type { ProjectData, StudioTransport, CreateProjectInput } from "../../api/studio";
import { createWorkspaceProject, LatestRequestGate, mergeCreatedProject } from "./projectWorkspace";

const project = (id: string, name: string) => ({ id, name }) as ProjectData;

describe("project workspace adapter", () => {
  it.each(["9:16", "16:9"] as const)(
    "checks the creation receipt against captured %s selection",
    async (aspect) => {
      const input: CreateProjectInput = {
        name: "new",
        aspect_ratio: aspect,
        source_language: "zh-CN",
        target_duration_seconds: 60,
      };
      const data = { ...project("new", "new"), ...input };
      const createProject = vi.fn().mockResolvedValue({ data });
      const transport = { createProject } as unknown as StudioTransport;
      expect(await createWorkspaceProject(transport, input)).toEqual({
        kind: "SUCCEEDED",
        project: data,
      });
      expect(createProject).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["9:16", "1:1", null, undefined])(
    "keeps mismatched or invalid receipt %s UNKNOWN without retry",
    async (returnedAspect) => {
      const createProject = vi
        .fn()
        .mockResolvedValue({ data: { ...project("new", "new"), aspect_ratio: returnedAspect } });
      expect(
        await createWorkspaceProject({ createProject } as unknown as StudioTransport, {
          name: "new",
          aspect_ratio: "16:9",
          source_language: "zh-CN",
          target_duration_seconds: 60,
        }),
      ).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(createProject).toHaveBeenCalledTimes(1);
    },
  );
  it("captures selection before await and rejects a later-mutated opposite receipt", async () => {
    let resolve!: (value: unknown) => void;
    const createProject = vi.fn().mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const input: CreateProjectInput = {
      name: "new",
      aspect_ratio: "16:9",
      source_language: "zh-CN",
      target_duration_seconds: 60,
    };
    const pending = createWorkspaceProject({ createProject } as unknown as StudioTransport, input);
    input.aspect_ratio = "9:16";
    resolve({ data: { ...project("new", "new"), aspect_ratio: "9:16" } });
    expect(await pending).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(createProject).toHaveBeenCalledTimes(1);
  });
  it("rejects stale responses and replaces an existing project without duplication", () => {
    const gate = new LatestRequestGate();
    const old = gate.begin();
    const current = gate.begin();
    expect(gate.isCurrent(old)).toBe(false);
    expect(gate.isCurrent(current)).toBe(true);
    expect(
      mergeCreatedProject(
        [project("one", "old"), project("two", "two")],
        project("one", "new"),
      ).map((item) => item.name),
    ).toEqual(["new", "two"]);
  });
});
