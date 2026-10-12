import { useRef, useState } from "react";
import { Button, PageTitle, Pill } from "./Common";
import { Icon } from "./Icon";
import { ManualCreativeTextFields } from "./ManualCreativeTextFields";
import { CharacterDetails } from "./CharacterDetails";
import { SceneVariants } from "./SceneVariants";
import { EnvironmentReferences } from "./EnvironmentReferences";
import { removeCreativeScene } from "./adapters/creativeEnvironment";
import {
  characterRemovalDetails,
  removeCreativeCharacter,
} from "./adapters/creativeCharacterDetails";
import { CharacterUsagePanel } from "./CharacterUsagePanel";
import type { CharacterUsageEpisode } from "./useCharacterUsage";
export { ManualCreativePage, ManualCreativeInspector } from "./NativeCreativePage";
import { useCreativeLibrary } from "./useCreativeLibrary";
import { buildCreativeSelection, usePublishAssistantSelection } from "./assistantSelection";
import { emptyCreativeWorld, newCreativeId } from "./adapters/creativeLibrary";
import type { CreativeCharacter, CreativeScene, CreativeWorld } from "./adapters/creativeLibrary";
import "./v2-visual.css";
import "./manual-creative-editor.css";

type Kind = "characters" | "world" | "scenes";
const titles: Record<Kind, string> = { characters: "角色", world: "世界设定", scenes: "场景" };
const worldFields: { key: keyof CreativeWorld; label: string; hint: string; short?: boolean }[] = [
  { key: "premise", label: "世界定位", hint: "故事发生在怎样的世界？" },
  { key: "rules", label: "核心规则", hint: "社会、科技或其他必须遵守的规则" },
  { key: "era", label: "时代背景", hint: "时代与社会背景", short: true },
  { key: "visual_style", label: "视觉风格", hint: "美术、构图与整体视觉方向" },
  { key: "palette", label: "色彩约束", hint: "主色、辅助色与需要避免的色彩" },
  { key: "materials", label: "材质约束", hint: "建筑、服装与器物的材质特征" },
];
function reorder<T extends { ordinal: number }>(items: T[], index: number, offset: number): T[] {
  if (index < 0 || index + offset < 0 || index + offset >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item) next.splice(index + offset, 0, item);
  return next.map((entry, i) => ({ ...entry, ordinal: i + 1 }));
}
function selectionKey(projectId: string, kind: Kind) {
  return `aivora.creative-library.selection.v1.${projectId}.${kind}`;
}
function initialSelection(projectId: string, kind: Kind): string | null {
  try {
    return window.sessionStorage.getItem(selectionKey(projectId, kind));
  } catch {
    return null;
  }
}

