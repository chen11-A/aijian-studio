import { Button, Pill } from "./Common";
import { useCharacterUsage } from "./useCharacterUsage";
import { CharacterUsageRowView } from "./CharacterUsageRowView";
import type { CharacterUsageEpisode } from "./useCharacterUsage";

export function CharacterUsagePanel({
  projectId,
  characterId,
  episodes,
  episodeListReady,
  selectedEpisodeId,
  dirty,
}: {
  projectId: string;
  characterId: string;
  episodes: readonly CharacterUsageEpisode[];
  episodeListReady: boolean;
  selectedEpisodeId: string | null;
  dirty: boolean;
}) {
  const { state, refresh } = useCharacterUsage(projectId, episodes, episodeListReady);
  const unknown = state.rows.filter((row) => !["FOUND", "EMPTY"].includes(row.result.kind)).length;
  return (
    <section className="character-detail-section character-details" aria-label="角色跨集使用与影响">
      <header>
        <h3>跨集使用与镜头影响</h3>
        <Button
          disabled={state.kind === "LOADING" || !episodeListReady}
          onClick={() => void refresh()}
        >
          刷新角色使用
        </Button>
      </header>
      <p className="manual-creative-muted">
        仅核对各集当前已保存分镜的角色引用。尚未覆盖未保存编辑、集内服装选用、生成任务或完整失效链。
      </p>
      {dirty && (
        <p className="manual-creative-muted">
          共享设定有未保存修改；以下使用镜头需核对是否采用另存后的新版。原精确版本保留。
        </p>
      )}
      {state.kind === "WAITING" && <p role="status">分集列表尚未核对，使用情况未知</p>}
      {state.kind === "INVALID_SCOPE" && <p role="alert">分集作用域不一致，使用情况未知</p>}
      {state.kind === "UNAVAILABLE" && <p role="status">当前桌面未连接分镜读取，使用情况未知</p>}
      {state.kind === "LOADING" && <p role="status">正在读取保存分镜…</p>}
      {state.kind === "READY" && (
        <Pill>
          {!state.rows.length
            ? "作品尚无分集"
            : unknown
              ? `使用统计尚不完整：${unknown} 个分集待核对`
              : `已读取 ${state.rows.length} 个分集的保存分镜`}
        </Pill>
      )}
      {state.rows.map((row) => (
        <CharacterUsageRowView
          key={row.episode.id}
          row={row}
          characterId={characterId}
          selected={row.episode.id === selectedEpisodeId}
        />
      ))}
    </section>
  );
}
