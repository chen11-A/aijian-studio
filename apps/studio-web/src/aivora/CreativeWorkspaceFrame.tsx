import { createContext, useContext, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button, EditorDialog } from "./Common";
import { Icon, Logo } from "./Icon";
import { useDemo } from "./model";
import { AssistantServiceStatus } from "./AssistantStatus";
import { AssistantTaskQueue } from "./AssistantTaskQueue";
import { CreativeWorkspaceNavigation } from "./CreativeWorkspaceNavigation";

export const CreativeWorkspaceExit = createContext<() => void>(() => {});
export type WorkspaceParts = {
  outlineTitle: string;
  outline: ReactNode;
  outlineAction?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  properties?: ReactNode;
  notice?: ReactNode;
  status: ReactNode;
  actions?: ReactNode;
};

function Splitter({
  side,
  size,
  onResize,
}: {
  side: "left" | "right";
  size: number;
  onResize: (value: number) => void;
}) {
  const drag = useRef<{ start: number; size: number } | null>(null);
  const min = side === "left" ? 176 : 236;
  const max = side === "left" ? 300 : 380;
  const resize = (value: number) => onResize(Math.min(max, Math.max(min, value)));
  return (
    <div
      className="cw-splitter"
      role="separator"
      tabIndex={0}
      aria-label={side === "left" ? "调整导航宽度" : "调整属性宽度"}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={size}
      onPointerDown={(event) => {
        drag.current = { start: event.clientX, size };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          resize(
            drag.current.size + (event.clientX - drag.current.start) * (side === "left" ? 1 : -1),
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        resize(size + (event.key === "ArrowRight" ? 12 : -12) * (side === "left" ? 1 : -1));
      }}
    />
  );
}

/** The only scrollable surfaces are the document, outline and contextual inspector. */
export function CreativeWorkspaceFrame(parts: WorkspaceParts) {
  const d = useDemo();
  const onExit = useContext(CreativeWorkspaceExit);
  const [leftWidth, setLeftWidth] = useState(218);
  const [rightWidth, setRightWidth] = useState(284);
  const [rightTab, setRightTab] = useState<"properties" | "ai">("properties");
  const episode = d.episodes.find((item) => item.id === d.selectedEpisodeId);
  const project = d.projects.find((item) => item.backendId === d.backendProjectId);
  return (
    <div
      className="creative-workspace"
      data-page={d.page}
      style={
        {
          "--cw-left-width": `${leftWidth}px`,
          "--cw-right-width": `${rightWidth}px`,
        } as CSSProperties
      }
    >
      <a className="skip-link" href="#creative-document">
        跳到编辑正文
      </a>
      <header className="cw-titlebar">
        <button className="cw-brand" aria-label="返回作品概览" onClick={() => d.go("project")}>
          <Logo />
          <strong>AIVORA</strong>
        </button>
        <div className="cw-breadcrumb">
          <span>{project?.name ?? "创作工作区"}</span>
          <span>／</span>
          <strong>{episode?.title ?? "选择剧集"}</strong>
        </div>
        <span className="cw-preview-label">桌面工作区 · 预览</span>
        <Button onClick={onExit}>返回原布局</Button>
      </header>
      <div className="cw-columns">
        <aside className="cw-navigator" aria-label="项目、剧集和内容导航">
          <CreativeWorkspaceNavigation />
          <div className="cw-section-label">
            <span>{parts.outlineTitle}</span>
            {parts.outlineAction}
          </div>
          <div className="cw-outline">{parts.outline}</div>
          <nav className="cw-navigation-links" aria-label="项目工具">
            <button onClick={() => d.go("source")}>
              <Icon name="book" size={15} /> 来源与灵感
            </button>
            <button onClick={() => d.go("assets")}>
              <Icon name="image" size={15} /> 素材
            </button>
            <button onClick={() => d.go("project")}>
              <Icon name="folder" size={15} /> 作品概览
            </button>
          </nav>
        </aside>
        <Splitter side="left" size={leftWidth} onResize={setLeftWidth} />
        <main className="cw-editor">
          <nav className="cw-document-tabs" aria-label="编辑文档">
            <button
              aria-current={d.page === "script" ? "page" : undefined}
              onClick={() => {
                if (d.page !== "script") d.go("script");
              }}
            >
              <Icon name="book" size={17} />
              剧本
            </button>
            <button
              aria-current={d.page === "storyboard" ? "page" : undefined}
              onClick={() => {
                if (d.page !== "storyboard") d.go("storyboard");
              }}
            >
              <Icon name="film" size={17} />
              分镜
            </button>
            <span>{d.page === "script" ? "编剧" : "分镜导演"}工作台</span>
          </nav>
          {parts.tools && <div className="cw-document-tools">{parts.tools}</div>}
          <div className="cw-document-scroll" id="creative-document" tabIndex={-1}>
            {parts.children}
          </div>
        </main>
        <Splitter side="right" size={rightWidth} onResize={setRightWidth} />
        <aside className="cw-inspector" aria-label="上下文属性">
          <div className="cw-inspector-tabs" role="tablist" aria-label="上下文面板">
            <button
              role="tab"
              aria-selected={rightTab === "properties"}
              onClick={() => setRightTab("properties")}
            >
              属性
            </button>
            <button role="tab" aria-selected={rightTab === "ai"} onClick={() => setRightTab("ai")}>
              <Icon name="spark" size={15} />
              AI 助手
            </button>
          </div>
          <div className="cw-properties" hidden={rightTab !== "properties"}>
            {parts.properties}
          </div>
          {rightTab === "ai" && (
            <div className="cw-ai">
              <p>手工创作不需要 AI。这里可查看服务和制作任务。</p>
              <AssistantServiceStatus />
              <details>
                <summary>制作任务</summary>
                <AssistantTaskQueue />
              </details>
            </div>
          )}
        </aside>
      </div>
      {parts.notice && (
        <div className="cw-notice" role="status">
          {parts.notice}
        </div>
      )}
      <footer className="cw-statusbar">
        <div>{parts.status}</div>
        <div className="cw-save-actions">{parts.actions}</div>
      </footer>
      {d.toast && (
        <div className="toast" role="status">
          {d.toast}
        </div>
      )}
      <EditorDialog />
    </div>
  );
}
