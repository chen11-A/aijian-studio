import type { CreativeVersion } from "./adapters/creativeLibrary";
import type { StoryboardContent, StoryboardShot } from "./adapters/episodeStoryboard";
import { StoryboardCharacterBindings } from "./StoryboardCharacterBindings";

export function StoryboardCharacters({
  content,
  shot,
  library,
  locked,
  edit,
  updateShot,
}: {
  content: StoryboardContent;
  shot: StoryboardShot;
  library: CreativeVersion | null;
  locked: boolean;
  edit: (update: (content: StoryboardContent) => StoryboardContent) => void;
  updateShot: (patch: Partial<StoryboardShot>) => void;
}) {
  return (
    <>
      <fieldset disabled={locked || !library} className="storyboard-characters">
        <legend>出场角色（可多选）</legend>
        {library?.content.characters.map((character) => (
          <label key={character.character_id}>
            <input
              type="checkbox"
              checked={shot.character_ids.includes(character.character_id)}
              onChange={(event) => {
                const ids = event.currentTarget.checked
                  ? [...shot.character_ids, character.character_id]
                  : shot.character_ids.filter((id) => id !== character.character_id);
                const bindings = "character_bindings" in shot ? shot.character_bindings : [];
                const removed = bindings.find((item) => !ids.includes(item.character_id));
                if (
                  removed &&
                  !window.confirm(
                    "移除此角色会同时移除其当前镜头草稿的服装和参考选用；历史版本保留。",
                  )
                )
                  return;
                updateShot({
                  character_ids: ids,
                  ...("character_bindings" in shot
                    ? {
                        character_bindings: bindings.filter((item) =>
                          ids.includes(item.character_id),
                        ),
                      }
                    : {}),
                });
              }}
            />
            {character.name}
          </label>
        ))}
        {library && !library.content.characters.length && <small>这个设定版本还没有角色。</small>}
        {!library && <small>版本读取未完成；现有引用已保留。</small>}
      </fieldset>
      <StoryboardCharacterBindings
        content={content}
        shot={shot}
        library={library}
        locked={locked}
        edit={edit}
      />
    </>
  );
}
