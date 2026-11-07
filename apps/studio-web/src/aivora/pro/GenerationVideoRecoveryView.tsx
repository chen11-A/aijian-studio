import "./GenerationVideoRecoveryView.css";

export type RecoveryFileView = { fileName: string; sha256: string; bytes: number };
export type RecoveryRowView = {
  key: string;
  file?: RecoveryFileView;
  message?: string;
  saved?: boolean;
  needsRefresh?: boolean;
};
export type RecoveryViewState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: RecoveryRowView[]; hasMore: boolean };

/** Opaque row keys are callback identity only; never displayed as provider or task identifiers. */
export function GenerationVideoRecoveryView({
  state,
  busy,
  canRefresh,
  onClose,
  onRefresh,
  onRecover,
  onSave,
}: {
  state: RecoveryViewState;
  busy: boolean;
  canRefresh: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onRecover: (key: string) => void;
  onSave: (key: string) => void;
}) {
  return (
    <div className="dialog-back">
      <section
        className="dialog generation-video-recovery"
        role="dialog"
        aria-modal="true"
        aria-label="找回原视频素材"
        aria-busy={busy}
      >
        <h2>找回原视频素材</h2>
        <p>
          查看本集关联作品中可核对的提交记录。只有点击“找回原素材”才查询原任务，不会重新提交生成。
        </p>
        <p className="role-desc">
          找回的是原始视频素材，不会自动替换当前版本、继续原任务或应用到后来修改的镜头。另存后请自行核对内容；文件已找回不代表已经完整观看或试听。
        </p>
        {state.kind === "loading" ? <p role="status">正在读取可核对的记录…</p> : null}
        {state.kind === "unsupported" ? (
          <p role="status">当前环境不支持找回原视频素材，请使用支持此功能的桌面版。</p>
        ) : null}
        {state.kind === "error" ? <p role="alert">{state.message}</p> : null}
        {state.kind === "ready" ? (
          <>
            {state.rows.length === 0 ? (
              <p role="status">没有读到可核对的记录。这不代表所有视频都已生成。</p>
            ) : (
              <ol className="recovery-list">
                {state.rows.map((row, index) => (
                  <li key={row.key}>
                    <h3>记录 {index + 1}</h3>
                    {row.file ? (
                      <>
                        <p>原素材已找回</p>
                        <dl>
                          <dt>文件名</dt>
                          <dd>{row.file.fileName}</dd>
                          <dt>SHA256</dt>
                          <dd>{row.file.sha256}</dd>
                          <dt>文件大小</dt>
                          <dd>{row.file.bytes} 字节</dd>
                        </dl>
                      </>
                    ) : (
                      <p>原素材尚未确认。</p>
                    )}
                    {row.message ? <p role="status">{row.message}</p> : null}
                    {row.saved ? <p role="status">原素材已另存。当前镜头和版本没有替换。</p> : null}
                    {row.needsRefresh ? (
                      <p className="role-desc">请重新读取列表后再核对这条记录。</p>
                    ) : null}
                    <button
                      className="btn"
                      type="button"
                      disabled={busy || row.needsRefresh}
                      onClick={() => (row.file ? onSave(row.key) : onRecover(row.key))}
                    >
                      {row.file ? "另存原素材" : "找回原素材"}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {state.hasMore ? (
              <p className="role-desc">还有其他记录未列出。本次列表不是完整任务清单。</p>
            ) : null}
          </>
        ) : null}
        <div className="acts">
          <button className="btn" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="btn" type="button" disabled={busy || !canRefresh} onClick={onRefresh}>
            重新读取列表
          </button>
        </div>
      </section>
    </div>
  );
}
