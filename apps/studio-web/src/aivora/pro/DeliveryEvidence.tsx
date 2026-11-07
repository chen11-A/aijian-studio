import type { DeliveryEvidenceView, DeliveryFileView } from "./actions/delivery-evidence-view";
import "./DeliveryEvidence.css";
function FileRecord({ file }: { file: DeliveryFileView }) {
  return (
    <article className="delivery-file">
      <h4>
        {file.role} · {file.aspect}
      </h4>
      <p className="delivery-name">{file.name}</p>
      {file.sha ? (
        <dl>
          <dt>文件 SHA256</dt>
          <dd>
            <code>{file.sha}</code>
          </dd>
          <dt>文件大小</dt>
          <dd>{file.bytes} 字节</dd>
        </dl>
      ) : (
        <p>未提供文件指纹与技术记录。</p>
      )}
      {file.facts.length ? (
        <details>
          <summary>技术记录（不代表观看或试听）</summary>
          <dl>
            {file.facts.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </article>
  );
}
export function DeliveryEvidence({
  view,
  partial,
}: {
  view: DeliveryEvidenceView;
  partial: boolean;
}) {
  return (
    <section className="delivery-evidence" aria-label="交付证据">
      {partial ? <p role="status">本次导出仅完成一部分，已写出的文件保留。</p> : null}
      {view.kind === "not-provided" ? (
        <p role="status">这次导出未提供交付清单，暂时不能核对交付证据。</p>
      ) : view.kind === "invalid" ? (
        <p role="alert">交付证据没有读懂，请核对已发布的文件。</p>
      ) : view.kind === "failed" ? (
        <>
          <p role="status">
            {view.reason === "unavailable" ? "本次没有可用的交付清单。" : "交付清单未能确认写出。"}
            以下仅列出已经确认写出的文件。
          </p>
          {view.files.map((file, i) => (
            <FileRecord key={`${file.aspect}:${file.role}:${i}`} file={file} />
          ))}
        </>
      ) : (
        <>
          <h3>交付清单已生成</h3>
          <p className="delivery-name">{view.name}</p>
          <dl>
            <dt>清单记录时间</dt>
            <dd>{view.createdAt}</dd>
            <dt>清单 SHA256</dt>
            <dd>
              <code>{view.sha}</code>
            </dd>
          </dl>
          <p>
            指纹用于核对文件，不代表已完整观看、试听或确认全部内容质量，也不是后续生成或发布的许可。
          </p>
          <h4>本次已写出的文件</h4>
          {view.files.map((file) => (
            <FileRecord key={file.name} file={file} />
          ))}
          <details>
            <summary>导出设置与实际选材记录</summary>
            {view.settings.map((row) => (
              <p key={row}>{row}</p>
            ))}
            {view.selection.length ? (
              <ol>
                {view.selection.map((row, i) => (
                  <li key={i}>{row}</li>
                ))}
              </ol>
            ) : (
              <p>未提供选材说明。</p>
            )}
          </details>
          <h4>仍需人工核对</h4>
          {view.unverified.length ? (
            <ul>
              {view.unverified.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>未提供逐项说明，仍需完整播放和试听核对。</p>
          )}
        </>
      )}
      <p className="role-desc">技术检查、文件存在或点击播放，都不等于已经完整观看和试听。</p>
    </section>
  );
}
