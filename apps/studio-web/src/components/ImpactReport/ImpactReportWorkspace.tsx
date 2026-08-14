import { useCallback, useEffect, useRef, useState } from "react";

import type {
  InvalidationOperationDetailResponse,
  InvalidationOperationListResponse,
  ProjectData,
} from "../../api/studio";
import {
  defaultSelectedOperationId,
  eventTimeFlagLabels,
  formatEventTime,
  impactIcon,
  impactLabel,
  impactTone,
  isZeroImpact,
  type ImpactKind,
  type OperationSummary,
  type ReportDetailState,
  type ReportListState,
} from "./impact-report-model";
import "./impact-report.css";

interface ImpactReportWorkspaceProps {
  project: ProjectData;
  listOperations(projectId: string): Promise<InvalidationOperationListResponse>;
  getOperation(
    projectId: string,
    operationId: string,
  ): Promise<InvalidationOperationDetailResponse>;
}

function ImpactBadge({ impact }: { impact: ImpactKind | null }) {
  return (
    <span className="impact-badge" data-tone={impactTone(impact)}>
      <span aria-hidden="true">{impactIcon(impact)}</span>
      {impactLabel(impact)}
    </span>
  );
}

function OperationCard({
  operation,
  selected,
  onSelect,
}: {
  operation: OperationSummary;
  selected: boolean;
  onSelect: (operationId: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`impact-operation-card${selected ? " selected" : ""}`}
        aria-pressed={selected}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(operation.operation_id)}
      >
        <div className="impact-operation-top">
          <time dateTime={operation.created_at}>{formatEventTime(operation.created_at)}</time>
          <ImpactBadge impact={operation.strongest_effective_impact} />
        </div>
        <div className="impact-id-block">
          <span>操作 ID</span>
          <code>{operation.operation_id}</code>
        </div>
        <div className="impact-id-block">
          <span>变更产物 · 旧接受版 → 新接受版</span>
          <code>{operation.changed_artifact_id}</code>
          <code>
            {operation.old_accepted_version_id} → {operation.new_accepted_version_id}
          </code>
        </div>
        <div className="impact-id-block">
          <span>Gate 决策</span>
          <code>{operation.gate_decision_id}</code>
        </div>
        <dl className="impact-counts" aria-label="事件时影响计数">
          <div>
            <dt>受影响版本</dt>
            <dd>{operation.affected_version_count}</dd>
          </div>
          <div>
            <dt>独立路径</dt>
            <dd>{operation.independent_path_count}</dd>
          </div>
          <div>
            <dt>最强影响</dt>
            <dd>{impactLabel(operation.strongest_effective_impact)}</dd>
          </div>
        </dl>
        <dl className="impact-counts" aria-label="影响分型计数">
          <div>
            <dt>阻断</dt>
            <dd>{operation.impact_counts.blocking}</dd>
          </div>
          <div>
            <dt>仅渲染</dt>
            <dd>{operation.impact_counts.render_only}</dd>
          </div>
          <div>
            <dt>提示</dt>
            <dd>{operation.impact_counts.advisory}</dd>
          </div>
        </dl>
      </button>
    </li>
  );
}

