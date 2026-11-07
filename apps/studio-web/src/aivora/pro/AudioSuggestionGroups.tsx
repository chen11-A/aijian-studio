export type AudioGroupView = { id: string; count: number; complete: boolean; lanes: string };
export function AudioSuggestionGroups({
  groups,
  busy,
  onRemove,
  scene = false,
}: {
  groups: readonly AudioGroupView[];
  busy: boolean;
  onRemove: (id: string) => void;
  scene?: boolean;
}) {
  if (!groups.length) return null;
  return (
    <section
      className="field shot-audio-groups"
      aria-label={scene ? "当前场次的完整配声建议组" : "当前版本的配声建议组"}
    >
      <h4>{scene ? "本场已选用的整组声音" : "已选用的配声建议"}</h4>
      <p>移除整组只移除这次建议的声音引用，原音频文件和其他片段保留。</p>
      {scene && (
        <p>
          这里核对的是整组引用是否完整，不代表当前仍可混入声音；选版或时钟变化后的停用提醒请查看试听状态。
        </p>
      )}
      {groups.map((group, index) => (
        <div key={group.id}>
          <span>
            第{index + 1}组 · {group.count} 段 · {group.lanes}
          </span>
          <button
            className="btn sm"
            disabled={busy || !group.complete}
            onClick={() => onRemove(group.id)}
          >
            移除第{index + 1}组声音
          </button>
          {!group.complete && (
            <p role="status">这组片段未能完整核对或后来改过，不能整组移除；请先核对当前声音。</p>
          )}
        </div>
      ))}
    </section>
  );
}
