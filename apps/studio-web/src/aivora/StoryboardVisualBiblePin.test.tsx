import { useState } from "react";
import { webcrypto } from "node:crypto";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "../../../desktop/src/visual-bible.testFixtures.json";
import type { AijianDesktopBridge } from "../api/studio";
import { withStoryboardPlanning, type StoryboardContent } from "./adapters/episodeStoryboard";
import type { CreativeVersion } from "./adapters/creativeLibrary";
import { StoryboardVisualBiblePin } from "./StoryboardVisualBiblePin";
const p = fixture.project_id,
  ep = "ep_" + "a".repeat(32);
const found = <T,>(data: T) => ({ kind: "FOUND" as const, data, request_id: fixture.request_id });
const board = (episode = ep): StoryboardContent => ({
  schema_version: "1.1.0",
  project_id: p,
  episode_id: episode,
  fps: 24,
  script_version_id: null,
  creative_library_version_id: fixture.library.version_id,
  shots: [
    {
      shot_id: "shp_" + "b".repeat(32),
      ordinal: 1,
      title: "保留镜头",
      description: "原文字",
      camera: "",
      action: "",
      dialogue: "",
      duration_frames: 48,
      script_scene_id: null,
      location_id: null,
      character_ids: [],
      character_bindings: [],
    },
  ],
});
function bridge(status = "CURRENT") {
  const g = {
    getVisualBible: vi.fn().mockResolvedValue(
      found({
        ...fixture.index,
        head: { ...fixture.saved.head, accepted_version_id: fixture.saved.version.id },
        review_version: null,
        accepted_version: fixture.saved.version,
      }),
    ),
    getVisualBibleVersion: vi.fn().mockResolvedValue(found(fixture.saved)),
    getVisualBibleAuthority: vi.fn().mockResolvedValue(
      found({
        project_id: p,
        version_id: fixture.saved.version.id,
        content_hash: fixture.saved.version.content_hash,
        status,
        gate_decision_id: "dec_" + "d".repeat(32),
        blocking: status === "CURRENT" ? [] : ["changed"],
      }),
    ),
    getProjectCreativeLibraryVersion: vi.fn().mockResolvedValue({
      kind: "FOUND",
      receipt: { data: fixture.library, request_id: fixture.request_id },
    }),
  };
  window.aijian = g as unknown as AijianDesktopBridge;
  return g;
}
function Harness({ initial = board() }: { initial?: StoryboardContent }) {
  const [content, edit] = useState(initial);
  return (
    <>
      <StoryboardVisualBiblePin
        content={content}
        library={fixture.library as CreativeVersion}
        locked={false}
        edit={edit}
      />
      <output data-testid="content">{JSON.stringify(content)}</output>
    </>
  );
}
beforeEach(() => {
  Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  delete window.aijian;
  vi.restoreAllMocks();
});
async function inspect() {
  fireEvent.click(screen.getByRole("button", { name: "检查当前批准G5版本" }));
  await screen.findByRole("button", { name: "固定此批准视觉和设定版本" });
}
describe("explicit G5 consumption in both storyboard entry points", () => {
  it("binding and explicit unbinding retain the planning schema and all saved shot intent", async () => {
    bridge();
    const initial = withStoryboardPlanning(board(), board().shots[0]!.shot_id, {
      coverage_notes: "完整覆盖",
      continuity_notes: "造型连续",
      transition_notes: "切到远景",
    });
    render(<Harness initial={initial} />);
    await inspect();
    fireEvent.click(screen.getByRole("button", { name: "固定此批准视觉和设定版本" }));
    const bound = JSON.parse(screen.getByTestId("content").textContent!);
    expect(bound.schema_version).toBe("1.3.0");
    expect(bound.visual_bible_pin.version_id).toBe(fixture.saved.version.id);
    expect(bound.shots).toEqual(initial.shots);
    fireEvent.click(screen.getByRole("button", { name: "解除G5批准引用" }));
    const unbound = JSON.parse(screen.getByTestId("content").textContent!);
    expect(unbound.schema_version).toBe("1.3.0");
    expect(unbound.visual_bible_pin).toBeNull();
    expect(unbound.shots).toEqual(initial.shots);
  });
  it("inspection never binds; explicit binding preserves every shot and can be explicitly cleared", async () => {
    bridge();
    render(<Harness />);
    await inspect();
    expect(JSON.parse(screen.getByTestId("content").textContent!).schema_version).toBe("1.1.0");
    fireEvent.click(screen.getByRole("button", { name: "固定此批准视觉和设定版本" }));
    let value = JSON.parse(screen.getByTestId("content").textContent!);
    expect(value.visual_bible_pin).toEqual({
      version_id: fixture.saved.version.id,
      content_hash: fixture.saved.version.content_hash,
    });
    expect(value.shots).toEqual(board().shots);
    fireEvent.click(screen.getByRole("button", { name: "解除G5批准引用" }));
    value = JSON.parse(screen.getByTestId("content").textContent!);
    expect(value.schema_version).toBe("1.2.0");
    expect(value.visual_bible_pin).toBe(null);
    expect(value.shots).toEqual(board().shots);
  });
  it.each(["UNAPPROVED", "SUPERSEDED", "EVIDENCE_CHANGED"])(
    "refuses %s as a new binding",
    async (status) => {
      bridge(status);
      render(<Harness />);
      fireEvent.click(screen.getByRole("button", { name: "检查当前批准G5版本" }));
      await screen.findByText(/当前批准版本未通过核对/);
      expect(screen.queryByRole("button", { name: "固定此批准视觉和设定版本" })).toBe(null);
      expect(JSON.parse(screen.getByTestId("content").textContent!).schema_version).toBe("1.1.0");
    },
  );
  it("refuses a hash mismatch without modifying episode inputs", async () => {
    const g = bridge();
    g.getVisualBibleAuthority.mockResolvedValue(
      found({
        project_id: p,
        version_id: fixture.saved.version.id,
        content_hash: "sha256:" + "0".repeat(64),
        status: "CURRENT",
        gate_decision_id: "dec_" + "d".repeat(32),
        blocking: [],
      }),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "检查当前批准G5版本" }));
    await screen.findByText(/当前批准版本未通过核对/);
    expect(JSON.parse(screen.getByTestId("content").textContent!).episode_id).toBe(ep);
  });
  it("an old episode reply cannot become the new episode candidate", async () => {
    const g = bridge();
    let resolve!: (v: ReturnType<typeof found>) => void;
    g.getVisualBible.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const edit = vi.fn(),
      { rerender } = render(
        <StoryboardVisualBiblePin
          content={board()}
          library={fixture.library as CreativeVersion}
          locked={false}
          edit={edit}
        />,
      );
    fireEvent.click(screen.getByRole("button", { name: "检查当前批准G5版本" }));
    rerender(
      <StoryboardVisualBiblePin
        content={board("ep_" + "c".repeat(32))}
        library={fixture.library as CreativeVersion}
        locked={false}
        edit={edit}
      />,
    );
    await act(async () =>
      resolve(
        found({
          ...fixture.index,
          head: { ...fixture.saved.head, accepted_version_id: fixture.saved.version.id },
          review_version: null,
          accepted_version: fixture.saved.version,
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "固定此批准视觉和设定版本" })).toBe(null),
    );
    expect(edit).not.toHaveBeenCalled();
  });
});
