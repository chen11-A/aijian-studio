import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  readinessData,
  readinessTarget,
  type AssemblyReadinessData,
  type AssemblyReadinessGateway,
  type AssemblyReadinessTarget,
} from "@aijian/contracts/assembly-readiness";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import {
  parseAssemblyReceipt,
  type EpisodeMediaAssemblyGateway,
} from "./adapters/episodeMediaAssembly";
import { Button } from "./Common";

type Props = {
  projectId: string;
  episodeId: string;
  gateway?: Partial<AssemblyReadinessGateway>;
  assembly?: EpisodeMediaAssemblyGateway;
  target?: AssemblyReadinessTarget | null;
  dirty?: boolean;
  pending?: boolean;
};
const statusLabels = {
  CURRENT: "本次来源核对通过",
  NOT_BOUND: "未绑定正式来源",
  BLOCKED: "来源已失效或未获批准",
  UNKNOWN: "无法核实",
};
const scopeLabels = {
  ASSEMBLY: "装配",
  SCRIPT: "剧本",
  STORYBOARD: "分镜／视觉批准",
  MEDIA: "素材",
  SOUND: "声音",
  SUBTITLE: "字幕",
  PICTURE_LOCK: "画面锁定",
  FINISHING: "声音与字幕母版",
  RELEASE: "正式输出",
};
const mediaKinds = { image: "图片", video: "视频", audio: "音频" };
const availabilityLabels = {
  VERIFIED: "字节已核实",
  MISSING: "文件缺失",
  CORRUPT: "字节已变更",
  UNVERIFIED_SIZE_LIMIT: "超出本次核对额度",
  UNKNOWN_UNSAFE_PATH: "原件路径无法安全读取",
  UNKNOWN_MEDIA_READ: "读取无法核实",
  UNKNOWN_MEDIA_CHANGED: "读取期间发生变化",
};
const rightsLabels = { PENDING_REVIEW: "待审核", CLEARED: "已明确", RESTRICTED: "限制使用" };
const technicalLabels = {
  STILL_HEADER_ONLY: "仅图片文件头",
  PENDING_MEDIA_PROBE: "尚无画面技术核对",
  PROBED_CFR_VIDEO: "已有固定帧率视频证据",
  INVALID_MEDIA_PROBE: "技术证据无法核实",
};