export function ManualCreativeEditor({
  kind,
  projectId,
  episodeId = null,
  episodes = [],
  episodeListReady = false,
  setNavigationGuard,
}: {
  kind: Kind;
  projectId: string | null;
  episodeId?: string | null;
  episodes?: readonly CharacterUsageEpisode[];
  episodeListReady?: boolean;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
}) {
  const library = useCreativeLibrary(projectId, setNavigationGuard);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    projectId ? initialSelection(projectId, kind) : null,
  );
  const nameInput = useRef<HTMLInputElement>(null);
  const characters = library.content.characters;
  const scenes = library.content.scenes;
  const items = kind === "characters" ? characters : scenes;
  const idOf = (item: CreativeCharacter | CreativeScene) =>
    "character_id" in item ? item.character_id : item.scene_id;
  const selected = items.find((item) => idOf(item) === selectedId) ?? items[0];
  usePublishAssistantSelection(
    projectId
      ? buildCreativeSelection({
          projectId,
          episodeId,
          kind,
          version: library.version,
          selectedId: selected ? idOf(selected) : null,
          dirty: library.dirty,
          readState: library.readState,
        })
      : { kind: "NONE" },
  );
  const selectedIndex = selected
    ? items.indexOf(selected as CreativeCharacter & CreativeScene)
    : -1;
  const world = library.content.world;
  const hasWorld = Object.values(world).some((value) => value.trim());
  const select = (id: string) => {
    setSelectedId(id);
    if (projectId) {
      try {
        window.sessionStorage.setItem(selectionKey(projectId, kind), id);
      } catch {
        /* Selection is optional UI metadata, not the persisted creative draft. */
      }
    }
  };
  function add() {
    if (library.locked || kind === "world" || items.length >= 500) return;
    const id = newCreativeId(kind === "characters" ? "chr" : "loc");
    if (!id) {
      library.setNotice("无法生成可靠的对象标识，请重新打开桌面软件。");
      return;
    }
    library.edit((current) =>
      kind === "characters"
        ? {
            ...current,
            characters: [
              ...current.characters,
              {
                character_id: id,
                ordinal: current.characters.length + 1,
                name: "",
                role: "",
                description: "",
                appearance: "",
                personality: "",
              },
            ],
          }
        : {
            ...current,
            scenes: [
              ...current.scenes,
              {
                scene_id: id,
                ordinal: current.scenes.length + 1,
                name: "",
                description: "",
                location: "",
                time_of_day: "",
                weather: "",
                continuity: "",
              },
            ],
          },
    );
    select(id);
    window.setTimeout(() => nameInput.current?.focus(), 0);
  }
  function updateCharacter(
    key: "name" | "role" | "description" | "appearance" | "personality",
    value: string,
  ) {
    if (!selected || !("character_id" in selected)) return;
    library.edit((current) => ({
      ...current,
      characters: current.characters.map((item) =>
        item.character_id === selected.character_id ? { ...item, [key]: value } : item,
      ),
    }));
  }
  function updateScene(
    key: "name" | "description" | "location" | "time_of_day" | "weather" | "continuity",
    value: string,
  ) {
    if (!selected || !("scene_id" in selected)) return;
    library.edit((current) => ({
      ...current,
      scenes: current.scenes.map((item) =>
        item.scene_id === selected.scene_id ? { ...item, [key]: value } : item,
      ),
    }));
  }
  function remove() {
    if (
      library.locked ||
      !selected ||
      !window.confirm(
        `从当前草稿删除“${selected.name || `未命名${titles[kind]}`}”吗？保存后将产生新版本，旧版本会保留。${"character_id" in selected ? characterRemovalDetails(library.content, selected.character_id) : "此地点的状态与参考关联将从当前草稿一同移除。"}`,
      )
    )
      return;
    const id = idOf(selected);
    const next = items.filter((item) => idOf(item) !== id);
    library.edit((current) =>
      kind === "characters"
        ? removeCreativeCharacter(current, id)
        : removeCreativeScene(current, id),
    );
    setSelectedId(next[0] ? idOf(next[0]) : null);
  }
  function move(offset: number) {
    library.edit((current) =>
      kind === "characters"
        ? { ...current, characters: reorder(current.characters, selectedIndex, offset) }
        : { ...current, scenes: reorder(current.scenes, selectedIndex, offset) },
    );
  }
  const sharedDescription = "作品共享设定 · 各集读取同一份草稿";
  const stateLabel = library.busy
    ? "正在处理…"
    : library.dirty
      ? "有未保存修改"
      : library.version
        ? `草稿 v${library.version.version_number}`
        : "尚未保存版本";
  return (
    <>
      <PageTitle
        actions={
          <>
            <Button disabled={library.busy} onClick={() => void library.reload()}>
              重新读取
            </Button>
            {kind !== "world" && (
              <Button
                primary
                icon="plus"
                disabled={library.locked || items.length >= 500}
                onClick={add}
              >
                新增{titles[kind]}
              </Button>
            )}
          </>
        }
      />
      <section
        className={`manual-creative-page manual-creative-${kind}`}
        aria-label={`${titles[kind]}草稿编辑器`}
        aria-busy={library.busy}
        id="manual-creative-editor"
        tabIndex={-1}
      >
        <div className="manual-creative-status">
          <div>
            <Pill>{stateLabel}</Pill>
            <span>{sharedDescription}</span>
          </div>
          <span>人工草稿</span>
        </div>
        {library.notice && (
          <div className="manual-creative-notice" role="status" aria-live="polite">
            {library.notice}
          </div>
        )}
        {library.journal.kind === "PENDING" && (
          <div className="manual-creative-recovery">
            <span>原提交的内容和保存标识已保留，核对完成前暂停编辑。</span>
            <Button disabled={!library.canRecover} onClick={() => void library.save(true)}>
              核对原提交
            </Button>
          </div>
        )}
        {library.readState === "loading" ? (
          <div className="v2-visual-empty manual-creative-empty" role="status">
            <Icon name="globe" size={32} />
            <h2>正在读取作品设定</h2>
            <p>正在连接本地作品库…</p>
          </div>
        ) : library.readState === "error" ? (
          <div className="v2-visual-empty manual-creative-empty">
            <h2>暂时无法读取设定</h2>
            <p>读取成功后才能编辑，避免覆盖已有内容。</p>
            <Button disabled={library.busy} onClick={() => void library.reload()}>
              重试读取
            </Button>
          </div>
        ) : kind === "world" ? (
          <div className="manual-world-layout">
            <aside className="v2-visual-card manual-world-overview">
              <Icon name="globe" size={36} />
              <h2>世界观</h2>
              <p>
                {hasWorld
                  ? world.premise || "已填写世界设定"
                  : "从世界定位开始，逐步完善规则与视觉约束。"}
              </p>
              <p className="manual-creative-muted">
                文字与真实参考保存为同一作品版本；制作批准仍需独立核对。
              </p>
              <Button
                disabled={library.locked || !hasWorld}
                onClick={() => {
                  if (window.confirm("清空当前世界草稿的全部文字吗？保存后旧版本仍会保留。"))
                    library.edit((current) => ({ ...current, world: emptyCreativeWorld() }));
                }}
              >
                清空世界草稿
              </Button>
            </aside>
            <div className="v2-visual-card manual-creative-detail">
              <header>
                <h2>{hasWorld ? "编辑世界设定" : "创建世界设定"}</h2>
                <Pill>作品共享</Pill>
              </header>
              <fieldset disabled={library.locked} className="manual-creative-fields">
                {worldFields.map(({ key, label, hint, short }) => (
                  <label key={key}>
                    {label}
                    {short ? (
                      <input
                        value={world[key]}
                        maxLength={240}
                        placeholder={hint}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          library.edit((current) => ({
                            ...current,
                            world: { ...current.world, [key]: value },
                          }));
                        }}
                      />
                    ) : (
                      <textarea
                        value={world[key]}
                        maxLength={20_000}
                        placeholder={hint}
                        rows={key === "premise" || key === "rules" ? 4 : 3}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          library.edit((current) => ({
                            ...current,
                            world: { ...current.world, [key]: value },
                          }));
                        }}
                      />
                    )}
                  </label>
                ))}
              </fieldset>
              <EnvironmentReferences
                key={library.content.project_id}
                content={library.content}
                sceneId={null}
                variantId={null}
                locked={library.locked}
                edit={library.edit}
                onNotice={library.setNotice}
              />
            </div>
          </div>
        ) : !items.length ? (
          <div className="v2-visual-empty manual-creative-empty">
            <Icon name={kind === "characters" ? "users" : "globe"} size={36} />
            <h2>还没有{titles[kind]}</h2>
            <p>
              {kind === "characters"
                ? "先写下人物身份、外观和性格，无需参考图片即可开始。"
                : "先建立地点与环境设定，记录时间、天气和连续性要求。"}
            </p>
            <Button primary disabled={library.locked} onClick={add}>
              创建第一个{titles[kind]}
            </Button>
          </div>
        ) : (
          <div className="manual-creative-layout">
            <aside
              className="v2-visual-card manual-creative-list"
              aria-label={`${titles[kind]}列表`}
            >
              <header>
                <h2>{titles[kind]}列表</h2>
                <span>{items.length} 个</span>
              </header>
              <ol>
                {items.map((item, index) => (
                  <li key={idOf(item)}>
                    <button
                      type="button"
                      aria-pressed={selected && idOf(selected) === idOf(item)}
                      onClick={() => select(idOf(item))}
                      disabled={library.busy}
                    >
                      <span className="manual-creative-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <strong>{item.name || `未命名${titles[kind]}`}</strong>
                        <small>
                          {"role" in item
                            ? item.role || "身份待填写"
                            : item.location || "地点待填写"}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </aside>
            {selected && (
              <section className="v2-visual-card manual-creative-detail">
                <header>
                  <h2>{selected.name || `未命名${titles[kind]}`}</h2>
                  <div className="actions">
                    <Button
                      disabled={library.locked || selectedIndex <= 0}
                      onClick={() => move(-1)}
                      aria-label={`上移${titles[kind]}`}
                    >
                      上移
                    </Button>
                    <Button
                      disabled={library.locked || selectedIndex >= items.length - 1}
                      onClick={() => move(1)}
                      aria-label={`下移${titles[kind]}`}
                    >
                      下移
                    </Button>
                    <Button
                      disabled={library.locked}
                      onClick={remove}
                      aria-label={`删除${titles[kind]}`}
                    >
                      删除
                    </Button>
                  </div>
                </header>
                <fieldset disabled={library.locked} className="manual-creative-fields">
                  <ManualCreativeTextFields
                    selected={selected}
                    nameInput={nameInput}
                    updateCharacter={updateCharacter}
                    updateScene={updateScene}
                  />
                </fieldset>
                {"character_id" in selected && (
                  <CharacterDetails
                    content={library.content}
                    characterId={selected.character_id}
                    locked={library.locked}
                    edit={library.edit}
                    onNotice={library.setNotice}
                  />
                )}
                {"scene_id" in selected && (
                  <SceneVariants
                    key={`${library.content.project_id}:${selected.scene_id}`}
                    content={library.content}
                    sceneId={selected.scene_id}
                    locked={library.locked}
                    edit={library.edit}
                    onNotice={library.setNotice}
                  />
                )}
                {projectId && "character_id" in selected && (
                  <CharacterUsagePanel
                    projectId={projectId}
                    characterId={selected.character_id}
                    episodes={episodes}
                    episodeListReady={episodeListReady}
                    selectedEpisodeId={episodeId}
                    dirty={library.dirty}
                  />
                )}
                <p className="manual-creative-muted">
                  设定与参考随同一作品版本保存，镜头必须选用精确版本；保存不替代制作批准。
                </p>
              </section>
            )}
          </div>
        )}
        <footer className="manual-creative-footer">
          <div>
            <strong>
              {library.dirty
                ? "修改待保存"
                : library.version
                  ? `已读取草稿 v${library.version.version_number}`
                  : "从空白开始创作"}
            </strong>
            <span>保存角色、世界和场景的同一作品版本，旧版保留。</span>
          </div>
          <Button
            primary
            disabled={library.locked || !library.dirty}
            onClick={() => void library.save()}
          >
            {library.busy ? "正在核对…" : "保存草稿"}
          </Button>
        </footer>
      </section>
    </>
  );
}
