import type { Ref } from "react";
import type { CreativeCharacter, CreativeScene } from "./adapters/creativeLibrary";

export function ManualCreativeTextFields({
  selected,
  nameInput,
  updateCharacter,
  updateScene,
}: {
  selected: CreativeCharacter | CreativeScene;
  nameInput: Ref<HTMLInputElement>;
  updateCharacter: (
    key: "name" | "role" | "description" | "appearance" | "personality",
    value: string,
  ) => void;
  updateScene: (
    key: "name" | "description" | "location" | "time_of_day" | "weather" | "continuity",
    value: string,
  ) => void;
}) {
  return (
    <>
      {"character_id" in selected ? (
        <>
          <label>
            角色名称
            <input
              ref={nameInput}
              value={selected.name}
              maxLength={120}
              required
              placeholder="填写角色名称"
              onChange={(event) => updateCharacter("name", event.target.value)}
            />
          </label>
          <label>
            身份与作用
            <input
              value={selected.role}
              maxLength={240}
              placeholder="人物身份及其在故事中的作用"
              onChange={(event) => updateCharacter("role", event.target.value)}
            />
          </label>
          <label>
            角色经历与关系
            <textarea
              value={selected.description}
              maxLength={20_000}
              rows={5}
              placeholder="经历、动机与人物关系"
              onChange={(event) => updateCharacter("description", event.target.value)}
            />
          </label>
          <label>
            外观设定
            <textarea
              value={selected.appearance}
              maxLength={20_000}
              rows={4}
              placeholder="外貌、服饰与辨识特征"
              onChange={(event) => updateCharacter("appearance", event.target.value)}
            />
          </label>
          <label>
            性格与行为
            <textarea
              value={selected.personality}
              maxLength={20_000}
              rows={4}
              placeholder="性格、习惯与行为边界"
              onChange={(event) => updateCharacter("personality", event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            场景名称
            <input
              ref={nameInput}
              value={selected.name}
              maxLength={120}
              required
              placeholder="填写场景名称"
              onChange={(event) => updateScene("name", event.target.value)}
            />
          </label>
          <label>
            地点
            <input
              value={selected.location}
              maxLength={240}
              placeholder="地点、方位或所属区域"
              onChange={(event) => updateScene("location", event.target.value)}
            />
          </label>
          <label>
            空间与叙事
            <textarea
              value={selected.description}
              maxLength={20_000}
              rows={5}
              placeholder="空间布局、关键区域与叙事用途"
              onChange={(event) => updateScene("description", event.target.value)}
            />
          </label>
          <div className="manual-creative-field-row">
            <label>
              时间
              <input
                value={selected.time_of_day}
                maxLength={240}
                placeholder="例如：凌晨"
                onChange={(event) => updateScene("time_of_day", event.target.value)}
              />
            </label>
            <label>
              天气
              <input
                value={selected.weather}
                maxLength={240}
                placeholder="例如：雨后"
                onChange={(event) => updateScene("weather", event.target.value)}
              />
            </label>
          </div>
          <label>
            连续性要求
            <textarea
              value={selected.continuity}
              maxLength={20_000}
              rows={5}
              placeholder="光线、关键物件、空间方向与需要跨镜头保持的细节"
              onChange={(event) => updateScene("continuity", event.target.value)}
            />
          </label>
        </>
      )}
    </>
  );
}
