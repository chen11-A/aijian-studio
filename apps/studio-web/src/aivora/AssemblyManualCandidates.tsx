import { useEffect, useRef, useState } from "react";
import {
  candidatePage,
  verifiedCandidateVersion,
  type ManualMediaCandidateGateway,
  type ManualMediaCandidatePage,
  type ManualMediaCandidateVersion,
} from "@aijian/contracts/manual-media-candidate";
import {
  verifiedMediaVersion,
  type MediaPreparationGateway,
  type MediaPreparationVersion,
} from "@aijian/contracts/media-preparation";
import { impactEnvelope } from "@aijian/contracts/script-confirmation-impact";
import { Button } from "./Common";
import { newAssemblySegmentId } from "./adapters/assemblyEditing";
import type { AssemblyContent, AssemblyVisualSegment } from "./adapters/episodeMediaAssembly";
type Gateway = Partial<ManualMediaCandidateGateway & MediaPreparationGateway>;
export function AssemblyManualCandidates({
  content,
  selectedId,
  locked,
  gateway,
  onEdit,
  onSelect,
}: {
  content: AssemblyContent;
  selectedId: string;
  locked: boolean;
  gateway?: Gateway;
  onEdit: (content: AssemblyContent) => boolean;
  onSelect: (id: string, frame: number) => void;
}) {
  const p = content.project_id,
    e = content.episode_id,
    scope = `${p}/${e}`,
    epoch = useRef(0),
    active = useRef(scope),
    flight = useRef(false);
  active.current = scope;
  const [page, setPage] = useState<ManualMediaCandidatePage | null>(null),
    [candidate, setCandidate] = useState<ManualMediaCandidateVersion | null>(null),
    [preparation, setPreparation] = useState<MediaPreparationVersion | null>(null),
    [choice, setChoice] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const ready =
    gateway?.listManualMediaCandidates &&
    gateway.getManualMediaCandidate &&
    gateway.getMediaPreparation;
  async function load(cursor?: string) {
    if (!ready || flight.current) return;
    const token = ++epoch.current;
    flight.current = true;
    setBusy(true);
    try {
      const r = await gateway!.listManualMediaCandidates!(p, e, cursor),
        valid =
          r.kind === "FOUND" &&
          impactEnvelope(r.receipt, r.receipt.request_id) &&
          (await candidatePage(r.receipt.data, p, e));
      if (epoch.current !== token || active.current !== scope) return;
      if (
        !valid ||
        r.kind !== "FOUND" ||
        (cursor &&
          r.receipt.data.items.some((i) => page?.items.some((v) => v.version_id === i.version_id)))
      ) {
        setNotice("手工候选历史无法完整核对。");
        return;
      }
      const next = r.receipt.data;
      setPage((old) => (cursor && old ? { ...next, items: [...old.items, ...next.items] } : next));
      // Exact selection survives refreshed head/page; never auto-select newest.
    } catch {
      if (epoch.current === token) setNotice("手工候选历史读取UNKNOWN。");
    } finally {
      if (epoch.current === token) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    ++epoch.current;
    flight.current = false;
    setBusy(false);
    setPage(null);
    setCandidate(null);
    setPreparation(null);
    setChoice("");
    setNotice("");
    void load();
    return () => {
      ++epoch.current;
      flight.current = false;
    };
  }, [scope, gateway]);
  async function inspect(id: string) {
    setChoice(id);
    setCandidate(null);
    setPreparation(null);
    if (!ready || !id || flight.current) return;
    const token = ++epoch.current;
    flight.current = true;
    setBusy(true);
    try {
      const r = await gateway!.getManualMediaCandidate!(p, e, id),
        valid =
          r.kind === "FOUND" &&
          impactEnvelope(r.receipt, r.receipt.request_id) &&
          (await verifiedCandidateVersion(r.receipt.data, p, e));
      if (token !== epoch.current || active.current !== scope) return;
      if (
        !valid ||
        r.kind !== "FOUND" ||
        r.receipt.data.version_id !== id ||
        !page?.items.some(
          (v) => v.version_id === id && v.content_hash === r.receipt.data.content_hash,
        )
      ) {
        setNotice("精确候选身份或哈希不符。");
        return;
      }
      const selected = r.receipt.data,
        ref = selected.content.input,
        s = await gateway!.getMediaPreparation!(p, e, ref.preparation_version_id);
      const sourceValid =
        s.kind === "FOUND" &&
        impactEnvelope(s.receipt, s.receipt.request_id) &&
        (await verifiedMediaVersion(s.receipt.data, p, e));
      if (token !== epoch.current || active.current !== scope) return;
      if (
        !sourceValid ||
        s.kind !== "FOUND" ||
        s.receipt.data.version_id !== ref.preparation_version_id ||
        s.receipt.data.content_hash !== ref.preparation_content_hash ||
        s.receipt.data.content.input.capability_intent.toLowerCase() !==
          selected.content.asset_snapshot.kind
      ) {
        setNotice("候选完整制作请求来源无法核对。");
        return;
      }
      setCandidate(selected);
      setPreparation(s.receipt.data);
      setNotice("已核对历史来源；选入只修改未保存装配，另行保存时核对当前原件、权益及批准。");
    } catch {
      if (token === epoch.current) setNotice("候选精确读取UNKNOWN。");
    } finally {
      if (token === epoch.current) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  const current = content.visual_segments.find((s) => s.segment_id === selectedId),
    rate = content.sequence_timebase.frame_rate;
  const matching = !!preparation && rate.den === 1 && rate.num === preparation.content.snapshot.fps;
  function adopt(replace: boolean) {
    if (locked || busy || !candidate || !preparation || !matching || (replace && !current)) return;
    if (
      replace &&
      !window.confirm(
        `将片段 ${current!.segment_id} 的素材与来源替换为手工候选 ${candidate.version_id}？保留该片段时间范围，旧保存版本仍保留；此修改尚未保存。`,
      )
    )
      return;
    const input = candidate.content.input,
      start = replace ? current!.start_frame : content.total_frames,
      end = replace
        ? current!.end_frame
        : start + preparation.content.snapshot.shot.duration_frames;
    const segment: AssemblyVisualSegment = {
      segment_id: replace ? current!.segment_id : newAssemblySegmentId(),
      media_kind: candidate.content.asset_snapshot.kind,
      media: {
        asset_id: input.asset_id,
        asset_version_id: input.asset_version_id,
        sha256: input.asset_sha256,
      },
      start_frame: start,
      end_frame: end,
      source_in_frame: 0,
      embedded_audio: "MUTE",
      storyboard_ref: {
        storyboard_version_id: preparation.content.input.storyboard_version_id,
        shot_id: preparation.content.input.shot_id,
      },
      manual_candidate_ref: {
        candidate_version_id: candidate.version_id,
        candidate_content_hash: candidate.content_hash,
        preparation_version_id: input.preparation_version_id,
        preparation_content_hash: input.preparation_content_hash,
        adoption_intent: "MANUAL_ADOPTION",
      },
    };
    const next = {
      ...content,
      total_frames: replace ? content.total_frames : end,
      visual_segments: replace
        ? content.visual_segments.map((s) => (s.segment_id === selectedId ? segment : s))
        : [...content.visual_segments, segment],
    };
    if (onEdit(next)) {
      onSelect(segment.segment_id, start);
      setNotice(
        "已完成手工选入操作；装配保存状态以上方读回结果为准。预览或导出需使用明确保存版本，费用UNKNOWN。",
      );
    }
  }
  return (
    <details className="assembly-manual-candidates" aria-label="手工候选选入装配">
      <summary>手工本地候选 · 明确选入装配</summary>
      <p>
        LOCAL_IMPORT／MANUAL_ADOPTION／费用UNKNOWN。选入不调用模型、编码或发布，也不代表制作完成或正式签发。
      </p>
      <p role="status">
        {notice ||
          (!ready
            ? "当前桌面没有精确候选读取接口。"
            : "选择同分集候选并核对完整制作请求，再明确选入。")}
      </p>
      <div className="assembly-actions">
        <Button disabled={!ready || busy || locked} onClick={() => void load()}>
          刷新本分集手工候选
        </Button>
        {page?.next_cursor && (
          <Button disabled={busy || locked} onClick={() => void load(page.next_cursor!)}>
            读取下一页候选
          </Button>
        )}
      </div>
      <label>
        精确手工候选
        <select
          value={choice}
          disabled={!ready || busy || locked}
          onChange={(event) => void inspect(event.target.value)}
        >
          <option value="">请选择精确候选</option>
          {page?.items.map((v) => (
            <option key={v.version_id} value={v.version_id}>
              候选{v.version_number} · {v.content.asset_snapshot.filename} · {v.version_id}
            </option>
          ))}
        </select>
      </label>
      {candidate && preparation && (
        <>
          <p>
            候选{candidate.version_id} · 作者{candidate.author_actor_id} ·{" "}
            {candidate.content.input.association_note}
          </p>
          <p>
            请求{preparation.version_id}／镜头{preparation.content.input.shot_id} ·{" "}
            {preparation.content.snapshot.shot.title} · {preparation.content.snapshot.fps}fps
          </p>
          <p>
            完整来源hash {preparation.content_hash} · 素材SHA {candidate.content.input.asset_sha256}
          </p>
          {!matching && (
            <p role="alert">装配与请求帧率不一致。请明确使用相同帧率的装配；不会自动换算帧。</p>
          )}
          <div className="assembly-actions">
            <Button disabled={locked || busy || !matching} onClick={() => adopt(false)}>
              将候选新增为画面片段
            </Button>
            <Button disabled={locked || busy || !matching || !current} onClick={() => adopt(true)}>
              以候选替换所选画面片段
            </Button>
          </div>
        </>
      )}
      {current?.manual_candidate_ref && (
        <p>
          所选片段固定手工来源：{current.manual_candidate_ref.candidate_version_id} · 请求
          {current.manual_candidate_ref.preparation_version_id} ·
          MANUAL_ADOPTION；旧来源不自动升级。
        </p>
      )}
    </details>
  );
}
