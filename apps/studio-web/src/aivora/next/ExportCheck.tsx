import type { ReactNode } from "react";
import "./next.css";
import "./ExportCheck.css";
import { detailRows, QC_TYPE_LABEL, readQcReport, type QcIssue, type QcReport } from "./qcReport";
import { clockLabel, durationLabel, shotLabel } from "./shot";

/**
 * Where a shot sits in the export, in seconds, so an issue can name its shot. label is how the
 * shot is named on screen; without it the name comes from an id like scene-2-shot-17.
 */
export type ShotSpan = { id: string; start: number; end: number; label?: string };

export type ExportCheckProps = {
  /**
   * The parsed JSON that packages/aivora-qc writes. It goes through readQcReport, so anything
   * but a schemaVersion 1 report shows 「检查结果读不出来」 with the reason. null until a check
   * finishes.
   */
  report: unknown;
  checking?: boolean;
  /** The check could not run, for example because ffmpeg was not found. */
  error?: string | null;
  shots?: readonly ShotSpan[];
  fileName?: string;
  /** 「去修」: the caller opens the place to fix it, using issue.action. Nothing is changed here. */
  onFix: (issue: QcIssue) => void;
  /** 「直接导出」: export as it is, whatever issues are left. */
  onExport: () => void;
};

type Where = { text: string; code: string };

export function issueWhere(issue: QcIssue, shots: readonly ShotSpan[] = []): Where {
  if (issue.scope === "program") return { text: "整片", code: "" };
  const shot = shots.find((span) => issue.time >= span.start && issue.time < span.end);
  if (shot) {
    return {
      text: shot.label ?? shotLabel(shot.id),
      code: `${shot.id} · ${clockLabel(issue.time)}`,
    };
  }
  return { text: issue.timeLabel, code: clockLabel(issue.time) };
}

