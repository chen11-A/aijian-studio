import { useState } from "react";

/** Provider and prompt bytes stay plain text, including malformed model output. */
export function OfficialDirectorPlainText({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  const limit = 20000;
  return (
    <details
      className="official-director-proof"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      {open && (
        <>
          <pre>{text.slice(0, limit)}</pre>
          {text.length > limit && (
            <p>
              这里只预览前 {limit}{" "}
              个字符。完整原始内容仍保留在此操作记录中，提案校验及采纳不使用截短预览。
            </p>
          )}
        </>
      )}
    </details>
  );
}
