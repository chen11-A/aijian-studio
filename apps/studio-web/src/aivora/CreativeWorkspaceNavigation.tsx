import { Button } from "./Common";
import { Icon } from "./Icon";
import { useDemo } from "./model";

/** Project and episode changes use the same guarded authoritative selection path as the main shell. */
export function CreativeWorkspaceNavigation() {
  const d = useDemo();
  function createEpisode() {
    d.setEditor({
      title: "新建剧集",
      fields: [{ key: "title", label: "剧集名称", value: "", required: true }],
      confirm: "创建剧集",
      save: async (values) => {
        const title = values.title?.trim();
        if (!title) return false;
        const outcome = await d.createRealEpisode({ title });
        if (outcome.kind !== "SUCCEEDED") {
          d.notify(
            outcome.kind === "REMOTE_UNKNOWN"
              ? "创建结果待确认，请刷新剧集列表核对。"
              : "剧集未创建，请核对名称和工作区连接后重试。",
          );
          return false;
        }
        d.notify("剧集已创建并读回，可以开始编写。");
      },
    });
  }
  const unavailable =
    d.episodeState === "loading" ||
    d.episodeState === "storage-error" ||
    d.episodeCreateInFlight ||
    !!d.episodeCreateMarker;
  return (
    <div className="cw-project-navigation">
      <label className="cw-project-select">
        作品
        <select
          aria-label="作品选择"
          value={d.value("projectId")}
          onChange={(event) => {
            const project = d.projects.find((item) => item.id === Number(event.target.value));
            if (project) void d.selectRealProject(project.id);
          }}
        >
          {d.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <div className="cw-section-label">
        <span>
          <Icon name="folder" size={15} /> 剧集
        </span>
        <Button
          aria-label="新建剧集"
          title="新建剧集"
          disabled={unavailable}
          onClick={createEpisode}
        >
          ＋
        </Button>
      </div>
      <nav className="cw-episodes" aria-label="剧集导航">
        {d.episodes.map((episode, index) => (
          <button
            key={episode.id}
            type="button"
            aria-current={episode.id === d.selectedEpisodeId ? "true" : undefined}
            disabled={d.episodeState === "loading"}
            onClick={() => {
              if (episode.id !== d.selectedEpisodeId) void d.selectRealEpisode(episode.id);
            }}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{episode.title}</strong>
          </button>
        ))}
        {d.episodeState === "loading" && <p role="status">正在读取剧集…</p>}
        {d.episodeState === "ready" && !d.episodes.length && <p>新建一集开始创作。</p>}
      </nav>
      {(d.episodeState === "error" ||
        d.episodeState === "storage-error" ||
        d.episodeCreateMarker) && (
        <div className="cw-episode-recovery" role="status">
          <p>{d.episodeCreateMarker ? "创建结果待核对" : "剧集读取未完成"}</p>
          <Button disabled={d.episodeCreateInFlight} onClick={() => void d.refreshRealEpisodes()}>
            刷新剧集列表
          </Button>
          {d.episodeCreateMarker && (
            <Button
              disabled={!d.episodeAcknowledgementReady}
              onClick={d.acknowledgeEpisodeCreation}
            >
              我已核对结果，允许新建
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
