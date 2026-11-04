import { useState } from "react";
import type { LoggedNotice } from "./wiring/statusNotice";

/**
 * 「最近的提示」 in the task center (3J-U04): the messages that already left the status bar.
 * Closed by default; the list is only drawn while it is open.
 */
export function NoticeLog({ log }: { log: readonly LoggedNotice[] }) {
  const [open, setOpen] = useState(false);
  if (log.length === 0) return null;
  return (
    <section className="notice-log">
      <button
        type="button"
        className="notice-log-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "收起最近的提示" : `最近的提示（${log.length}）`}
      </button>
      {open ? (
        <ol>
          {log.map((entry) => (
            <li key={entry.id}>
              <time dateTime={entry.at.toISOString()}>
                {entry.at.toLocaleTimeString("zh-CN", { hour12: false })}
              </time>
              <span>{entry.text}</span>
              {entry.detail ? <small>{entry.detail}</small> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
