import { useCallback, useEffect, useRef, useState } from "react";
import {
  localReviewCommand,
  localReviewPage,
  localReviewStatus,
  localReviewTarget,
  localReviewVersion,
  type LocalMediaReviewCommand,
  type LocalMediaReviewGateway,
  type LocalMediaReviewPage,
  type LocalMediaReviewStatus,
  type LocalMediaReviewTarget,
  type LocalMediaReviewTargetQuery,
  type LocalMediaReviewVersion,
} from "@aijian/contracts/local-media-review";
import { impactUuid } from "@aijian/contracts/script-confirmation-impact";
import { mediaNonblank } from "@aijian/contracts/media-preparation";
import {
  LOCAL_REVIEW_SESSION_INTENTS,
  preserveLocalReviewJournal,
  readLocalReviewJournal,
  submitLocalReview,
} from "./adapters/localMediaReview";
import { AssemblyMediaPreview } from "./AssemblyMediaPreview";
import { findAssemblyAsset } from "./adapters/assemblyEditing";
import type { AssetLibraryGateway, MediaAsset } from "./adapters/assetLibrary";
import type { AssemblyVersion } from "./adapters/episodeMediaAssembly";
import { Button } from "./Common";
import "./local-media-review.css";

import { Select } from "./Select";
export type LocalReviewFormState = {
  input: boolean;
  busy: boolean;
  unknown: boolean;
  activeTarget: boolean;
};
type Props = {
  projectId: string;
  episodeId: string;
  savedVersion: AssemblyVersion | null;
  dirty: boolean;
  disabled: boolean;
  audioOnly?: boolean;
  library: MediaAsset[] | null;
  assets?: AssetLibraryGateway;
  gateway: Partial<LocalMediaReviewGateway>;
  onState(state: LocalReviewFormState): void;
  onPreservationGuard(guard: (() => boolean) | null): void;
};
const outcomeLabels = { CHECKED: "已核对并记录", NEEDS_CHANGES: "发现问题，需修改" };
const kindLabels = { AUDIO: "录音原件", LITERAL_SUBTITLE: "字幕文字与帧范围" };
const applicabilityLabels = {
  CURRENT: "当前绑定仍适用 · 仅此自审记录",
  STALE: "原自审绑定已失效 · 历史保留",
  UNKNOWN: "当前适用性无法核实",
};
const noState: LocalReviewFormState = {
  input: false,
  busy: false,
  unknown: false,
  activeTarget: false,
};

