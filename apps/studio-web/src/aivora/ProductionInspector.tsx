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
        <p role="status">本页的对象级属性绑定尚未接入此面板。</p>
        <p>请在中间工作区选择和编辑真实场次、镜头或片段。保存版本与回读状态以该编辑器为准。</p>
        <p>这里不会提供默认镜头、模型参数或批准操作。</p>
        <Button onClick={() => document.getElementById("demo-scroll")?.focus()}>
          返回编辑工作区
        </Button>
      </section>
    </aside>
  );
}
