import { createHash, webcrypto } from "node:crypto";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../../packages/contracts/fixtures/visual-environment-g5.json";
import { visualJson, type VisualContent, type VisualRead } from "@aijian/contracts/visual-bible";
import { VisualEnvironmentScopeEditor } from "./VisualEnvironmentScopeEditor";
import { StoryboardEnvironmentBindings } from "./StoryboardEnvironmentBindings";
import { StoryboardVisualBiblePin } from "./StoryboardVisualBiblePin";
import { VisualApprovalCauseInspector } from "./VisualApprovalCauseInspector";
import {
  cloneStoryboardContent,
  withStoryboardPlanning,
  withStoryboardShots,
  withStoryboardVisualBasis,
  validStoryboardContent,
  type StoryboardContent,
} from "./adapters/episodeStoryboard";
import type { CreativeVersion } from "./adapters/creativeLibrary";
import type { AijianDesktopBridge } from "../api/studio";
const p = fixture.saved.project_id,
  id = fixture.saved.version.id;
const sha = (v: unknown) => `sha256:${createHash("sha256").update(visualJson(v)).digest("hex")}`;
const found = <T,>(data: T) => ({ kind: "FOUND" as const, data, request_id: fixture.request_id });
const library = fixture.library as CreativeVersion;
let saved: StoryboardContent;
function Board({ adopt = false }: { adopt?: boolean }) {
  const [value, setValue] = useState(
    (adopt
      ? { ...fixture.board_request.content, visual_bible_pin: null }
      : fixture.board_request.content) as StoryboardContent,
  );
  saved = value;
  return adopt ? (
    <StoryboardVisualBiblePin content={value} library={library} locked={false} edit={setValue} />
  ) : (
    <StoryboardEnvironmentBindings
      content={value}
      shot={value.shots[0]!}
      library={library}
      locked={false}
      edit={setValue}
    />
  );
}
function bridge() {
  const g = {
    getVisualBible: vi.fn().mockResolvedValue(
      found({
        project_id: p,
        head: { ...fixture.saved.head, accepted_version_id: id },
        latest_version: fixture.saved.version,
        accepted_version: fixture.saved.version,
        review_version: null,
      }),
    ),
    getVisualBibleVersion: vi.fn().mockResolvedValue(found(fixture.saved)),
    getVisualBibleAuthority: vi.fn().mockResolvedValue(
      found({
        project_id: p,
        version_id: id,
        content_hash: fixture.saved.version.content_hash,
        status: "CURRENT",
        gate_decision_id: "dec_" + "a".repeat(32),
        blocking: [],
      }),
    ),
    getProjectCreativeLibraryVersion: vi.fn().mockResolvedValue({
      kind: "FOUND",
      receipt: { data: library, request_id: fixture.request_id },
    }),
    listProjectMediaAssets: vi
      .fn()
      .mockResolvedValue({ kind: "LISTED", receipt: { data: [], request_id: fixture.request_id } }),
  };
  window.aijian = g as unknown as AijianDesktopBridge;
  return g;
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

it("explicit extension begins empty, needs state-specific evidence and preserves candidate reason", () => {
  let value = fixture.legacy_saved.version.content as VisualContent;
  function Harness() {
    const [c, setC] = useState(value);
    value = c;
    return (
      <VisualEnvironmentScopeEditor
        content={c}
        library={library.content}
        locked={false}
        edit={setC}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "明确扩展候选环境范围" }));
  expect(value.schema_version).toBe("1.1.0");
  if (value.schema_version !== "1.1.0") throw Error("scope");
  expect(value.environment_scope.scene_variant_ids).toEqual([]);
  expect(value.change_reason).toBe(fixture.legacy_saved.version.content.change_reason);
  const ref = screen.getByLabelText("审查环境参考：雨后状态") as HTMLInputElement;
  expect(ref.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("审查状态：雨后凌晨"));
  expect(screen.getByText(/缺少明确选中的状态专属真实参考/)).toBeTruthy();
  expect(ref.disabled).toBe(false);
  fireEvent.click(ref);
  expect(screen.queryByText(/缺少明确选中的状态专属真实参考/)).toBeNull();
  expect(value.environment_scope.environment_reference_ids).toEqual(["erf_" + "3".repeat(32)]);
  fireEvent.click(screen.getByLabelText("审查状态：雨后凌晨"));
  expect(value.environment_scope.environment_reference_ids).toEqual([]);
});

it("actual pinned scope enables approved shot state edits, hides out-of-scope originals and preserves planning/pin", async () => {
  const g = bridge();
  render(<Board />);
  await screen.findByText(/独立环境批准已核对/);
  expect(screen.queryByLabelText("环境参考：码头基础")).toBeNull();
  expect((screen.getByLabelText("本镜地点状态") as HTMLSelectElement).value).toBe(
    "scv_" + "1".repeat(32),
  );
  const before = saved;
  fireEvent.change(screen.getByLabelText("本镜地点状态"), { target: { value: "" } });
  expect(saved.schema_version).toBe("1.5.0");
  if (saved.schema_version !== "1.5.0" || before.schema_version !== "1.5.0") throw Error("board");
  expect(saved.visual_bible_pin).toEqual(before.visual_bible_pin);
  expect(saved.shots[0]!.coverage_notes).toBe(before.shots[0]!.coverage_notes);
  expect(saved.shots[0]!.environment_binding).toEqual({
    variant_id: null,
    reference_ids: ["erf_" + "1".repeat(32)],
  });
  expect(g.getVisualBibleVersion).toHaveBeenCalledWith(p, id);
});

