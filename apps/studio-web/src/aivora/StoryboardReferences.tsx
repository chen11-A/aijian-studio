import { useEffect, useMemo, useState } from "react";
import { createStudioTransport } from "../api/studio";
import { Button } from "./Common";
import { StoryboardCharacters } from "./StoryboardCharacters";
import { StoryboardReferencePin } from "./StoryboardReferencePin";
import { StoryboardVisualBiblePin } from "./StoryboardVisualBiblePin";
import { StoryboardEnvironmentBindings } from "./StoryboardEnvironmentBindings";
import { environmentForLocation, shotEnvironment } from "./adapters/storyboardEnvironment";
import { sameStoryboardJson } from "./adapters/episodeStoryboard";
import { validScriptVersion, type ScriptVersion } from "./adapters/episodeScript";
import { validCreativeVersion, type CreativeVersion } from "./adapters/creativeLibrary";
import type { StoryboardContent, StoryboardShot } from "./adapters/episodeStoryboard";
import { Select } from "./Select";

type Source<T> = { state: "loading" | "empty" | "error" | "ready"; version: T | null };
/** Exact pins remain stable when the author later edits their script or project library. */
export function StoryboardReferences({
  content,
  shot,
  locked,
  edit,
  updateShot,
}: {
  content: StoryboardContent;
  shot: StoryboardShot;
  locked: boolean;
  edit: (update: (value: StoryboardContent) => StoryboardContent) => void;
  updateShot: (patch: Partial<StoryboardShot>) => void;
}) {
  const transport = useMemo(createStudioTransport, []);
  const [script, setScript] = useState<Source<ScriptVersion>>({ state: "loading", version: null });
  const [library, setLibrary] = useState<Source<CreativeVersion>>({
    state: "loading",
    version: null,
  });
  const [refresh, setRefresh] = useState(0);
  const {
    project_id: projectId,
    episode_id: episodeId,
    script_version_id: scriptPin,
    creative_library_version_id: libraryPin,
  } = content;
  useEffect(() => {
    let active = true;
    setScript({ state: "loading", version: null });
    void (async () => {
      try {
        const result = scriptPin
          ? await transport.getEpisodeScriptVersion?.(projectId, episodeId, scriptPin)
          : await transport.getEpisodeScript?.(projectId, episodeId);
        if (!active) return;
        if (
          result?.kind === "FOUND" &&
          validScriptVersion(result.receipt.data, projectId, episodeId) &&
          (!scriptPin || result.receipt.data.version_id === scriptPin)
        )
          setScript({ state: "ready", version: result.receipt.data });
        else
          setScript({
            state: result?.kind === "EMPTY" && !scriptPin ? "empty" : "error",
            version: null,
          });
      } catch {
        if (active) setScript({ state: "error", version: null });
      }
    })();
    return () => {
      active = false;
    };
  }, [transport, projectId, episodeId, scriptPin, refresh]);
  useEffect(() => {
    let active = true;
    setLibrary({ state: "loading", version: null });
    void (async () => {
      try {
        const result = libraryPin
          ? await transport.getProjectCreativeLibraryVersion?.(projectId, libraryPin)
          : await transport.getProjectCreativeLibrary?.(projectId);
        if (!active) return;
        if (
          result?.kind === "FOUND" &&
          validCreativeVersion(result.receipt.data, projectId) &&
          (!libraryPin || result.receipt.data.version_id === libraryPin)
        )
          setLibrary({ state: "ready", version: result.receipt.data });
        else
          setLibrary({
            state: result?.kind === "EMPTY" && !libraryPin ? "empty" : "error",
            version: null,
          });
      } catch {
        if (active) setLibrary({ state: "error", version: null });
      }
    })();
    return () => {
      active = false;
    };
  }, [transport, projectId, libraryPin, refresh]);
  const activeLibrary =
    library.state === "ready" &&
    library.version &&
    validCreativeVersion(library.version, projectId) &&
    (!libraryPin || library.version.version_id === libraryPin)
      ? library.version
      : null;
  const activeScript =
    script.state === "ready" &&
    script.version &&
    validScriptVersion(script.version, projectId, episodeId) &&
    (!scriptPin || script.version.version_id === scriptPin)
      ? script.version
      : null;
  const sourceLabel = (state: Source<unknown>["state"]) =>
    ({
      loading: "正在读取…",
      empty: "还没有已保存版本，可继续手写分镜",
      error: "版本读取未完成，可重试或继续编辑文字",
      ready: "",
    })[state];
  return (
    <section className="storyboard-references" aria-label="可选版本引用">
      <header>
        <h3>可选版本引用</h3>
        <Button disabled={locked} onClick={() => setRefresh((value) => value + 1)}>
          刷新可选版本
        </Button>
      </header>
      <p>引用固定到保存时选定的版本；后续剧本或设定修改不会自动替换。</p>
      <p>升级仅修改当前分镜草稿的版本引用，保存后才会持久化；不代表媒体已生成或审片已批准。</p>
      <StoryboardReferencePin
        kind="script"
        content={content}
        version={activeScript}
        sourceLabel={sourceLabel(script.state)}
        locked={locked}
        transport={transport}
        edit={edit}
      />
      {scriptPin && (
        <label>
          对应剧本场次
          <Select
            disabled={locked || !activeScript}
            value={shot.script_scene_id ?? ""}
            onChange={(event) => updateShot({ script_scene_id: event.target.value || null })}
          >
            <option value="">不关联场次</option>
            {activeScript?.content.scenes.map((scene) => (
              <option key={scene.scene_id} value={scene.scene_id}>
                {scene.ordinal}. {scene.heading}
              </option>
            ))}
          </Select>
          {script.state !== "ready" && <small>{sourceLabel(script.state)}；现有引用已保留。</small>}
        </label>
      )}
      <StoryboardReferencePin
        kind="library"
        content={content}
        version={activeLibrary}
        sourceLabel={sourceLabel(library.state)}
        locked={locked || ("visual_bible_pin" in content && content.visual_bible_pin !== null)}
        transport={transport}
        edit={edit}
      />
      <StoryboardVisualBiblePin
        content={content}
        library={activeLibrary}
        locked={locked}
        edit={edit}
      />
      {"visual_bible_pin" in content && content.visual_bible_pin && (
        <p>G5固定了对应设定版本；改换设定请先显式解除G5引用，或核对并固定新的批准视觉版本。</p>
      )}
      {libraryPin && (
        <>
          <label>
            镜头地点
            <Select
              disabled={locked || !activeLibrary}
              value={shot.location_id ?? ""}
              onChange={(event) => {
                const location_id = event.currentTarget.value || null;
                if (!activeLibrary) return;
                if (content.schema_version !== "1.4.0" && content.schema_version !== "1.5.0") {
                  updateShot({ location_id });
                  return;
                }
                const before = shotEnvironment(shot),
                  next = environmentForLocation(shot, activeLibrary, location_id);
                if (
                  !sameStoryboardJson(before, next) &&
                  !window.confirm("更换地点会调整当前镜头草稿的不兼容环境状态/参考；历史版本保留。")
                )
                  return;
                updateShot({ location_id, environment_binding: next });
              }}
            >
              <option value="">不关联地点</option>
              {activeLibrary?.content.scenes.map((scene) => (
                <option key={scene.scene_id} value={scene.scene_id}>
                  {scene.name}
                </option>
              ))}
            </Select>
          </label>
          <StoryboardCharacters
            content={content}
            shot={shot}
            library={activeLibrary}
            locked={locked}
            edit={edit}
            updateShot={updateShot}
          />
          <StoryboardEnvironmentBindings
            content={content}
            shot={shot}
            library={activeLibrary}
            locked={locked}
            edit={edit}
          />
        </>
      )}
    </section>
  );
}