export function ImpactReportWorkspace({
  project,
  listOperations,
  getOperation,
}: ImpactReportWorkspaceProps) {
  const [listState, setListState] = useState<ReportListState>({ kind: "loading" });
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [detailState, setDetailState] = useState<ReportDetailState>({ kind: "idle" });
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const reloadList = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    detailRequestRef.current += 1;
    setListState({ kind: "loading" });
    setDetailState({ kind: "idle" });
    setSelectedOperationId(null);
    try {
      const response = await listOperations(project.id);
      if (listRequestRef.current !== requestId) return;
      setListState({ kind: "ready", response });
      setSelectedOperationId(defaultSelectedOperationId(response.data.operations));
    } catch {
      if (listRequestRef.current !== requestId) return;
      setListState({ kind: "error" });
      setSelectedOperationId(null);
    }
  }, [listOperations, project.id]);

  useEffect(() => {
    void reloadList();
    return () => {
      listRequestRef.current += 1;
      detailRequestRef.current += 1;
    };
  }, [reloadList]);

  useEffect(() => {
    if (selectedOperationId === null) {
      setDetailState({ kind: "idle" });
      return;
    }
    const operationId = selectedOperationId;
    const requestId = ++detailRequestRef.current;
    setDetailState({ kind: "loading", operationId });
    void getOperation(project.id, operationId)
      .then((response) => {
        if (detailRequestRef.current !== requestId) return;
        setDetailState({ kind: "ready", response });
      })
      .catch(() => {
        if (detailRequestRef.current !== requestId) return;
        setDetailState({ kind: "error", operationId });
      });
  }, [detailReloadToken, getOperation, project.id, selectedOperationId]);

  const selectedSummary =
    listState.kind === "ready"
      ? (listState.response.data.operations.find(
          (operation) => operation.operation_id === selectedOperationId,
        ) ?? null)
      : null;

  return (
    <section className="impact-report-workspace" aria-labelledby="impact-report-title">
      <header className="impact-hero">
        <span className="eyebrow">EVENT-TIME EVIDENCE</span>
        <h2 id="impact-report-title">影响报告</h2>
        <p>
          <strong>{project.name}</strong>
          {" · "}
          记录每一次接受头替换在事件当时冻结的下游影响。这是历史证据，不是当前实时可用性。
        </p>
        <div className="impact-event-notice" role="note">
          <strong>事件时证据（非实时状态）</strong>
          <span>
            本视图只展示 T04 账本中已冻结的替换结果。它不会调用实时评估、不会修改任务队列，也不表示任何产物现已修复或可消费。
          </span>
        </div>
      </header>

      {listState.kind === "loading" && (
        <div className="impact-state" role="status" aria-live="polite">
          <span className="impact-loader" aria-hidden="true" />
          <div>
            <strong>正在读取影响历史…</strong>
            <p>项目仍可安全留在当前页面。</p>
          </div>
        </div>
      )}

      {listState.kind === "error" && (
        <div className="impact-state impact-error" role="alert">
          <div>
            <strong>影响报告暂时无法读取</strong>
            <p>{project.name} 没有被修改；恢复连接后可继续查看历史证据。</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => void reloadList()}>
            重新读取
          </button>
        </div>
      )}

      {listState.kind === "ready" && listState.response.data.operations.length === 0 && (
        <div className="impact-empty">
          <span aria-hidden="true">◎</span>
          <h3>还没有影响记录</h3>
          <p>当某次接受头替换被写入失效账本后，历史影响会出现在这里。</p>
        </div>
      )}

      {listState.kind === "ready" && listState.response.data.operations.length > 0 && (
        <div className="impact-layout">
          <div className="impact-list">
            <div className="impact-list-header">
              <h3>替换事件</h3>
              <span>{listState.response.data.operations.length} 条 · 最新在底部默认选中</span>
            </div>
            <ul className="impact-operation-list" aria-label="失效操作列表">
              {listState.response.data.operations.map((operation) => (
                <OperationCard
                  key={operation.operation_id}
                  operation={operation}
                  selected={operation.operation_id === selectedOperationId}
                  onSelect={setSelectedOperationId}
                />
              ))}
            </ul>
          </div>

          <div className="impact-detail" aria-live="polite">
            {detailState.kind === "loading" && (
              <div className="impact-state" role="status">
                <span className="impact-loader" aria-hidden="true" />
                <div>
                  <strong>正在读取事件详情…</strong>
                  <p>正在加载操作 {detailState.operationId}</p>
                </div>
              </div>
            )}

            {detailState.kind === "error" && (
              <div className="impact-state impact-error" role="alert">
                <div>
                  <strong>事件详情暂时无法读取</strong>
                  <p>操作 {detailState.operationId} 的冻结证据未能加载。</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDetailReloadToken((token) => token + 1)}
                >
                  重新读取
                </button>
              </div>
            )}

            {detailState.kind === "ready" && selectedSummary && (
              <>
                <div className="impact-event-notice" role="note">
                  <strong>所选事件是冻结快照</strong>
                  <span>
                    以下内容描述 {formatEventTime(selectedSummary.created_at)}{" "}
                    那次接受头替换当时的影响，不是这些版本的当前实时状态。
                  </span>
                </div>

                <section className="impact-section" aria-labelledby="impact-summary-heading">
                  <h3 id="impact-summary-heading">事件摘要</h3>
                  <dl className="impact-summary-grid" aria-label="事件计数摘要">
                    <div>
                      <dt>受影响版本</dt>
                      <dd>{selectedSummary.affected_version_count}</dd>
                    </div>
                    <div>
                      <dt>独立路径</dt>
                      <dd>{selectedSummary.independent_path_count}</dd>
                    </div>
                    <div>
                      <dt>阻断 / 仅渲染 / 提示</dt>
                      <dd>
                        {selectedSummary.impact_counts.blocking} /{" "}
                        {selectedSummary.impact_counts.render_only} /{" "}
                        {selectedSummary.impact_counts.advisory}
                      </dd>
                    </div>
                    <div>
                      <dt>最强有效影响</dt>
                      <dd>
                        <ImpactBadge impact={selectedSummary.strongest_effective_impact} />
                      </dd>
                    </div>
                  </dl>
                  <dl className="impact-meta-list">
                    <div>
                      <dt>操作 ID</dt>
                      <dd>{selectedSummary.operation_id}</dd>
                    </div>
                    <div>
                      <dt>变更产物</dt>
                      <dd>{selectedSummary.changed_artifact_id}</dd>
                    </div>
                    <div>
                      <dt>旧接受版本 → 新接受版本</dt>
                      <dd>
                        {selectedSummary.old_accepted_version_id} →{" "}
                        {selectedSummary.new_accepted_version_id}
                      </dd>
                    </div>
                    <div>
                      <dt>Gate 决策 ID</dt>
                      <dd>{selectedSummary.gate_decision_id}</dd>
                    </div>
                    <div>
                      <dt>事件时间</dt>
                      <dd>{formatEventTime(selectedSummary.created_at)}</dd>
                    </div>
                  </dl>
                </section>

                {isZeroImpact(selectedSummary) ? (
                  <div className="impact-zero-note">
                    该次接受头替换在事件当时没有独立下游路径，受影响版本数与路径数均为 0。这是有效的“无影响”结果，不是加载失败。
                  </div>
                ) : (
                  <section className="impact-section" aria-labelledby="impact-versions-heading">
                    <h3 id="impact-versions-heading">受影响精确版本</h3>
                    <p>不同版本即使属于同一产物也分别列出；路径按 path_ordinal 升序展示。</p>
                    <ul className="impact-version-list">
                      {detailState.response.data.affected_versions.map((group) => (
                        <li
                          key={`${group.affected_artifact_id}:${group.affected_version_id}`}
                          className="impact-version-card"
                        >
                          <div className="impact-version-header">
                            <div className="impact-id-block">
                              <span>受影响产物 / 版本</span>
                              <code>{group.affected_artifact_id}</code>
                              <code>{group.affected_version_id}</code>
                            </div>
                            <ImpactBadge impact={group.strongest_effective_impact} />
                          </div>
                          <ul className="impact-flag-list" aria-label="事件时标志">
                            {eventTimeFlagLabels(group).map((label) => (
                              <li key={label}>{label}</li>
                            ))}
                          </ul>
                          <ul className="impact-path-list" aria-label="独立路径">
                            {group.paths.map((path) => (
                              <li key={path.impact_id} className="impact-path-card">
                                <div className="impact-path-header">
                                  <div className="impact-id-block">
                                    <span>
                                      路径序号 {path.path_ordinal} · 影响 ID {path.impact_id}
                                    </span>
                                    <code>有效影响：{impactLabel(path.effective_impact)}</code>
                                  </div>
                                  <ImpactBadge impact={path.effective_impact} />
                                </div>
                                <div className="impact-chain">
                                  <strong>依赖 ID 链 · 关系 · 边影响</strong>
                                  <ol>
                                    {path.dependency_path.map((dependencyId, index) => (
                                      <li key={`${path.impact_id}:${dependencyId}:${index}`}>
                                        <strong>边 {index + 1}</strong>
                                        <code>{dependencyId}</code>
                                        <div className="impact-edge-row">
                                          <span>关系 {path.path_relationships[index]}</span>
                                          <ImpactBadge impact={path.path_impacts[index]!} />
                                        </div>
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
