import { Button } from "./Common";
import { ScriptSceneBlocks } from "./ScriptSceneBlocks";
import type { ScriptScene } from "./adapters/episodeScript";

/** Edits the same episode draft in sequence; this is not a voice or approval object. */
export function ScriptReadthrough({
  scenes,
  locked,
  updateScene,
  onFocusScene,
  onEditScene,
}: {
  scenes: ScriptScene[];
  locked: boolean;
  updateScene: (id: string, update: (scene: ScriptScene) => ScriptScene) => void;
  onFocusScene: (id: string) => void;
  onEditScene: (id: string) => void;
}) {
  return (
    <section className="script-readthrough" aria-label="全分集读本编辑">
      <p>按当前场次顺序连贯检查动作与对白。修改仍在同一草稿，需保存草稿版本。</p>
      {scenes.map((scene) => (
        <section
          key={scene.scene_id}
          aria-label={`读本场次 ${scene.ordinal} · ${scene.heading}`}
          onFocusCapture={() => onFocusScene(scene.scene_id)}
        >
          <header>
            <h3>
              {scene.ordinal} · {scene.heading}
            </h3>
            <Button onClick={() => onEditScene(scene.scene_id)}>编辑此场次</Button>
          </header>
          <ScriptSceneBlocks selected={scene} locked={locked} updateScene={updateScene} />
          {!scene.blocks.length && <p>此场次尚无动作或对白，可进入场次编辑添加。</p>}
        </section>
      ))}
    </section>
  );
}
