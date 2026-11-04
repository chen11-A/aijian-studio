import { Component } from "react";
import type { ReactNode } from "react";
import "./workbench-render-boundary.css";

export type WorkbenchRenderBoundaryProps = {
  children: ReactNode;
  /** Reload the existing renderer only; do not retry saves or provider calls. */
  onReload(): void;
};

type WorkbenchRenderBoundaryState = { failed: boolean };

/** Handles descendant React render/lifecycle errors, not process or GPU crashes. */
export class WorkbenchRenderBoundary extends Component<
  WorkbenchRenderBoundaryProps,
  WorkbenchRenderBoundaryState
> {
  state: WorkbenchRenderBoundaryState = { failed: false };

  static getDerivedStateFromError(_error: unknown): WorkbenchRenderBoundaryState {
    // Retain no exception, stack, project input, or provider details.
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="workbench-render-recovery">
        <section
          className="workbench-render-recovery-panel"
          role="alert"
          aria-labelledby="workbench-render-recovery-title"
        >
          <strong className="workbench-render-recovery-brand">AIVORA</strong>
          <h1 id="workbench-render-recovery-title">工作台显示遇到问题</h1>
          <p>界面发生异常，暂时无法继续操作。</p>
          <p>如果刚刚进行了保存或确认，结果尚未核实；请重新加载后先核对状态，再继续编辑。</p>
          <p>重新加载可能丢失尚未保存的修改。</p>
          <button type="button" onClick={() => this.props.onReload()}>
            重新加载工作台
          </button>
          <small>界面标识：AIVORA-UI-001</small>
        </section>
      </main>
    );
  }
}
