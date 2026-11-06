import "./SuggestionFieldDiff.css";

/** Already projected safe text; the host owns field/scope validation and value redaction. */
export type SuggestionFieldRow = {
  key: string;
  label: string;
  kind: "changed" | "added" | "removed";
  /** null means absent; an empty string means present but empty. */
  before: string | null;
  after: string | null;
};

const MARK = { changed: "修改", added: "新增", removed: "删除" } as const;
const valueText = (value: string | null) =>
  value === null ? "未设置" : value === "" ? "空" : value;

export function SuggestionFieldDiff({ rows }: { rows: readonly SuggestionFieldRow[] }) {
  if (rows.length === 0) return <p className="nx-muted">没有字段改动。</p>;
  return (
    <ol className="nx-field-diff" aria-label="字段改动">
      {rows.map((row) => (
        <li key={row.key} className="nx-field-row" data-kind={row.kind}>
          <div className="nx-field-head">
            <strong>{row.label}</strong>
            <span className="nx-tag">{MARK[row.kind]}</span>
          </div>
          <dl className="nx-field-values">
            <div>
              <dt>原来</dt>
              <dd>{valueText(row.before)}</dd>
            </div>
            <div>
              <dt>建议</dt>
              <dd>{valueText(row.after)}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}
