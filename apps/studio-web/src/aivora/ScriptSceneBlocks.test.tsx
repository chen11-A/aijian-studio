import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScriptSceneBlocks } from "./ScriptSceneBlocks";
import type { ScriptBlock, ScriptScene } from "./adapters/episodeScript";

afterEach(cleanup);

const sceneFor = (kind: ScriptBlock["kind"] = "ACTION"): ScriptScene => ({
  scene_id: `scn_${"a".repeat(32)}`,
  ordinal: 1,
  heading: "harbor dusk",
  blocks: [
    {
      block_id: `sblk_${"b".repeat(32)}`,
      ordinal: 1,
      kind,
      text: "the courier lifts a bell from wet sand",
      speaker: kind === "DIALOGUE" ? "courier" : null,
      delivery: kind === "DIALOGUE" ? "ON_SCREEN" : null,
    },
  ],
});

function queueUpdates(scene: ScriptScene) {
  const queued: Array<(value: ScriptScene) => ScriptScene> = [];
  render(
    <ScriptSceneBlocks
      selected={scene}
      locked={false}
      updateScene={(_id, update) => queued.push(update)}
    />,
  );
  return queued;
}

describe("script block deferred updates", () => {
  it("captures action text before a queued scene updater runs", () => {
    const scene = sceneFor();
    const queued = queueUpdates(scene);
    fireEvent.change(screen.getByLabelText("动作内容"), {
      target: { value: "the courier rings the bell" },
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]!(scene).blocks[0]?.text).toBe("the courier rings the bell");
  });

  it("captures the kind and its dependent fields before a queued updater runs", () => {
    const scene = sceneFor();
    const queued = queueUpdates(scene);
    fireEvent.change(screen.getByLabelText("段落类型"), { target: { value: "DIALOGUE" } });
    expect(queued[0]!(scene).blocks[0]).toMatchObject({
      kind: "DIALOGUE",
      speaker: "",
      delivery: null,
    });
  });

  it("captures speaker and delivery before queued updaters run", () => {
    const scene = sceneFor("DIALOGUE");
    const queued = queueUpdates(scene);
    fireEvent.change(screen.getByLabelText("说话人"), { target: { value: "ferryman" } });
    fireEvent.change(screen.getByLabelText("对白呈现"), { target: { value: "OFF_SCREEN" } });
    const updated = queued.reduce((value, update) => update(value), scene);
    expect(updated.blocks[0]).toMatchObject({ speaker: "ferryman", delivery: "OFF_SCREEN" });
  });

  it("keeps each repeated edit deterministic and preserves scene/block identity", () => {
    const scene = sceneFor();
    const queued = queueUpdates(scene);
    fireEvent.change(screen.getByLabelText("动作内容"), { target: { value: "first edit" } });
    fireEvent.change(screen.getByLabelText("动作内容"), { target: { value: "second edit" } });
    expect(queued).toHaveLength(2);
    const first = queued[0]!(scene);
    expect(first.blocks[0]?.text).toBe("first edit");
    expect(queued[0]!(scene)).toEqual(first);
    const second = queued[1]!(first);
    expect(second.blocks[0]?.text).toBe("second edit");
    expect(second.scene_id).toBe(scene.scene_id);
    expect(second.blocks[0]?.block_id).toBe(scene.blocks[0]?.block_id);
    expect(scene.blocks[0]?.text).toBe("the courier lifts a bell from wet sand");
  });
});
