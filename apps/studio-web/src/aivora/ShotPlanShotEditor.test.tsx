import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ShotPlanShot } from "@aijian/contracts/shot-plan";
import preparationFixture from "../../../../packages/contracts/fixtures/shot-plan/preparation.json";
import proposalFixture from "../../../../packages/contracts/fixtures/shot-plan/proposal.json";
import {
  validHumanShotPlanPreparation,
  validHumanShotPlanProposal,
} from "./adapters/humanShotPlan";
import { ShotPlanShotEditor } from "./ShotPlanShotEditor";

function fixtures() {
  const preparation: unknown = structuredClone(preparationFixture.data);
  const proposal: unknown = structuredClone(proposalFixture.data);
  const project = preparationFixture.data.project_id;
  const episode = preparationFixture.data.episode_id;
  if (
    !validHumanShotPlanPreparation(preparation, project, episode) ||
    !validHumanShotPlanProposal(proposal, project, episode)
  )
    throw new Error("Invalid published fixtures");
  const shot = proposal.content.shots[0];
  if (!shot) throw new Error("Missing fixture shot");
  return { preparation, shot };
}
function open(options: { historical?: boolean; disabled?: boolean; secondScene?: boolean } = {}) {
  const { preparation, shot } = fixtures();
  if (options.secondScene) {
    const first = preparation.script_content.scenes[0]!;
    // Component-only projection: tests selection mapping, not authority/hash validation.
    preparation.script_content.scenes.push({
      ...first,
      scene_id: `scn_${"f".repeat(32)}`,
      ordinal: 2,
      heading: "Synthetic second scene",
      blocks: first.blocks.map((block, index) => ({
        ...block,
        block_id: `sblk_${(index + 100).toString(16).padStart(32, "0")}`,
      })),
    });
  }
  const update = vi.fn<(patch: Partial<ShotPlanShot>) => void>();
  function Harness() {
    const [current, setCurrent] = useState(shot);
    return (
      <>
        <ShotPlanShotEditor
          shot={current}
          preparation={options.historical ? null : preparation}
          disabled={options.disabled ?? false}
          update={(patch) => {
            update(patch);
            setCurrent((old) => ({ ...old, ...patch }));
          }}
        />
        <output aria-label="shot state">{JSON.stringify(current)}</output>
      </>
    );
  }
  render(<Harness />);
  return { update, preparation, shot };
}
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
function current(): ShotPlanShot {
  return JSON.parse(screen.getByLabelText("shot state").textContent ?? "{}");
}
afterEach(cleanup);

