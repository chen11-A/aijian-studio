import { useEffect, useMemo, useRef, useState } from "react";
import {
  impactPage,
  impactReport,
  verifyImpactHash,
  type ScriptImpactGateway,
  type ScriptImpactPage,
  type ScriptImpactReport,
} from "@aijian/contracts/script-confirmation-impact";
import { createStudioTransport } from "../api/studio";
import { Button } from "./Common";

/** All entries read the same immutable source facts; no editor state is changed. */
export function ScriptConfirmationImpactHistory({
  projectId,
  episodeId,
  assemblyTarget,
  gateway: supplied,
}: {
  projectId: string | null;
  episodeId?: string;
  assemblyTarget?: { episode_id: string; version_id: string; content_hash: string };
  gateway?: Partial<ScriptImpactGateway>;
}) {
  const gateway = useMemo(() => supplied ?? createStudioTransport(), [supplied]);
  const sourceEpisode = assemblyTarget ? undefined : episodeId;
  const epoch = useRef(0);
  const scope = `${projectId ?? ""}/${episodeId ?? ""}/${assemblyTarget?.episode_id ?? ""}/${assemblyTarget?.version_id ?? ""}/${assemblyTarget?.content_hash ?? ""}`;
  const [page, setPage] = useState<ScriptImpactPage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<ScriptImpactReport | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const activeScope = useRef(scope);
  activeScope.current = scope;
  async function load(cursor?: string) {
    if (!projectId || !gateway.listScriptConfirmationImpacts) return;
    const request = ++epoch.current,
      requestedScope = scope;
    setState("loading");
    setSelected(null);
    setReport(null);
    let result;
    try {
      result = await gateway.listScriptConfirmationImpacts(projectId, cursor);
    } catch {
      result = null;
    }
    if (request !== epoch.current || requestedScope !== activeScope.current) return;
    if (result?.kind !== "FOUND" || !impactPage(result.receipt.data, projectId)) {
      setState("error");
      return;
    }
    const next = result.receipt.data;
    if (
      cursor &&
      (next.next_cursor === cursor ||
        next.items.some((item) => page?.items.some((prior) => prior.report_id === item.report_id)))
    ) {
      setState("error");
      return;
    }
    setPage((old) =>
      cursor && old?.project_id === projectId
        ? {
            ...next,
            items: [
              ...old.items,
              ...next.items.filter(
                (item) => !old.items.some((prior) => prior.report_id === item.report_id),
              ),
            ],
          }
        : next,
    );
    setState("ready");
  }
  useEffect(() => {
    ++epoch.current;
    setPage(null);
    setSelected(null);
    setReport(null);
    setState("idle");
    void load();
    return () => {
      ++epoch.current;
    };
    // The gateway and exact scope own one generation, including A → B → A.
  }, [scope, gateway]);
  async function detail(reportId: string) {
    if (!projectId || !gateway.getScriptConfirmationImpact || page?.project_id !== projectId)
      return;
    const summary = page.items.find((item) => item.report_id === reportId);
    if (!summary || (sourceEpisode && summary.episode_id !== sourceEpisode)) return;
    const request = ++epoch.current,
      requestedScope = scope;
    setSelected(reportId);
    setReport(null);
    setState("loading");
    let result;
    try {
      result = await gateway.getScriptConfirmationImpact(projectId, reportId);
    } catch {
      result = null;
    }
    if (request !== epoch.current || requestedScope !== activeScope.current) return;
    if (result?.kind !== "FOUND" || !impactReport(result.receipt.data, projectId)) {
      setState("error");
      return;
    }
    const value = result.receipt.data,
      a = value.assessment;
    const verified = await verifyImpactHash(value);
    if (request !== epoch.current || requestedScope !== activeScope.current) return;
    if (!verified) {
      setState("error");
      return;
    }
    if (
      value.report_id !== reportId ||
      value.assessment_hash !== summary.assessment_hash ||
      a.episode_id !== summary.episode_id ||
      a.new_confirmation.confirmation_id !== summary.new_confirmation_id ||
      a.new_confirmation.version_id !== summary.new_version_id ||
      (a.old_confirmation?.confirmation_id ?? null) !== summary.old_confirmation_id ||
      (a.old_confirmation?.version_id ?? null) !== summary.old_version_id ||
      a.event_kind !== summary.event_kind ||
      value.created_at !== summary.created_at ||
      a.targets.length !== summary.target_count ||
      a.targets.reduce((count, t) => count + t.reasons.length, 0) !== summary.reason_path_count ||
      a.targets.reduce(
        (count, t) => count + (t.context.kind === "ASSEMBLY" ? t.context.segments.length : 0),
        0,
      ) !== summary.segment_count
    ) {
      setState("error");
      return;
    }
    setReport(value);
    setState("ready");
  }
  if (!projectId) return <p>请先选择真实作品，再读取剧本确认影响。</p>;
  if (!gateway.listScriptConfirmationImpacts || !gateway.getScriptConfirmationImpact)
    return <p>当前桌面版本缺少剧本确认影响读取接口。</p>;
  const visible =
    page?.project_id === projectId
      ? page.items.filter((item) => !sourceEpisode || item.episode_id === sourceEpisode)
      : [];
  const validReport =
    report?.assessment.project_id === projectId &&
    report.report_id === selected &&
    (!sourceEpisode || report.assessment.episode_id === sourceEpisode);
  return (
    <section aria-label="剧本确认替代持久影响">
      <h3>剧本确认替代与原引用</h3>
      <p>
        已保存的人工确认来源事实。请在本集装配中显式重新绑定并另存；报告读取保留当前未保存输入。
      </p>
      {assemblyTarget && (
        <p>
          读取作品全部来源分集的影响历史；详情按本集保存版本 {assemblyTarget.version_id} 和 hash{" "}
          {assemblyTarget.content_hash} 精确标记。没有匹配报告不等于前置审核通过。
        </p>
      )}
      <Button disabled={state === "loading"} onClick={() => void load()}>
        刷新剧本确认影响
      </Button>
      {state === "loading" && <p role="status">正在核对确认影响…</p>}
      {state === "error" && (
        <p role="alert">
          确认影响无法核实，原报告选择保留。
          <Button onClick={() => (selected ? void detail(selected) : void load())}>
            重新只读核对
          </Button>
        </p>
      )}
      {selected ? (
        <>
          <Button
            onClick={() => {
              ++epoch.current;
              setSelected(null);
              setReport(null);
              setState("ready");
            }}
          >
            返回剧本确认影响列表
          </Button>
          {state === "ready" && validReport && (
            <>
              <p>
                报告 {report.report_id} · 分集 {report.assessment.episode_id} · hash{" "}
                {report.assessment_hash}
              </p>
              <p>
                确认 {report.assessment.old_confirmation?.confirmation_id ?? "首次确认"} →{" "}
                {report.assessment.new_confirmation.confirmation_id}
              </p>
              <p>
                来源 {report.assessment.old_confirmation?.version_id ?? "无旧来源"} →{" "}
                {report.assessment.new_confirmation.version_id}
              </p>
              {!report.assessment.targets.length && <p>本次没有来源替代的下游影响。</p>}
              {assemblyTarget &&
                !report.assessment.targets.some(
                  (target) =>
                    target.artifact_type === "episode_media_assembly" &&
                    target.episode_id === assemblyTarget.episode_id &&
                    target.version_id === assemblyTarget.version_id &&
                    target.content_hash === assemblyTarget.content_hash,
                ) && (
                  <p>
                    本报告没有与所选保存版本和 hash
                    完全一致的装配目标；其他版本影响仍保留，不能据此签发。
                  </p>
                )}
              <ul>
                {report.assessment.targets.map((target) => (
                  <li key={target.version_id}>
                    {assemblyTarget &&
                      target.artifact_type === "episode_media_assembly" &&
                      target.episode_id === assemblyTarget.episode_id &&
                      target.version_id === assemblyTarget.version_id &&
                      target.content_hash === assemblyTarget.content_hash && (
                        <p>精确匹配本集所选保存装配及 hash</p>
                      )}
                    <p>
                      {target.classification} · {target.artifact_type} · 分集{" "}
                      {target.episode_id ?? "作品共享"}
                    </p>
                    <p>
                      原版本 {target.version_id} · 原 hash {target.content_hash}
                    </p>
                    {target.context.kind === "ASSEMBLY" && (
                      <>
                        <p>
                          保存帧率 {target.context.sequence_timebase.frame_rate.num}/
                          {target.context.sequence_timebase.frame_rate.den} ·{" "}
                          {target.context.sequence_timebase.timecode_mode}
                        </p>
                        <ul>
                          {target.context.segments.map((item) => (
                            <li key={item.segment.segment_id}>
                              {item.kind} · {item.segment.segment_id} · 帧 [
                              {item.segment.start_frame}, {item.segment.end_frame})
                              <details>
                                <summary>原脚本块、媒体与帧范围</summary>
                                <pre>{JSON.stringify(item, null, 2)}</pre>
                              </details>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <details>
                      <summary>精确镜头与全部影响理由</summary>
                      <pre>
                        {JSON.stringify(
                          { context: target.context, reasons: target.reasons },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <>
          {state === "ready" && !visible.length && (
            <p>
              {page?.next_cursor && sourceEpisode
                ? "当前已读取页面暂无本分集报告，请继续读取。"
                : "当前范围暂无确认替代报告。"}
            </p>
          )}
          <ul>
            {visible.map((item) => (
              <li key={item.report_id}>
                <Button onClick={() => void detail(item.report_id)}>
                  {item.event_kind} · 分集 {item.episode_id} · {item.target_count} 个原版本 ·{" "}
                  {item.segment_count} 段原声音或字幕
                </Button>
              </li>
            ))}
          </ul>
          {!!page?.preexisting_confirmation_count && (
            <p>
              本作品有 {page.preexisting_confirmation_count}{" "}
              条迁移前确认缺少当时影响快照；原确认和历史 hash 保留。
            </p>
          )}
          {page?.next_cursor && (
            <Button disabled={state === "loading"} onClick={() => void load(page.next_cursor!)}>
              读取更多确认影响
            </Button>
          )}
        </>
      )}
    </section>
  );
}