export function LocalMediaReviewPanel(props: Props) {
  return <ScopedLocalMediaReviewPanel key={`${props.projectId}/${props.episodeId}`} {...props} />;
}
function ScopedLocalMediaReviewPanel(props: Props) {
  const { projectId: p, episodeId: e, savedVersion, gateway } = props;
  const scope = `${p}/${e}`;
  const identity = `${scope}/${savedVersion?.version_id ?? ""}/${savedVersion?.content_hash ?? ""}`;
  const live = useRef(identity);
  const epoch = useRef(0);
  if (live.current !== identity) {
    live.current = identity;
    ++epoch.current;
  }
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const request = useRef(0);
  const historyRequest = useRef(0);
  const original = useRef<LocalMediaReviewCommand | undefined>(
    LOCAL_REVIEW_SESSION_INTENTS.get(scope),
  );
  const [selection, setSelection] = useState("");
  const [target, setTarget] = useState<LocalMediaReviewTarget | null>(null);
  const [observation, setObservation] = useState("");
  const [outcome, setOutcome] = useState<"" | "CHECKED" | "NEEDS_CHANGES">("");
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState<LocalMediaReviewPage | null>(null);
  const [pageReady, setPageReady] = useState(false);
  const [detail, setDetail] = useState<LocalMediaReviewVersion | null>(null);
  const [status, setStatus] = useState<{ identity: string; value: LocalMediaReviewStatus } | null>(
    null,
  );
  const [statusUnknown, setStatusUnknown] = useState(false);
  const headFloor = useRef<{ revision: number; id: string } | null>(null);
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    /* Writes remain unavailable. */
  }
  const journal = () =>
    storage ? readLocalReviewJournal(storage, p, e) : { kind: "BLOCKED" as const };
  const preserve = () =>
    original.current
      ? !!storage && preserveLocalReviewJournal(storage, original.current)
      : journal().kind !== "BLOCKED";
  const formDirty = !!observation || !!outcome || declared;
  const unresolved = unknown || !!original.current || journal().kind !== "EMPTY";
  const available =
    !!gateway.getLocalMediaReviewTarget &&
    !!gateway.listLocalMediaReviews &&
    !!gateway.getLocalMediaReview &&
    !!gateway.getLocalMediaReviewStatus &&
    !!gateway.saveLocalMediaReview &&
    !!gateway.getLocalMediaReviewOperation;
  const bound =
    !!target &&
    !!savedVersion &&
    target.snapshot.assembly_version_id === savedVersion.version_id &&
    target.snapshot.assembly_content_hash === savedVersion.content_hash &&
    target.snapshot.assembly_head_revision === savedVersion.head_revision;
  const blocked = props.disabled || props.dirty || busy || unresolved || !available;
  const noop = useCallback(() => {}, []);
  const guardRef = useRef(preserve);
  guardRef.current = preserve;
  useEffect(() => {
    props.onPreservationGuard(() => guardRef.current());
    return () => props.onPreservationGuard(null);
  }, [props.onPreservationGuard]);
  useEffect(() => {
    props.onState({ input: formDirty, busy, unknown: unresolved, activeTarget: !!target });
  }, [formDirty, busy, unresolved, !!target, props.onState]);
  useEffect(() => {
    mounted.current = true;
    const pending = journal();
    if (!original.current && pending.kind === "PENDING") {
      original.current = pending.command;
      LOCAL_REVIEW_SESSION_INTENTS.set(scope, pending.command);
    }
    if (original.current || pending.kind !== "EMPTY") {
      setUnknown(true);
      setNotice("原自审保存待核对。只读取原操作，不会重新发送或生成新操作号。");
    }
    void readPage();
    return () => {
      mounted.current = false;
      ++epoch.current;
      ++request.current;
      ++historyRequest.current;
      // StrictMode reuses these refs when effects remount. Release only the read owner;
      // original write intent remains retained and can only be resolved by its exact GET.
      busyRef.current = false;
      preserve();
      props.onState(noState);
    };
  }, []);
  useEffect(() => {
    setStatus(null);
    if (target && !bound)
      setNotice("已保存装配版本发生变化；原输入保留。请明确放弃本次输入后选择新的核对对象。");
  }, [identity]);
  function setWorking(value: boolean) {
    busyRef.current = value;
    setBusy(value);
  }
  async function readPage(cursor?: string) {
    if (!gateway.listLocalMediaReviews || busyRef.current) return;
    const attempt = ++request.current;
    // History belongs to this mounted episode, independent of which saved assembly is current.
    const active = () => mounted.current && attempt === request.current;
    setWorking(true);
    setPageReady(false);
    let result;
    try {
      result = await gateway.listLocalMediaReviews(p, e, cursor);
    } catch {
      result = null;
    }
    const receipt = result?.kind === "FOUND" ? result.receipt : null;
    const valid =
      receipt &&
      impactUuid(receipt.request_id) &&
      (await localReviewPage(receipt.data, p, e, cursor));
    if (!active()) {
      if (mounted.current && attempt === request.current) setWorking(false);
      return;
    }
    setWorking(false);
    if (!valid || !receipt) {
      setNotice("本集自审历史未可靠读回；原记录与输入保留，不能提交新的自审。");
      return;
    }
    const next = receipt.data;
    const revision = next.head_revision ?? 0;
    const floor = headFloor.current;
    if (
      floor &&
      (revision < floor.revision ||
        (revision === floor.revision && next.head_version_id !== floor.id))
    ) {
      setNotice("自审历史头回执过旧或身份不一致；未授权新的保存。请重新核对。");
      return;
    }
    if (next.head_version_id) headFloor.current = { revision, id: next.head_version_id };
    setPage(next);
    setPageReady(true);
  }
  function discard() {
    if (busy || unresolved) return;
    if (formDirty && !window.confirm("明确放弃尚未保存的自审观察、结果和声明吗？")) return;
    setTarget(null);
    setSelection("");
    setObservation("");
    setOutcome("");
    setDeclared(false);
    setNotice("");
  }
  async function choose(value: string) {
    if (blocked || !savedVersion || !gateway.getLocalMediaReviewTarget) return;
    if (formDirty && !window.confirm("切换核对对象会放弃尚未保存的自审输入。继续吗？")) return;
    setSelection(value);
    setTarget(null);
    setObservation("");
    setOutcome("");
    setDeclared(false);
    if (!value) return;
    const [kind, segment] = value.split(":");
    if ((kind !== "AUDIO" && kind !== "LITERAL_SUBTITLE") || !segment) return;
    const query: LocalMediaReviewTargetQuery = {
      assembly_version_id: savedVersion.version_id,
      assembly_content_hash: savedVersion.content_hash,
      segment_kind: kind,
      segment_id: segment,
    };
    const attempt = ++request.current,
      generation = epoch.current;
    const active = () =>
      mounted.current && attempt === request.current && generation === epoch.current;
    setWorking(true);
    setNotice("正在读取此保存片段的精确核对对象…");
    let result;
    try {
      result = await gateway.getLocalMediaReviewTarget(p, e, query);
    } catch {
      result = null;
    }
    const receipt = result?.kind === "FOUND" ? result.receipt : null;
    const valid =
      receipt &&
      impactUuid(receipt.request_id) &&
      (await localReviewTarget(receipt.data, p, e, query)) &&
      receipt.data.snapshot.assembly_head_revision === savedVersion.head_revision;
    if (!active()) {
      if (mounted.current && attempt === request.current) setWorking(false);
      return;
    }
    setWorking(false);
    if (!valid || !receipt) {
      setNotice("原件、来源、保存版本或对象哈希无法核实；未建立新自审。原历史保留。");
      return;
    }
    setTarget(receipt.data);
    setNotice("请亲自核对所选对象，填写具体观察并明确选择结果，再显式保存自审记录。");
  }
  async function inspect(versionId: string) {
    if (!gateway.getLocalMediaReview || busyRef.current) return;
    const attempt = ++historyRequest.current,
      generation = epoch.current;
    const active = () =>
      mounted.current && attempt === historyRequest.current && generation === epoch.current;
    setWorking(true);
    setStatus(null);
    setStatusUnknown(false);
    let result;
    try {
      result = await gateway.getLocalMediaReview(p, e, versionId);
    } catch {
      result = null;
    }
    const receipt = result?.kind === "FOUND" ? result.receipt : null;
    const valid =
      receipt &&
      impactUuid(receipt.request_id) &&
      (await localReviewVersion(receipt.data, p, e, versionId));
    if (!active()) {
      if (mounted.current && attempt === historyRequest.current) setWorking(false);
      return;
    }
    setWorking(false);
    if (!valid || !receipt) {
      setNotice("所选历史自审记录未可靠读回；没有替换原历史事实。");
      return;
    }
    setDetail(receipt.data);
    setNotice("已读回不可变自审事实。请另行核对当前适用状态；读历史不会批准任何输出。");
  }
  async function checkStatus() {
    if (!detail || !gateway.getLocalMediaReviewStatus || busyRef.current) return;
    const q = { version_id: detail.version_id, content_hash: detail.content_hash };
    const attempt = ++historyRequest.current,
      generation = epoch.current;
    const active = () =>
      mounted.current && attempt === historyRequest.current && generation === epoch.current;
    setWorking(true);
    setStatus(null);
    setStatusUnknown(false);
    let result;
    try {
      result = await gateway.getLocalMediaReviewStatus(p, e, q);
    } catch {
      result = null;
    }
    if (!active()) {
      if (mounted.current && attempt === historyRequest.current) setWorking(false);
      return;
    }
    setWorking(false);
    const receipt = result?.kind === "FOUND" ? result.receipt : null;
    if (!receipt || !impactUuid(receipt.request_id) || !localReviewStatus(receipt.data, q)) {
      setStatusUnknown(true);
      return;
    }
    const current = receipt.data.current_assembly;
    const input = detail.content.input;
    if (
      receipt.data.applicability === "CURRENT" &&
      (!current ||
        current.version_id !== input.assembly_version_id ||
        current.content_hash !== input.assembly_content_hash ||
        current.head_revision !== input.assembly_head_revision)
    ) {
      setStatusUnknown(true);
      return;
    }
    setStatus({ identity, value: receipt.data });
  }
  async function write(recover: boolean) {
    if (busyRef.current || !storage || !available) return;
    let command = original.current;
    if (recover) {
      const pending = journal();
      if (!command && pending.kind === "PENDING") command = pending.command;
      if (!command) {
        setNotice("原保存日志缺少完整命令；不能从最新历史推断成功或重新发送。");
        return;
      }
    } else {
      if (
        blocked ||
        !bound ||
        !target ||
        !pageReady ||
        !page ||
        !declared ||
        !outcome ||
        !mediaNonblank(observation)
      )
        return;
      const s = target.snapshot;
      command = {
        operation_id: crypto.randomUUID(),
        payload: {
          input: {
            schema_version: "1.0.0",
            project_id: p,
            episode_id: e,
            assembly_version_id: s.assembly_version_id,
            assembly_content_hash: s.assembly_content_hash,
            assembly_head_revision: s.assembly_head_revision,
            segment_kind: s.segment_kind,
            segment_id: s.segment_id,
            segment_content_hash: s.segment_content_hash,
            target_snapshot_hash: target.snapshot_hash,
            outcome,
            observation,
            self_review: true,
          },
          parent_version_id: page.head_version_id,
          expected_revision: page.head_revision,
        },
      };
      if (!localReviewCommand(command, p, e)) {
        setNotice("自审输入不符合完整合同；请核对观察长度和字段，输入仍保留。");
        return;
      }
    }
    original.current = command;
    LOCAL_REVIEW_SESSION_INTENTS.set(scope, command);
    const attempt = ++request.current,
      generation = epoch.current;
    // Original-operation recovery is scoped to the episode, even when its saved assembly is now old.
    const active = () =>
      mounted.current && attempt === request.current && (recover || generation === epoch.current);
    setWorking(true);
    setUnknown(true);
    const result = await submitLocalReview(
      gateway as LocalMediaReviewGateway,
      storage,
      command,
      active,
      recover,
    );
    if (!active()) {
      if (mounted.current && attempt === request.current) setWorking(false);
      return;
    }
    setWorking(false);
    if (result.kind === "UNKNOWN") {
      setNotice("自审保存结果未知。原操作已保留，只允许只读准确核对；不会重新发送。");
      return;
    }
    original.current = undefined;
    LOCAL_REVIEW_SESSION_INTENTS.delete(scope);
    setUnknown(false);
    if (result.kind === "REJECTED") {
      setPageReady(false);
      setNotice(`自审保存明确被拒绝：${result.code}。输入保留，请先重新读取历史和核对对象。`);
      return;
    }
    setDetail(result.operation.version);
    setStatus(null);
    setStatusUnknown(false);
    const next = result.operation.version;
    if (!headFloor.current || result.operation.result_revision > headFloor.current.revision)
      headFloor.current = { revision: result.operation.result_revision, id: next.version_id };
    setObservation("");
    setOutcome("");
    setDeclared(false);
    setNotice("已保存并准确读回原自审记录；不代表混音、字幕母版或正式成片批准。");
    await readPage();
  }
  const snapshot = target?.snapshot;
  const audio = snapshot?.audio_segment;
  const checkedStatus = status?.identity === identity ? status.value : null;
  return (
    <section className="local-media-review" aria-label="本地声音与字幕自审">
      <h3>本地声音与字幕 · 自审记录</h3>
      <p>
        由当前使用者亲自核对并记录。仅核对完整录音原件或保存的字幕文字与帧范围；不证明序列混音、音画同步、口型或母版质量，不解除正式批准与权利门。
      </p>
      {!available && <p>当前桌面没有完整的本地自审读写接口，不能保存记录。</p>}
      {(props.dirty || props.disabled) && (
        <p>装配或字幕、裁剪仍有未保存输入，或原装配写入待核对。请先处理，再选择自审对象。</p>
      )}
      <div className="local-review-actions">
        <Button disabled={busy || !available} onClick={() => void readPage()}>
          读取本集自审历史
        </Button>
        <Button
          disabled={busy || !unresolved || !available || !storage}
          onClick={() => void write(true)}
        >
          只读核对原自审保存
        </Button>
        <Button disabled={busy || unresolved || (!formDirty && !target)} onClick={discard}>
          明确放弃本次自审输入
        </Button>
      </div>
      {unresolved && <p role="alert">原自审保存待核对，新保存已锁定；原记录不会自动重发。</p>}
      {notice && <p role="status">{notice}</p>}
      <label>
        选择已保存的自审片段
        <Select
          value={selection}
          disabled={blocked || !savedVersion}
          onChange={(event) => void choose(event.target.value)}
        >
          <option value="">请选择录音或文字字幕</option>
          {savedVersion?.content.audio_segments.map((s) => (
            <option key={s.segment_id} value={`AUDIO:${s.segment_id}`}>
              录音 {s.track_kind} · {s.segment_id} · [{s.start_frame}, {s.end_frame}) 帧
            </option>
          ))}
          {!props.audioOnly &&
            savedVersion?.content.subtitle_segments
              .filter((s) => "text" in s)
              .map((s) => (
                <option key={s.segment_id} value={`LITERAL_SUBTITLE:${s.segment_id}`}>
                  文字字幕 · {s.segment_id} · [{s.start_frame}, {s.end_frame}) 帧
                </option>
              ))}
        </Select>
      </label>
      {snapshot && (
        <div className="local-review-subject">
          <h4>当前核对对象 · {kindLabels[snapshot.segment_kind]}</h4>
          <p>
            保存装配 {snapshot.assembly_version_id} · {snapshot.assembly_content_hash}
          </p>
          <p>
            片段 {snapshot.segment_id} · {snapshot.segment_content_hash}
          </p>
          {!bound && <p role="alert">此核对对象已不是当前读回装配；观察输入保留，不能继续提交。</p>}
          {audio && (
            <>
              <p>
                序列 [{audio.start_frame}, {audio.end_frame}) 帧，源入点 {audio.source_in_sample}{" "}
                采样。下方播放器播放完整原件，未应用此序列裁剪或混音。
              </p>
              <AssemblyMediaPreview
                projectId={p}
                media={audio.media}
                version={findAssemblyAsset(props.library, audio.media)}
                gateway={props.assets}
                onSampleRate={noop}
              />
            </>
          )}
          {snapshot.subtitle_segment && (
            <>
              <p>
                字幕 [{snapshot.subtitle_segment.start_frame}, {snapshot.subtitle_segment.end_frame}
                ) 帧 · {snapshot.canvas_width} × {snapshot.canvas_height}
              </p>
              <pre>{snapshot.subtitle_segment.text}</pre>
              <p>本次是文字与保存帧范围的人工核对，不代表实际画面上的字形、遮挡或可读性验收。</p>
            </>
          )}
          <label>
            具体自审观察
            <textarea
              value={observation}
              maxLength={4000}
              disabled={busy || unresolved}
              onChange={(event) => setObservation(event.target.value)}
            />
          </label>
          <p>{[...observation].length} / 2000 字符；请写实际观察，不预填通过。</p>
          <label>
            本次自审结果
            <Select
              value={outcome}
              disabled={busy || unresolved}
              onChange={(event) =>
                setOutcome(
                  event.target.value === "CHECKED" || event.target.value === "NEEDS_CHANGES"
                    ? event.target.value
                    : "",
                )
              }
            >
              <option value="">请明确选择结果</option>
              <option value="CHECKED">已核对并记录</option>
              <option value="NEEDS_CHANGES">发现问题，需修改</option>
            </Select>
          </label>
          <label className="local-review-declaration">
            <input
              type="checkbox"
              checked={declared}
              disabled={busy || unresolved}
              onChange={(event) => setDeclared(event.target.checked)}
            />
            {snapshot.segment_kind === "AUDIO"
              ? "我已亲自试听此精确录音原件，并填写自己的观察（自审）"
              : "我已亲自核对上述精确字幕文字与保存帧范围，并填写自己的观察（自审）"}
          </label>
          <Button
            primary
            disabled={
              blocked ||
              !bound ||
              !pageReady ||
              !declared ||
              !outcome ||
              !mediaNonblank(observation) ||
              [...observation].length > 2000
            }
            onClick={() => void write(false)}
          >
            显式保存本次自审记录
          </Button>
        </div>
      )}
      <div className="local-review-history">
        <h4>本集不可变自审历史</h4>
        {page?.items.length === 0 && <p>尚无人工自审记录。</p>}
        {page?.items.map((item) => (
          <div key={item.version_id}>
            <p>
              自审 v{item.version_number} · {kindLabels[item.content.input.segment_kind]} ·{" "}
              {outcomeLabels[item.content.input.outcome]} · {item.created_at}
            </p>
            <Button disabled={busy} onClick={() => void inspect(item.version_id)}>
              读取自审记录 {item.version_id}
            </Button>
          </div>
        ))}
        {page?.next_cursor && (
          <Button disabled={busy} onClick={() => void readPage(page.next_cursor ?? undefined)}>
            读取更早自审记录
          </Button>
        )}
      </div>
      {detail && (
        <section aria-label="精确历史自审记录">
          <h4>
            自审 v{detail.version_number} · {outcomeLabels[detail.content.input.outcome]}
          </h4>
          <p>当前本地使用者自审 · {detail.created_at}</p>
          <p>
            记录 {detail.version_id} · {detail.content_hash}
          </p>
          <p>
            绑定装配 {detail.content.input.assembly_version_id} ·{" "}
            {detail.content.input.assembly_content_hash}
          </p>
          <p>
            绑定片段 {detail.content.input.segment_id} · {detail.content.input.segment_content_hash}
          </p>
          {detail.content.target_snapshot.media_original && (
            <p>
              原件 {detail.content.target_snapshot.media_original.filename} ·{" "}
              {detail.content.target_snapshot.media_original.asset_version_id} ·{" "}
              {detail.content.target_snapshot.media_original.sha256}
            </p>
          )}
          {detail.content.target_snapshot.subtitle_segment && (
            <pre>{detail.content.target_snapshot.subtitle_segment.text}</pre>
          )}
          <p className="local-review-observation">{detail.content.input.observation}</p>
          <Button disabled={busy} onClick={() => void checkStatus()}>
            只读核对当前适用状态
          </Button>
          {checkedStatus && (
            <>
              <p role="status">{applicabilityLabels[checkedStatus.applicability]}</p>
              {checkedStatus.reasons.map((r) => (
                <p key={r.code}>{r.message}</p>
              ))}
            </>
          )}
          {statusUnknown && (
            <p role="alert">当前适用性回执无法核实；原人工记录保留，没有当作当前审核结果。</p>
          )}
          <p>
            这是原人工观察的持久事实；“当前适用”只说明绑定仍相同，始终不代表正式声音、字幕母版或成片批准。
          </p>
        </section>
      )}
    </section>
  );
}