describe("human shot editor preserves stable references and independent fields", () => {
  test("scene change replaces all source pins with that exact scene's blocks", () => {
    const { preparation, update } = open({ secondScene: true });
    const next = preparation.script_content.scenes.find(
      (scene) => scene.scene_id !== current().script_scene_id && scene.blocks.length,
    );
    if (!next) throw new Error("Fixture needs a second scene");
    change("剧本场景", next.scene_id);
    expect(update).toHaveBeenCalledExactlyOnceWith({
      script_scene_id: next.scene_id,
      script_block_ids: next.blocks.map((block) => block.block_id),
      dialogue_block_ids: next.blocks
        .filter((block) => block.kind === "DIALOGUE")
        .map((block) => block.block_id),
      coverage: [...new Set(next.blocks.map((block) => block.kind))],
    });
  });
  test("toggling source blocks keeps dialogue pins derived from selected blocks", () => {
    const { preparation } = open();
    const scene = preparation.script_content.scenes.find(
      (value) => value.scene_id === current().script_scene_id,
    );
    if (!scene) throw new Error("Missing scene");
    for (const [index, block] of scene.blocks.entries()) {
      const checkbox = within(screen.getByRole("group", { name: "镜头引用的剧本块" })).getAllByRole(
        "checkbox",
      )[index]!;
      const wasSelected = current().script_block_ids.includes(block.block_id);
      fireEvent.click(checkbox);
      expect(current().script_block_ids.includes(block.block_id)).toBe(!wasSelected);
      expect(current().dialogue_block_ids).toEqual(
        scene.blocks
          .filter(
            (entry) =>
              entry.kind === "DIALOGUE" && current().script_block_ids.includes(entry.block_id),
          )
          .map((entry) => entry.block_id),
      );
      fireEvent.click(checkbox);
      expect(current().script_block_ids.includes(block.block_id)).toBe(wasSelected);
    }
  });
  test.each([
    ["镜头标题", "title"],
    ["叙事目的", "narrative_purpose"],
    ["构图", "composition"],
    ["表演意图", "performance"],
    ["起始状态", "start_state"],
    ["结束状态", "end_state"],
    ["节奏", "rhythm"],
    ["声音意图（未生成音频）", "sound_intent"],
  ])("editing %s changes only %s", (label, field) => {
    const { shot, update } = open();
    change(label!, "Human reviewed text");
    expect(update).toHaveBeenCalledExactlyOnceWith({ [field!]: "Human reviewed text" });
    expect(current()).toEqual({ ...shot, [field!]: "Human reviewed text" });
  });
  test.each(["EXTREME_WIDE", "WIDE", "MEDIUM", "CLOSE_UP", "EXTREME_CLOSE_UP"])(
    "framing %s preserves source identity",
    (framing) => {
      const { shot } = open();
      change("景别", framing);
      expect(current()).toEqual({ ...shot, framing });
    },
  );
  test.each([
    ["关键动作", "ACTION"],
    ["对白", "DIALOGUE"],
    ["建立场景", "ESTABLISHING"],
    ["反应", "REACTION"],
    ["转场", "TRANSITION"],
  ])("coverage %s toggles without rewriting source pins", (label, value) => {
    const { shot } = open();
    const before = current().coverage.includes(value as ShotPlanShot["coverage"][number]);
    fireEvent.click(screen.getByLabelText(label!));
    expect(current().coverage.includes(value as ShotPlanShot["coverage"][number])).toBe(!before);
    expect(current().script_block_ids).toEqual(shot.script_block_ids);
    fireEvent.click(screen.getByLabelText(label!));
    expect(new Set(current().coverage)).toEqual(new Set(shot.coverage));
  });
  test("duration updates only the cut end while preserving incoming handle and cut start", () => {
    const { shot } = open();
    change("时长（整数帧）", "300");
    expect(current()).toEqual({
      ...shot,
      duration_frames: 300,
      safe_cut_window: { ...shot.safe_cut_window, end_frame: 300 - shot.handle_out_frames },
    });
  });
  test.each(["0", "-1", "1.5", "9007199254740992"])(
    "invalid duration %s does not update",
    (value) => {
      const { shot, update } = open();
      change("时长（整数帧）", value);
      expect(update).not.toHaveBeenCalled();
      expect(current()).toEqual(shot);
    },
  );
  test.each([
    ["主体运动", "subject"],
    ["环境运动", "environment"],
    ["相机运动", "camera"],
  ])("motion field %s does not overwrite sibling fields", (label, field) => {
    const { shot, update } = open();
    change(label!, "Revised motion");
    expect(update).toHaveBeenCalledExactlyOnceWith({
      movement: { ...shot.movement, [field!]: "Revised motion" },
    });
  });
  test.each(["入手柄（帧）", "出手柄（帧）", "安全切区起点（含）", "安全切区终点（不含）"])(
    "%s accepts integers and ignores negative/fractional values",
    (label) => {
      const { update } = open();
      change(label, "5");
      expect(update).toHaveBeenCalledTimes(1);
      const saved = current();
      change(label, "-1");
      change(label, "1.5");
      expect(update).toHaveBeenCalledTimes(1);
      expect(current()).toEqual(saved);
    },
  );
  test("historical references remain visible without substituting current source text", () => {
    const { shot } = open({ historical: true });
    expect(screen.queryByLabelText("剧本场景")).toBeNull();
    const history = screen.getByRole("group", { name: "历史镜头稳定引用" });
    for (const id of shot.script_block_ids) expect(history).toHaveTextContent(id);
    expect(history).toHaveTextContent("未将新版原文冒充历史引用");
  });
  test("disabled editor disables every editable descendant", () => {
    open({ disabled: true });
    for (const element of document.querySelectorAll("input,textarea,select"))
      expect(element).toBeDisabled();
  });
});
