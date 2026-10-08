import { describe, expect, it } from "vitest";
import type { ProjectData } from "../../api/studio";
import { LatestRequestGate, mergeCreatedProject } from "./projectWorkspace";

const project = (id: string, name: string) => ({ id, name }) as ProjectData;

describe("project workspace adapter", () => {
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
