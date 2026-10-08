import { useEffect, useMemo, useState } from "react";
import { createStudioTransport } from "../api/studio";
import { Button } from "./Common";
import { StoryboardReferencePin } from "./StoryboardReferencePin";
import { validScriptVersion, type ScriptVersion } from "./adapters/episodeScript";
import { validCreativeVersion, type CreativeVersion } from "./adapters/creativeLibrary";
import type { StoryboardContent, StoryboardShot } from "./adapters/episodeStoryboard";

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
        version={script.state === "ready" ? script.version : null}
        sourceLabel={sourceLabel(script.state)}
        locked={locked}
        transport={transport}
        edit={edit}
      />
      {scriptPin && (
        <label>
          对应剧本场次
          <select
            disabled={locked || script.state !== "ready"}
            value={shot.script_scene_id ?? ""}
            onChange={(event) => updateShot({ script_scene_id: event.target.value || null })}
          >
            <option value="">不关联场次</option>
            {script.version?.content.scenes.map((scene) => (
              <option key={scene.scene_id} value={scene.scene_id}>
                {scene.ordinal}. {scene.heading}
              </option>
            ))}
          </select>
          {script.state !== "ready" && <small>{sourceLabel(script.state)}；现有引用已保留。</small>}
        </label>
      )}
      <StoryboardReferencePin
        kind="library"
        content={content}
        version={library.state === "ready" ? library.version : null}
        sourceLabel={sourceLabel(library.state)}
        locked={locked}
        transport={transport}
        edit={edit}
      />
      {libraryPin && (
        <>
          <label>
            镜头地点
            <select
              disabled={locked || library.state !== "ready"}
              value={shot.location_id ?? ""}
              onChange={(event) => updateShot({ location_id: event.target.value || null })}
            >
              <option value="">不关联地点</option>
              {library.version?.content.scenes.map((scene) => (
                <option key={scene.scene_id} value={scene.scene_id}>
                  {scene.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset
            disabled={locked || library.state !== "ready"}
            className="storyboard-characters"
          >
            <legend>出场角色（可多选）</legend>
            {library.version?.content.characters.map((character) => (
              <label key={character.character_id}>
                <input
                  type="checkbox"
                  checked={shot.character_ids.includes(character.character_id)}
                  onChange={(event) =>
                    updateShot({
                      character_ids: event.target.checked
                        ? [...shot.character_ids, character.character_id]
                        : shot.character_ids.filter((id) => id !== character.character_id),
                    })
                  }
                />
                {character.name}
              </label>
            ))}
            {library.state === "ready" && !library.version?.content.characters.length && (
              <small>这个设定版本还没有角色。</small>
            )}
            {library.state !== "ready" && (
              <small>{sourceLabel(library.state)}；现有引用已保留。</small>
            )}
          </fieldset>
        </>
      )}
    </section>
  );
}
