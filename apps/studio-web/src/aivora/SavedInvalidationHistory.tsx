import { useEffect, useRef } from "react";
import { Button } from "./Common";
import { InvalidationConsumerInspector } from "./InvalidationConsumerInspector";
import { VisualApprovalCauseInspector } from "./VisualApprovalCauseInspector";
import type {
  InvalidationHistoryController,
  InvalidationHistoryState,
} from "../domain/invalidation-history-controller";

/** The saved approval replacement graph is one read-only source shared by both UI entry points. */
export function SavedInvalidationHistory({
  projectId,
  history,
  controller,
}: {
  projectId: string | null;
  history: InvalidationHistoryState;
  controller: InvalidationHistoryController;
}) {
  const rows = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!history.selectedOperationId && history.lastSelectedOperationId)
      rows.current.get(history.lastSelectedOperationId)?.focus();
  }, [history.lastSelectedOperationId, history.selectedOperationId]);
  if (!projectId) return <p className="v2-media-muted">尚未连接本地项目，无法读取真实影响报告。</p>;
  if (history.projectId !== projectId)
    return <p role="status">正在读取此作品影响报告；其他作品的内容不在此显示。</p>;
  const detail = history.operation;
  const validList = history.items.every((item) => item.project_id === projectId);
  const validDetail =
    detail?.project_id === projectId &&
    detail.operation_id === history.selectedOperationId &&
    Array.isArray(detail.paths) &&
    detail.paths.every(
      (path) => path.project_id === projectId && path.operation_id === detail.operation_id,
    );
  if (history.detail !== "idle") {
    const operationId = history.selectedOperationId!;
    return (
      <div className="v2-invalidation-detail" aria-label="影响报告详情">
        <Button onClick={() => controller.backToList()}>返回影响报告</Button>
        {history.detail === "loading" && <p role="status">正在读取报告详情…</p>}
        {history.detail === "error" && (
          <div role="alert">
            <p>{history.detailError}</p>
            <Button onClick={() => void controller.select(operationId)}>重新读取报告</Button>
          </div>
        )}
        {history.detail === "ready" && !validDetail && (
          <div role="alert">
            <p>报告作用域未通过核对，原选择保留。请重新读取此作品报告。</p>
            <Button
              onClick={() => {
                controller.backToList();
                void controller.select(operationId);
              }}
            >
              重新核对此报告
            </Button>
          </div>
        )}
        {history.detail === "ready" && validDetail && (
          <>
            <p>报告编号 · {detail!.operation_id}</p>
            <p>
              批准替代：{detail!.old_accepted_version_id} → {detail!.new_accepted_version_id}
            </p>
            <p>
              人工决定 {detail!.gate_decision_id} · 影响核对 hash {detail!.assessment_hash}
            </p>
            <p>原引用和历史版本保留。以下影响需要人工复核；读取报告不执行修改、生成或费用。</p>
            <VisualApprovalCauseInspector
              key={`${projectId}/${detail!.operation_id}/${detail!.assessment_hash}`}
              projectId={projectId}
              artifactId={detail!.changed_artifact_id}
              oldVersionId={detail!.old_accepted_version_id}
              newVersionId={detail!.new_accepted_version_id}
            />
            {detail!.paths.length === 0 ? (
              <p>本次没有下游影响路径</p>
            ) : (
              <ul>
                {detail!.paths.map((path) => (
                  <li key={path.path_id}>
                    影响类别：{path.classification} · 影响结果：{path.effective_impact} · 关联产物：
                    {path.affected_artifact_id}
                    <p>
                      精确受影响版本：{path.affected_version_id} · 整体影响：{path.aggregate_impact}
                    </p>
                    <InvalidationConsumerInspector
                      key={`${projectId}/${detail!.operation_id}/${path.path_id}/${detail!.assessment_hash}`}
                      identity={{
                        project_id: projectId,
                        operation_id: detail!.operation_id,
                        path_id: path.path_id,
                        assessment_hash: detail!.assessment_hash,
                        artifact_id: path.affected_artifact_id,
                        version_id: path.affected_version_id,
                      }}
                    />
                    <details>
                      <summary>查看依赖传播路径</summary>
                      <p>依赖：{path.dependency_ids.join(" → ")}</p>
                      <p>
                        关系：{path.relationships.join(" → ")}；各边影响：
                        {path.edge_impacts.join(" → ")}
                      </p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="v2-invalidation-history" aria-label="影响报告">
      <Button
        disabled={history.list === "loading" || history.more === "loading"}
        onClick={() => void controller.loadInitial()}
      >
        刷新批准替代影响报告
      </Button>
      {history.list === "loading" && <p role="status">正在读取影响报告…</p>}
      {history.list === "error" && (
        <div role="alert">
          <p>{history.listError}</p>
          <Button onClick={() => void controller.loadInitial()}>重新读取</Button>
        </div>
      )}
      {history.list === "ready" && !validList && (
        <p role="alert">报告列表作用域未通过核对，请重新读取。不能据此认定没有影响。</p>
      )}
      {history.list === "ready" && validList && history.items.length === 0 && <p>暂无影响报告</p>}
      {history.items
        .filter(() => validList)
        .map((item) => (
          <button
            key={item.operation_id}
            ref={(element) => {
              if (element) rows.current.set(item.operation_id, element);
              else rows.current.delete(item.operation_id);
            }}
            onClick={() => void controller.select(item.operation_id)}
          >
            内容版本发生变更 · {item.reason_path_count} 条影响路径
          </button>
        ))}
      {history.more === "error" && (
        <div role="alert">
          <p>{history.moreError}</p>
          <Button onClick={() => void controller.loadMore()}>重新加载更多</Button>
        </div>
      )}
      {history.nextCursor !== null && history.more !== "error" && (
        <Button disabled={history.more === "loading"} onClick={() => void controller.loadMore()}>
          {history.more === "loading" ? "正在读取…" : "加载更多"}
        </Button>
      )}
    </div>
  );
}