function IssueRow({
  issue,
  shots,
  onFix,
}: {
  issue: QcIssue;
  shots?: readonly ShotSpan[];
  onFix: (issue: QcIssue) => void;
}) {
  const where = issueWhere(issue, shots);
  const rows = detailRows(issue.detail);
  const blocking = issue.severity === "block";
  return (
    <li className="nx-issue">
      <div className="nx-issue-main">
        <p className="nx-issue-h">
          <span className={`nx-tag ${blocking ? "nx-err" : "nx-warn"}`}>
            {QC_TYPE_LABEL[issue.type] ?? "其他"}
          </span>
          <strong>{issue.message}</strong>
        </p>
        {issue.suggestion ? <p className="nx-issue-fix">{issue.suggestion}</p> : null}
        <p className="nx-issue-where">
          <span>{where.text}</span>
          {where.code ? <span className="nx-code">{where.code}</span> : null}
        </p>
        {rows.length > 0 ? (
          <details className="nx-adv">
            <summary>高级</summary>
            <dl className="nx-adv-rows">
              {rows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
              <div>
                <dt>编号</dt>
                <dd className="nx-code">{issue.id}</dd>
              </div>
            </dl>
          </details>
        ) : null}
      </div>
      <button
        type="button"
        className="nx-btn nx-sm"
        aria-label={`去修：${issue.message}`}
        onClick={() => onFix(issue)}
      >
        去修
      </button>
    </li>
  );
}

function exportNote(state: {
  checking: boolean;
  error: string | null;
  invalid: string | null;
  report: QcReport | null;
  block: number;
  warn: number;
}): string {
  if (state.checking) return "检查完才能导出。";
  if (state.error) return `检查没做完：${state.error} 直接导出也行，成片没有经过检查。`;
  if (state.invalid) return "检查结果读不出来。直接导出也行，成片没有经过检查。";
  if (!state.report) return "还没有检查结果。直接导出也行，成片没有经过检查。";
  if (state.block > 0)
    return `还有 ${state.block} 处要先处理。直接导出也行，这些问题会留在成片里。`;
  if (state.warn > 0) return `有 ${state.warn} 处建议看看，不影响导出。`;
  return "没有发现问题，可以导出。";
}

/** Export check: every issue from the checker with one 「去修」, and one 「直接导出」. */
export function ExportCheck({
  report,
  checking = false,
  error = null,
  shots,
  fileName,
  onFix,
  onExport,
}: ExportCheckProps) {
  const read = report ? readQcReport(report) : null;
  const valid = read?.ok ? read.report : null;
  const invalid = read && !read.ok ? read.reason : null;
  const issues = valid?.issues ?? [];
  const blocking = issues.filter((issue) => issue.severity === "block");
  const warnings = issues.filter((issue) => issue.severity === "warn");
  const groups = [
    { id: "block", title: "要先处理", tone: "nx-err", rows: blocking },
    { id: "warn", title: "建议看看", tone: "nx-warn", rows: warnings },
  ];
  let headline = "还没有检查结果。";
  if (checking) headline = "正在检查成片，查完才能导出。";
  else if (error) headline = "这次没有检查完。";
  else if (invalid) headline = "检查结果读不出来。";
  else if (valid && issues.length > 0) {
    headline = `检查了 ${durationLabel(valid.media.duration)} 的成片：有 ${issues.length} 处问题，其中 ${blocking.length} 处要先处理。`;
  } else if (valid)
    headline = `检查了 ${durationLabel(valid.media.duration)} 的成片，没有发现问题。`;
  const note = exportNote({
    checking,
    error,
    invalid,
    report: valid,
    block: blocking.length,
    warn: warnings.length,
  });

  let body: ReactNode;
  if (checking) {
    body = (
      <div className="nx-export-state" aria-live="polite">
        <p>正在看有没有黑屏、画面停住、没有声音、字幕和音量的问题。</p>
        <p className="nx-faint">成片越长，检查越久。检查只读文件，不会改动成片。</p>
      </div>
    );
  } else if (error || invalid) {
    body = (
      <div className="nx-export-state" role="alert">
        <p>{error ?? `检查结果读不出来：${invalid}`}</p>
        <p className="nx-faint">修好以后再检查一次；也可以不检查直接导出。</p>
      </div>
    );
  } else if (!valid) {
    body = (
      <div className="nx-export-state">
        <p>还没有检查结果。</p>
      </div>
    );
  } else if (issues.length === 0) {
    body = (
      <div className="nx-export-state">
        <p>没有发现问题</p>
        <p className="nx-faint">没有黑屏和停住的画面，声音和字幕也没有发现问题。</p>
      </div>
    );
  } else {
    body = (
      <div className="nx-scroll nx-export-list">
        {groups.map((group) =>
          group.rows.length === 0 ? null : (
            <section key={group.id} aria-label={group.title}>
              <h3 className="nx-export-group">
                <span className={`nx-dot ${group.tone}`} aria-hidden="true" />
                {group.title} · {group.rows.length} 处
              </h3>
              <ul>
                {group.rows.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} shots={shots} onFix={onFix} />
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    );
  }

  return (
    <div className="nx-root nx-export">
      <header className="nx-export-head">
        <h1>导出前检查</h1>
        <p className="nx-muted nx-one-line">{headline}</p>
      </header>
      <div className="nx-export-cols">
        <section className="nx-panel nx-export-issues" aria-label="问题">
          <div className="nx-panel-head">
            <h2>问题</h2>
            {issues.length > 0 ? (
              <span className="nx-faint">每条「去修」会打开能改它的地方</span>
            ) : null}
          </div>
          {body}
        </section>
        <aside className="nx-panel nx-export-side" aria-label="导出">
          <div className="nx-panel-head">
            <h2>导出</h2>
          </div>
          <div className="nx-scroll nx-panel-body nx-export-facts">
            {fileName ? (
              <div className="nx-fact">
                <span className="nx-faint">文件名</span>
                <span className="nx-one-line">{fileName}</span>
              </div>
            ) : null}
            {valid ? (
              <>
                <div className="nx-fact">
                  <span className="nx-faint">成片</span>
                  <span>
                    {valid.media.width < valid.media.height ? "竖屏" : "横屏"} {valid.media.width}×
                    {valid.media.height} · {durationLabel(valid.media.duration)}
                  </span>
                </div>
                <div className="nx-fact">
                  <span className="nx-faint">问题</span>
                  <span>
                    要先处理 {blocking.length} 处 · 建议看看 {warnings.length} 处
                  </span>
                </div>
                <details className="nx-adv">
                  <summary>高级</summary>
                  <dl className="nx-adv-rows">
                    <div>
                      <dt>有音轨</dt>
                      <dd>{valid.audio.present ? "是" : "否"}</dd>
                    </div>
                    <div>
                      <dt>整片响度 LUFS</dt>
                      <dd>{valid.audio.integratedLufs ?? "无法测量"}</dd>
                    </div>
                    <div>
                      <dt>真峰值 dBTP</dt>
                      <dd>{valid.audio.truePeakDbtp ?? "无法测量"}</dd>
                    </div>
                    {Object.entries(valid.assumptions).map(([key, value]) =>
                      typeof value === "string" ? (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                </details>
              </>
            ) : null}
          </div>
          <div className="nx-export-foot">
            <button
              type="button"
              className="nx-btn nx-primary"
              disabled={checking}
              title={checking ? "检查完才能导出" : undefined}
              onClick={onExport}
            >
              直接导出
            </button>
            <p className="nx-faint">{note}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
