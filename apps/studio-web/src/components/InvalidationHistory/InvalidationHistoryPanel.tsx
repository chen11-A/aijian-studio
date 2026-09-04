import { useCallback, useEffect, useRef, useState } from "react";

import type {
  InvalidationOperationPageQuery,
  InvalidationOperationPageResponse,
  InvalidationOperationResponse,
  ProjectData,
} from "../../api/studio";

import "./invalidation-history.css";

type OperationSummary = InvalidationOperationPageResponse["data"]["items"][number];
type OperationDetail = InvalidationOperationResponse["data"];
type DetailState =
  | { kind: "idle" }
  | { kind: "loading"; operationId: string }
  | { kind: "ready"; operation: OperationDetail }
  | { kind: "error"; operationId: string; message: string };

export interface InvalidationHistoryPanelProps {
  project: ProjectData;
  listOperations(
    projectId: string,
    query?: InvalidationOperationPageQuery,
  ): Promise<InvalidationOperationPageResponse>;
  getOperation(projectId: string, operationId: string): Promise<InvalidationOperationResponse>;
}

const PAGE_LIMIT = 20;

function shortId(value: string): string {
  return `${value.slice(0, 14)}…${value.slice(-6)}`;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "读取影响报告时发生未知错误";
}

function classificationLabel(value: string): string {
  return value === "INVALIDATE" ? "失效" : "待复核";
}

function impactLabel(value: string): string {
  if (value === "blocking") return "阻塞下游";
  if (value === "advisory") return "建议复核";
  return "仅重新渲染";
}