/** A fresh read of saved facts, shared by assembly/Voice/export; it has no write or approval action. */
export function AssemblyReadinessPanel(props: Props) {
  const { projectId, episodeId, gateway, assembly, target, dirty, pending } = props;
  const [latest, setLatest] = useState<AssemblyReadinessTarget | null>(null);
  const [report, setReport] = useState<{ identity: string; value: AssemblyReadinessData } | null>(
    null,
  );
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unknown" | "missing">("idle");
  const selected = target === undefined ? latest : target;
  const scope = `${projectId}/${episodeId}`;
  const identity = `${scope}/${selected?.version_id ?? ""}/${selected?.content_hash ?? ""}`;
  const live = useRef(identity);
  const epoch = useRef(0);
  if (live.current !== identity) {
    live.current = identity;
    ++epoch.current;
  }
  const request = useRef(0);
  const mounted = useRef(true);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  async function readLatest() {
    if (!assembly) return;
    const attempt = ++request.current,
      ownScope = scope;
    setState("loading");
    setReport(null);
    let result;
    try {
      result = await assembly.readLatest(projectId, episodeId);
    } catch {
      result = null;
    }
    if (!mounted.current || attempt !== request.current || ownScope !== activeScope.current) return;
    const value =
      result?.kind === "FOUND" ? parseAssemblyReceipt(result.receipt, projectId, episodeId) : null;
    if (!value) {
      if (result?.kind === "NOT_FOUND") setLatest(null);
      setState(result?.kind === "NOT_FOUND" ? "missing" : "unknown");
      return;
    }
    setLatest({ version_id: value.version_id, content_hash: value.content_hash });
    setState("idle");
  }
  // Finish invalidating the old selection before the new selection can be
  // clicked. A deferred effect could otherwise cancel that fresh request.
  useLayoutEffect(() => {
    ++request.current;
    setReport(null);
    setState("idle");
  }, [identity]);
  useEffect(() => {
    mounted.current = true;
    ++request.current;
    setReport(null);
    setLatest(null);
    setState("idle");
    if (target === undefined) void readLatest();
    return () => {
      mounted.current = false;
      ++request.current;
      ++epoch.current;
    };
  }, [scope, assembly, target === undefined]);
  async function check() {
    if (!selected || !readinessTarget(selected) || !gateway?.getEpisodeAssemblyReadiness) return;
    const attempt = ++request.current,
      generation = epoch.current,
      ownIdentity = identity;
    const current = () =>
      mounted.current &&
      attempt === request.current &&
      generation === epoch.current &&
      ownIdentity === live.current;
    setState("loading");
    setReport(null);
    let result;
    try {
      result = await gateway.getEpisodeAssemblyReadiness(projectId, episodeId, selected);
    } catch {
      result = null;
    }
    if (!current()) return;
    const receipt = result?.kind === "FOUND" ? result.receipt : null;
    if (
      !receipt ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        receipt.request_id,
      ) ||
      !readinessData(
        receipt.data,
        selected,
        (value) =>
          !!parseAssemblyReceipt(
            { data: value, request_id: receipt.request_id },
            projectId,
            episodeId,
          ),
      )
    ) {
      setState("unknown");
      return;
    }
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(impactCanonical(receipt.data.assembly.content)),
      );
      const hash = `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      if (!current()) return;
      if (hash !== selected.content_hash) {
        setState("unknown");
        return;
      }
    } catch {
      if (current()) setState("unknown");
      return;
    }
    setReport({ identity: ownIdentity, value: receipt.data });
    setState("ready");
  }
  const value = report?.identity === identity && state === "ready" ? report.value : null;
  return (
    <details className="assembly-readiness" aria-label="画面锁定与正式输出前核对">
      <summary>画面锁定与正式输出前核对</summary>
      <p>核对本集已保存装配的原件、权利、来源与缺少的审核证据。此处不签发画面锁定或正式成片。</p>
      {dirty && <p role="status">当前有未保存或未应用的编辑；本次只核对已保存版本，草稿未纳入。</p>}
      {pending && <p role="status">当前编辑或写入状态尚未就绪；只读核对不解除原写入保护。</p>}
      {selected && (
        <p>
          已选保存版本 {selected.version_id} · hash {selected.content_hash}
        </p>
      )}
      {target === undefined && (
        <Button disabled={state === "loading" || !assembly} onClick={() => void readLatest()}>
          读取本集最新保存版本
        </Button>
      )}
      <Button
        disabled={state === "loading" || !selected || !gateway?.getEpisodeAssemblyReadiness}
        onClick={() => void check()}
      >
        只读核对前置证据
      </Button>
      {!gateway?.getEpisodeAssemblyReadiness && <p>当前桌面版本缺少前置证据读取接口。</p>}
      {!selected && state !== "loading" && <p>尚未读到可核对的本集保存版本。</p>}
      {state === "loading" && <p role="status">正在只读核对…</p>}
      {state === "unknown" && (
        <p role="alert">本次证据无法核实，请重新只读核对；原草稿和写入日志保留。</p>
      )}
      {value && (
        <>
          <p>正式输出阻断 · 未创建PictureLock · 核对时间 {value.checked_at}</p>
          {!value.is_current_head && (
            <p role="alert">此为旧保存版本，当前头已变化；结果不能用于当前装配签发。</p>
          )}
          <ul>
            {value.source_checks.map((item) => (
              <li key={item.scope}>
                {scopeLabels[item.scope]}：{statusLabels[item.status]} · {item.code}
              </li>
            ))}
          </ul>
          <h4>实际素材原件与既有检查</h4>
          <ul>
            {value.assembly.media_checks.map((item) => (
              <li key={`${item.media.asset_id}/${item.media.asset_version_id}`}>
                {mediaKinds[item.kind]} · {item.media.asset_version_id} · 原件{" "}
                {availabilityLabels[item.availability]} · 权利 {rightsLabels[item.rights_status]} ·
                既有画面检查 {technicalLabels[item.technical_status]}
                <details>
                  <summary>精确素材与既有证据编号</summary>
                  <pre>{JSON.stringify(item, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
          <details>
            <summary>已保存画面、声音与字幕的完整范围及来源</summary>
            <p>媒体绑定、整数帧和对白文本来源不等于声音读本、字幕内容或口型人工审核通过。</p>
            <pre>
              {JSON.stringify(
                {
                  timebase: value.assembly.content.sequence_timebase,
                  visual: value.assembly.content.visual_segments,
                  audio: value.assembly.content.audio_segments,
                  subtitles: value.assembly.content.subtitle_segments,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <h4>仍需解决的正式制作前置项</h4>
          <ul>
            {value.blockers.map((item, i) => (
              <li key={`${item.code}/${i}`}>
                {scopeLabels[item.scope]}：{item.message} <small>({item.code})</small>
              </li>
            ))}
          </ul>
          <p>核对只反映此次读取。之后的源版本、原件或权利变化仍需重新检查；它不是正式导出授权。</p>
        </>
      )}
    </details>
  );
}
