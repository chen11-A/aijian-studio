import { Button } from "./Common";
import { pages } from "./data";
import { useDemo } from "./model";

/** Never substitute sample shots or in-memory property writes for real objects. */
export function ProductionInspector() {
  const d = useDemo();
  const project = d.projects.find((item) => item.backendId === d.backendProjectId);
  const episode = d.episodes.find(
    (item) => item.id === d.selectedEpisodeId && item.project_id === d.backendProjectId,
  );
  return (
    <aside className="inspector production-inspector" aria-label="真实作品属性面板">
      <header>
        <h2>对象属性</h2>
        <p>当前工作区 · 只读上下文</p>
      </header>
      <section className="production-inspector-body">
        <dl>
          <dt>作品</dt>
          <dd>{project?.name ?? "尚未选择作品"}</dd>
          <dt>剧集</dt>
          <dd>{episode?.title ?? "尚未选择剧集"}</dd>
          <dt>页面</dt>
          <dd>{pages[d.page][0]}</dd>
        </dl>
        <p role="status">详细属性在中间的工作区里编辑。</p>
        <p>作品、剧集和当前页面显示在上面。</p>
        <Button onClick={() => document.getElementById("demo-scroll")?.focus()}>
          返回编辑工作区
        </Button>
      </section>
    </aside>
  );
}