export function InvalidationHistoryPanel({
  project,
  listOperations,
  getOperation,
}: InvalidationHistoryPanelProps) {
  const [items, setItems] = useState<readonly OperationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [initialState, setInitialState] = useState<"loading" | "ready" | "error">("loading");
  const [initialError, setInitialError] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({ kind: "idle" });
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const detailTitleRef = useRef<HTMLHeadingElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedOperationId =
    detail.kind === "idle"
      ? null
      : detail.kind === "ready"
        ? detail.operation.operation_id
        : detail.operationId;

  const loadInitial = useCallback(async () => {
    const generation = ++listGeneration.current;
    setInitialState("loading");
    setInitialError(null);
    setMoreError(null);
    try {
      const response = await listOperations(project.id, { limit: PAGE_LIMIT });
      if (listGeneration.current !== generation) return;
      setItems(response.data.items);
      setNextCursor(response.data.next_cursor);
      setInitialState("ready");
    } catch (error) {
      if (listGeneration.current !== generation) return;
      setInitialError(messageFor(error));
      setInitialState("error");
    }
  }, [listOperations, project.id]);

  useEffect(() => {
    void loadInitial();
    return () => {
      listGeneration.current += 1;
      detailGeneration.current += 1;
    };
  }, [loadInitial]);

  useEffect(() => {
    if (detail.kind !== "idle") {
      globalThis.requestAnimationFrame(() => detailTitleRef.current?.focus());
    }
  }, [detail]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor;
    if (cursor === null || moreLoading) return;
    const generation = ++listGeneration.current;
    setMoreLoading(true);
    setMoreError(null);
    try {
      const response = await listOperations(project.id, { limit: PAGE_LIMIT, cursor });
      if (listGeneration.current !== generation) return;
      setItems((current) => [...current, ...response.data.items]);
      setNextCursor(response.data.next_cursor);
    } catch (error) {
      if (listGeneration.current !== generation) return;
      setMoreError(messageFor(error));
    } finally {
      if (listGeneration.current === generation) setMoreLoading(false);
    }
  }, [listOperations, moreLoading, nextCursor, project.id]);

  const loadDetail = useCallback(
    async (operationId: string) => {
      const generation = ++detailGeneration.current;
      setDetail({ kind: "loading", operationId });
      try {
        const response = await getOperation(project.id, operationId);
        if (detailGeneration.current !== generation) return;
        setDetail({ kind: "ready", operation: response.data });
      } catch (error) {
        if (detailGeneration.current !== generation) return;
        setDetail({ kind: "error", operationId, message: messageFor(error) });
      }
    },
    [getOperation, project.id],
  );

  const returnToList = () => {
    const operationId = selectedOperationId;
    detailGeneration.current += 1;
    setDetail({ kind: "idle" });
    if (operationId)
      globalThis.requestAnimationFrame(() => rowRefs.current.get(operationId)?.focus());
  };

  return (
    <section className="invalidation-history" aria-label="影响报告">
      <div
        className={detail.kind === "idle" ? "history-list" : "history-list history-list-has-detail"}
      >
        <header className="history-list-heading">
          <span>影响报告</span>
          <small>已批准版本变更的下游影响记录</small>
        </header>
        {initialState === "loading" && <p role="status">正在读取影响报告…</p>}
        {initialState === "error" && (
          <div className="history-state history-error" role="alert">
            <p>{initialError}</p>
            <button type="button" onClick={() => void loadInitial()}>
              重新读取
            </button>
          </div>
        )}
        {initialState === "ready" && items.length === 0 && (
          <div className="history-state">
            <strong>暂无影响报告</strong>
            <p>仅在已批准版本变更影响下游时生成。</p>
          </div>
        )}
        {items.length > 0 && (
          <div className="history-operation-list" aria-label="影响报告历史">
            {items.map((item) => (
              <button
                className={
                  item.operation_id === selectedOperationId
                    ? "history-operation selected"
                    : "history-operation"
                }
                type="button"
                aria-pressed={item.operation_id === selectedOperationId}
                key={item.operation_id}
                ref={(element) => {
                  if (element) rowRefs.current.set(item.operation_id, element);
                  else rowRefs.current.delete(item.operation_id);
                }}
                onClick={() => void loadDetail(item.operation_id)}
              >
                <time dateTime={item.created_at}>{item.created_at.replace("T", " ")}</time>
                <strong>内容版本发生变更</strong>
                <span title={item.changed_artifact_id}>
                  Artifact · {shortId(item.changed_artifact_id)}
                </span>
                <small>{item.reason_path_count} 条影响路径</small>
              </button>
            ))}
          </div>
        )}
        {moreError && (
          <div className="history-pagination-error" role="alert">
            <span>{moreError}</span>
            <button type="button" onClick={() => void loadMore()} disabled={moreLoading}>
              重新加载更多
            </button>
          </div>
        )}
        {nextCursor !== null && !moreError && (
          <button
            className="history-more"
            type="button"
            onClick={() => void loadMore()}
            disabled={moreLoading}
          >
            {moreLoading ? "正在读取…" : "加载更多"}
          </button>
        )}
      </div>

      {detail.kind === "idle" ? (
        <section className="history-detail history-detail-idle" aria-label="影响报告详情">
          <p>选择一条报告查看影响原因</p>
        </section>
      ) : (
        <section className="history-detail" aria-live="polite" aria-label="影响报告详情">
          <button className="history-mobile-back" type="button" onClick={returnToList}>
            返回影响报告
          </button>
          <header className="history-detail-heading">
            <span>版本影响详情</span>
            <h3 ref={detailTitleRef} tabIndex={-1}>
              {detail.kind === "ready"
                ? shortId(detail.operation.changed_artifact_id)
                : "影响报告详情"}
            </h3>
          </header>
          {detail.kind === "loading" && <p role="status">正在读取报告详情…</p>}
          {detail.kind === "error" && (
            <div className="history-state history-error" role="alert">
              <p>{detail.message}</p>
              <button type="button" onClick={() => void loadDetail(detail.operationId)}>
                重新读取报告
              </button>
            </div>
          )}
          {detail.kind === "ready" && (
            <>
              {detail.operation.paths.length === 0 ? (
                <p className="history-state">本次没有下游影响路径</p>
              ) : (
                <div className="history-paths">
                  {detail.operation.paths.map((path) => (
                    <article className="history-path" key={path.path_id}>
                      <header>
                        <span>{classificationLabel(path.classification)}</span>
                        <strong>{impactLabel(path.effective_impact)}</strong>
                      </header>
                      <p>
                        受影响 Artifact{" "}
                        <code title={path.affected_artifact_id}>
                          {shortId(path.affected_artifact_id)}
                        </code>
                      </p>
                      <p>
                        受影响 Version{" "}
                        <code title={path.affected_version_id}>
                          {shortId(path.affected_version_id)}
                        </code>
                      </p>
                      <ol className="history-reasons">
                        {path.dependency_ids.map((dependencyId, index) => (
                          <li key={`${path.path_id}:${dependencyId}`}>
                            <code title={dependencyId}>{shortId(dependencyId)}</code>
                            <span>{path.relationships[index]}</span>
                            <em>{impactLabel(path.edge_impacts[index]!)}</em>
                          </li>
                        ))}
                      </ol>
                    </article>
                  ))}
                </div>
              )}
              <details className="history-technical-details">
                <summary>技术详情</summary>
                <dl>
                  <div>
                    <dt>Operation</dt>
                    <dd title={detail.operation.operation_id}>{detail.operation.operation_id}</dd>
                  </div>
                  <div>
                    <dt>Gate</dt>
                    <dd title={detail.operation.gate_decision_id}>
                      {detail.operation.gate_decision_id}
                    </dd>
                  </div>
                  <div>
                    <dt>旧版本</dt>
                    <dd title={detail.operation.old_accepted_version_id}>
                      {detail.operation.old_accepted_version_id}
                    </dd>
                  </div>
                  <div>
                    <dt>新版本</dt>
                    <dd title={detail.operation.new_accepted_version_id}>
                      {detail.operation.new_accepted_version_id}
                    </dd>
                  </div>
                  <div>
                    <dt>Assessment</dt>
                    <dd title={detail.operation.assessment_hash}>
                      {detail.operation.assessment_hash}
                    </dd>
                  </div>
                </dl>
              </details>
            </>
          )}
        </section>
      )}
    </section>
  );
}
