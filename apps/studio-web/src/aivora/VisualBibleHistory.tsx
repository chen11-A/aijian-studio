import { useEffect, useRef, useState } from "react";
import {
  visualHistoryData,
  visualJson,
  type VisualHistoryPage,
  type VisualHistoryEntry,
} from "@aijian/contracts/visual-bible";
import { Button } from "./Common";
type HistoryView = Pick<VisualHistoryPage, "head" | "items" | "next_cursor">;

/** A read-only directory, separate from the editor's pending write journal. */
export function VisualBibleHistory({
  projectId,
  selectedId,
  locked,
  select,
}: {
  projectId: string;
  selectedId?: string;
  locked: boolean;
  select: (id: string, expected: VisualHistoryEntry) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<{
    project: string;
    page: HistoryView | null;
    state: "loading" | "ready" | "empty" | "error";
    more: boolean;
    error: string;
  }>();
  const epoch = useRef(0);
  const running = useRef(false);
  const current = snapshot?.project === projectId ? snapshot : undefined;
  async function read(cursor: string | null) {
    if (running.current) return;
    running.current = true;
    const operation = ++epoch.current;
    const previous = current?.page ?? null;
    setSnapshot({
      project: projectId,
      page: previous,
      state: cursor === null ? "loading" : "ready",
      more: cursor !== null,
      error: "",
    });
    try {
      const result = await window.aijian?.listVisualBibleVersions?.(projectId, cursor);
      if (epoch.current !== operation) return;
      if (cursor === null && result?.kind === "EMPTY") {
        setSnapshot({ project: projectId, page: null, state: "empty", more: false, error: "" });
        return;
      }
      if (result?.kind !== "FOUND" || !visualHistoryData(result.data, projectId, cursor))
        throw new Error("Unknown history receipt");
      let page: HistoryView = {
        head: result.data.head,
        items: result.data.items,
        next_cursor: result.data.next_cursor,
      };
      if (cursor !== null) {
        if (
          !previous ||
          previous.next_cursor !== cursor ||
          visualJson(previous.head) !== visualJson(page.head) ||
          page.items.some((item) => previous.items.some((old) => old.id === item.id)) ||
          (page.items.length > 0 &&
            previous.items.at(-1)!.version_number <= page.items[0]!.version_number)
        )
          throw new Error("History snapshot changed");
        page = { ...page, items: [...previous.items, ...page.items] };
      }
      setSnapshot({ project: projectId, page, state: "ready", more: false, error: "" });
    } catch {
      if (epoch.current === operation)
        setSnapshot({
          project: projectId,
          page: previous,
          state: cursor === null ? "error" : "ready",
          more: false,
          error: "历史目录未通过核对或头版本已变化；当前输入和已读取记录保留。请刷新后核对。",
        });
    } finally {
      if (epoch.current === operation) running.current = false;
    }
  }
  useEffect(() => {
    running.current = false;
    void read(null);
    return () => {
      epoch.current++;
      running.current = false;
    };
  }, [projectId]);
  const page = current?.page;
  return (
    <section aria-label="已保存视觉历史版本">
      <h3>已保存视觉历史版本</h3>
      <Button
        disabled={current?.state === "loading" || current?.more}
        onClick={() => void read(null)}
      >
        刷新历史目录
      </Button>
      {!current || current.state === "loading" ? (
        <p role="status">正在读取此作品历史…</p>
      ) : current.state === "empty" ? (
        <p>此作品尚无已保存视觉版本。</p>
      ) : null}
      {current?.error && <p role="status">{current.error}</p>}
      <p>
        这里只显示保存记录和批准指针；原文件、权利和批准有效性在打开后单独核对。浏览不会丢弃输入或执行写入。
      </p>
      <ul>
        {page?.items.map((item) => (
          <li key={item.id}>
            <Button
              disabled={locked || selectedId === item.id}
              onClick={() => void select(item.id, item)}
            >
              打开视觉 v{item.version_number} · {item.change_summary}
            </Button>
            <p>
              {item.id} · {item.content_hash.slice(0, 19)} · {item.created_at}
            </p>
            <p>
              变更理由：{item.change_reason}；来源设定：{item.creative_library_version_id}
            </p>
            {page.head.latest_version_id === item.id && <span>最新保存记录 · </span>}
            {page.head.review_version_id === item.id && <span>在审指针 · </span>}
            {page.head.accepted_version_id === item.id && <span>批准指针（有效性另行核对）</span>}
          </li>
        ))}
      </ul>
      {page?.next_cursor && (
        <Button
          disabled={current?.more || current?.state === "loading"}
          onClick={() => void read(page.next_cursor)}
        >
          读取更早版本
        </Button>
      )}
    </section>
  );
}