it("unknown or wrong source retains exact selected state and approval pin", async () => {
  const g = bridge();
  g.getVisualBibleVersion.mockResolvedValue(
    found({
      ...fixture.saved,
      version: { ...fixture.saved.version, content_hash: "sha256:" + "f".repeat(64) },
    }),
  );
  render(<Board />);
  await waitFor(() => expect(g.getVisualBibleVersion).toHaveBeenCalled());
  expect((screen.getByLabelText("本镜地点状态") as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText("本镜地点状态") as HTMLSelectElement).value).toBe(
    "scv_" + "1".repeat(32),
  );
  expect(saved).toEqual(fixture.board_request.content);
});

it("new approval adoption preserves all choices", async () => {
  const g = bridge();
  render(<Board adopt />);
  fireEvent.click(screen.getByRole("button", { name: "检查当前批准G5版本" }));
  await waitFor(() => expect(g.getProjectCreativeLibraryVersion).toHaveBeenCalled());
  const bind = await screen.findByRole("button", { name: "固定此批准视觉和设定版本" });
  await waitFor(() => expect((bind as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(bind);
  expect(saved).toEqual(fixture.board_request.content);
});

it("out-of-scope approval adoption refuses without clearing manual choices", async () => {
  const g = bridge(),
    v = structuredClone(fixture.saved) as VisualRead;
  if (v.version.content.schema_version !== "1.1.0") throw Error("visual");
  v.version.content.environment_scope.scene_variant_ids = [];
  v.version.content.environment_scope.environment_reference_ids = [];
  v.version.content_hash = sha(v.version.content);
  g.getVisualBibleVersion.mockResolvedValue(found(v));
  g.getVisualBibleAuthority.mockResolvedValue(
    found({
      project_id: p,
      version_id: id,
      content_hash: v.version.content_hash,
      status: "CURRENT",
      gate_decision_id: "dec_" + "a".repeat(32),
      blocking: [],
    }),
  );
  render(<Board adopt />);
  const before = saved;
  fireEvent.click(screen.getByRole("button", { name: "检查当前批准G5版本" }));
  await screen.findByText(/核对到视觉/);
  expect(
    (screen.getByRole("button", { name: "固定此批准视觉和设定版本" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(saved).toEqual(before);
});

it("late environment A results cannot authorize the new A after A→B→A", async () => {
  const g = bridge();
  let finish!: (v: ReturnType<typeof found<VisualRead>>) => void;
  g.getVisualBibleVersion.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const c = fixture.board_request.content as StoryboardContent;
  const props = { content: c, shot: c.shots[0]!, library, locked: false, edit: vi.fn() };
  const view = render(<StoryboardEnvironmentBindings {...props} />);
  await waitFor(() => expect(g.getVisualBibleVersion).toHaveBeenCalledTimes(1));
  const other = { ...c, project_id: "prj_" + "f".repeat(32) };
  view.rerender(<StoryboardEnvironmentBindings {...props} content={other} library={null} />);
  view.rerender(<StoryboardEnvironmentBindings {...props} />);
  await screen.findByText(/独立环境批准已核对/);
  await act(async () => {
    finish(
      found({
        ...fixture.saved,
        version: { ...fixture.saved.version, content_hash: "sha256:" + "f".repeat(64) },
      } as VisualRead),
    );
    await Promise.resolve();
  });
  expect((screen.getByLabelText("本镜地点状态") as HTMLSelectElement).disabled).toBe(false);
  expect(props.edit).not.toHaveBeenCalled();
});

it("1.5 clone/add/planning and explicit unpin preserve fields; legacy approval cannot downgrade it", () => {
  const board = fixture.board_request.content as StoryboardContent;
  expect(cloneStoryboardContent(board)).toEqual(board);
  const edited = withStoryboardPlanning(board, board.shots[0]!.shot_id, {
    coverage_notes: "新覆盖",
  });
  expect(edited.schema_version).toBe("1.5.0");
  expect(validStoryboardContent(edited, p, board.episode_id)).toBe(true);
  expect(withStoryboardShots(edited, edited.shots).schema_version).toBe("1.5.0");
  expect(
    withStoryboardVisualBasis(edited, library.version_id, {
      version_id: fixture.legacy_saved.version.id,
      content_hash: fixture.legacy_saved.version.content_hash,
    }),
  ).toBe(edited);
});

it("persistent report cause reopens exact historic versions and reason without using latest or originals", async () => {
  const g = bridge();
  const newer = structuredClone(fixture.saved) as VisualRead;
  newer.version.id = "ver_" + "e".repeat(32);
  newer.version.content.change_reason = "雨后环境人工替代原因";
  newer.version.content_hash = sha(newer.version.content);
  newer.head.latest_version_id = newer.version.id;
  g.getVisualBibleVersion.mockImplementation(async (_p: string, v: string) =>
    found(v === newer.version.id ? newer : fixture.saved),
  );
  render(
    <VisualApprovalCauseInspector
      projectId={p}
      artifactId={fixture.saved.version.artifact_id}
      oldVersionId={id}
      newVersionId={newer.version.id}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "核对此报告是否为视觉环境替代原因" }));
  await screen.findByText(/^新批准版本的共享改动原因：雨后环境人工替代原因$/);
  expect(g.getVisualBibleVersion).toHaveBeenCalledWith(p, id);
  expect(g.getVisualBibleVersion).toHaveBeenCalledWith(p, newer.version.id);
  expect(g.getVisualBible).not.toHaveBeenCalled();
  expect(g.listProjectMediaAssets).not.toHaveBeenCalled();
});
