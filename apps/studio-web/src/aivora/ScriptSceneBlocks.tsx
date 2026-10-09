import { Button } from "./Common";
import type { ScriptBlock, ScriptScene } from "./adapters/episodeScript";

function moveBlock(items: ScriptBlock[], index: number, offset: number): ScriptBlock[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const copy = [...items];
  const [item] = copy.splice(index, 1);
  if (item) copy.splice(target, 0, item);
  return copy;
}

export function ScriptSceneBlocks({
  selected,
  locked,
  updateScene,
}: {
  selected: ScriptScene;
  locked: boolean;
  updateScene: (id: string, update: (scene: ScriptScene) => ScriptScene) => void;
}) {
  return (
    <div className="v2-script-lines">
      {selected.blocks.map((block, blockIndex) => (
        <div key={block.block_id}>
          <label>
            段落类型
            <select
              value={block.kind}
              disabled={locked}
              onChange={(event) => {
                const kind = event.currentTarget.value as ScriptBlock["kind"];
                updateScene(selected.scene_id, (scene) => ({
                  ...scene,
                  blocks: scene.blocks.map((item) =>
                    item.block_id === block.block_id
                      ? {
                          ...item,
                          kind,
                          speaker: kind === "DIALOGUE" ? "" : null,
                          delivery: null,
                        }
                      : item,
                  ),
                }));
              }}
            >
              <option value="ACTION">动作</option>
              <option value="DIALOGUE">对白</option>
            </select>
          </label>
          {block.kind === "DIALOGUE" && (
            <>
              <label>
                说话人
                <input
                  value={block.speaker ?? ""}
                  disabled={locked}
                  onChange={(event) => {
                    const speaker = event.currentTarget.value;
                    updateScene(selected.scene_id, (scene) => ({
                      ...scene,
                      blocks: scene.blocks.map((item) =>
                        item.block_id === block.block_id ? { ...item, speaker } : item,
                      ),
                    }));
                  }}
                />
              </label>
              <label>
                对白呈现
                <select
                  value={block.delivery ?? ""}
                  disabled={locked}
                  onChange={(event) => {
                    const delivery = event.currentTarget.value as "ON_SCREEN" | "OFF_SCREEN";
                    updateScene(selected.scene_id, (scene) => ({
                      ...scene,
                      blocks: scene.blocks.map((item) =>
                        item.block_id === block.block_id ? { ...item, delivery } : item,
                      ),
                    }));
                  }}
                >
                  <option value="" disabled>
                    待补齐/未知
                  </option>
                  <option value="ON_SCREEN">画内</option>
                  <option value="OFF_SCREEN">画外</option>
                </select>
              </label>
            </>
          )}
          <label>
            {block.kind === "DIALOGUE" ? "对白内容" : "动作内容"}
            <textarea
              value={block.text}
              disabled={locked}
              onChange={(event) => {
                const text = event.currentTarget.value;
                updateScene(selected.scene_id, (scene) => ({
                  ...scene,
                  blocks: scene.blocks.map((item) =>
                    item.block_id === block.block_id ? { ...item, text } : item,
                  ),
                }));
              }}
            />
          </label>
          {([-1, 1] as const).map((offset) => (
            <Button
              key={offset}
              disabled={
                locked || blockIndex + offset < 0 || blockIndex + offset >= selected.blocks.length
              }
              onClick={() =>
                updateScene(selected.scene_id, (scene) => ({
                  ...scene,
                  blocks: moveBlock(scene.blocks, blockIndex, offset).map((item, index) => ({
                    ...item,
                    ordinal: index + 1,
                  })),
                }))
              }
            >
              {offset < 0 ? "上移此段" : "下移此段"}
            </Button>
          ))}
          <Button
            disabled={locked}
            onClick={() =>
              updateScene(selected.scene_id, (scene) => ({
                ...scene,
                blocks: scene.blocks.filter((item) => item.block_id !== block.block_id),
              }))
            }
          >
            删除此段
          </Button>
        </div>
      ))}
    </div>
  );
}
