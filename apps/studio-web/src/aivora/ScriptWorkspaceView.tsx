import type { ReactNode } from "react";
import { CreativeWorkspaceFrame } from "./CreativeWorkspaceFrame";

/** Presentation slots contain the original script editor's controls and callbacks. */
export type ScriptWorkspaceParts = {
  title: string;
  sceneCount: number;
  blockCount: number;
  outline: ReactNode;
  addScene: ReactNode;
  metadata: ReactNode;
  importControl?: ReactNode;
  alerts: ReactNode;
  recovery: ReactNode;
  confirmation: ReactNode;
  heading: ReactNode;
  blocks: ReactNode;
  blockActions: ReactNode;
  sceneActions: ReactNode;
  changeSummary: ReactNode;
  saveAction: ReactNode;
  confirmAction: ReactNode;
  stateLabel: string;
  hasScene: boolean;
};

export function ScriptWorkspaceView(parts: ScriptWorkspaceParts) {
  return (
    <CreativeWorkspaceFrame
      outlineTitle={`场次 · ${parts.sceneCount}`}
      outline={parts.outline}
      outlineAction={parts.addScene}
      tools={
        <>
          <span>{parts.title}</span>
          <div>{parts.blockActions}</div>
        </>
      }
      properties={
        <>
          <section className="cw-property-section">
            <h2>场次属性</h2>
            {parts.heading}
            <small>{parts.blockCount} 个段落</small>
            <div className="cw-property-actions">{parts.sceneActions}</div>
          </section>
          <section className="cw-property-section">
            <h3>本次修改</h3>
            {parts.changeSummary}
          </section>
          <details className="cw-property-section">
            <summary>版本与来源</summary>
            {parts.metadata}
          </details>
          <details className="cw-property-section">
            <summary>读取与恢复</summary>
            {parts.recovery}
          </details>
          <details className="cw-property-section">
            <summary>人工确认</summary>
            {parts.confirmation}
            {parts.confirmAction}
            <p>确认绑定当前精确版本。保存新草稿后需重新确认。</p>
          </details>
        </>
      }
      notice={parts.alerts}
      status={
        <>
          <strong>{parts.stateLabel}</strong>
          <span> · {parts.sceneCount} 场 · 本集独立保存</span>
        </>
      }
      actions={parts.saveAction}
    >
      <article className="cw-script-document" aria-label="分集剧本编辑器">
        <header>
          <small>SCREENPLAY / 分集剧本</small>
          <h1>{parts.title}</h1>
        </header>
        {parts.hasScene ? (
          parts.blocks
        ) : (
          <div className="cw-document-empty">
            <h2>写下第一个场次</h2>
            <p>从左侧新增场次，然后添加动作和对白。草稿会保存到当前剧集。</p>
            {parts.addScene}
            {parts.importControl}
          </div>
        )}
        {parts.hasScene && (
          <div className="cw-document-end">
            <span>场次结束</span>
            {parts.blockActions}
          </div>
        )}
      </article>
    </CreativeWorkspaceFrame>
  );
}
