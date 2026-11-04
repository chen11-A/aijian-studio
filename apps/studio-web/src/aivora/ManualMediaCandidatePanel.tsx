import { useEffect, useRef, useState } from "react";
import {
  candidateInput,
  candidatePage,
  verifiedCandidateVersion,
  type ManualMediaCandidateCommand,
  type ManualMediaCandidateGateway,
  type ManualMediaCandidateInput,
  type ManualMediaCandidatePage,
  type ManualMediaCandidateVersion,
} from "@aijian/contracts/manual-media-candidate";
import {
  verifiedMediaVersion,
  type MediaPreparationGateway,
  type MediaPreparationVersion,
} from "@aijian/contracts/media-preparation";
import { impactEnvelope } from "@aijian/contracts/script-confirmation-impact";
import {
  readAssetLibrary,
  type AssetLibraryGateway,
  type MediaAsset,
} from "./adapters/assetLibrary";
import {
  preserveCandidateJournal,
  readCandidateJournal,
  recoverCandidate,
  saveCandidate,
  type CandidateJournal,
} from "./adapters/manualMediaCandidate";
import type { MediaInputLeave } from "./MediaInputLeave";
import { Button } from "./Common";
import { Select } from "./Select";
const SESSION_INTENTS = new Map<string, ManualMediaCandidateCommand>();
type Gateway = Partial<ManualMediaCandidateGateway & MediaPreparationGateway> & {
  assetLibrary?: AssetLibraryGateway;
};
type Props = {
  projectId: string;
  episodeId: string;
  gateway: Gateway;
  preparation: MediaPreparationVersion | null;
  registerLeaveCheck?: (c: MediaInputLeave | null) => void;
  go?: () => void;
  sessionIntents?: Map<string, ManualMediaCandidateCommand>;
};
export function ManualMediaCandidatePanel({
  projectId: p,
  episodeId: e,
  gateway: api,
  preparation,
  registerLeaveCheck,
  go,
  sessionIntents,
}: Props) {
  const scope = `${p}/${e}`,
    epoch = useRef(0),
    active = useRef(scope),
    inFlight = useRef(false),
    owned = useRef(sessionIntents ?? SESSION_INTENTS);
  active.current = scope;
  const [input, setInput] = useState<ManualMediaCandidateInput | null>(null),
    [source, setSource] = useState<MediaPreparationVersion | null>(null),
    [library, setLibrary] = useState<MediaAsset[] | null>(null),
    [page, setPage] = useState<ManualMediaCandidatePage | null>(null),
    [detail, setDetail] = useState<ManualMediaCandidateVersion | null>(null),
    [journal, setJournal] = useState<CandidateJournal>({ kind: "EMPTY" }),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    /* Unavailable journals block writes. */
  }
  const ready =
    api.listManualMediaCandidates &&
    api.getManualMediaCandidate &&
    api.saveManualMediaCandidate &&
    api.getManualMediaCandidateOperation &&
    api.getMediaPreparation &&
    api.assetLibrary;
  const leave = useRef({ dirty, busy, journal, storage, scope });
  leave.current = { dirty, busy, journal, storage, scope };
  useEffect(() => {
    const preserve = () => {
      const s = leave.current,
        c = owned.current.get(s.scope);
      if (s.busy || inFlight.current) {
        setNotice("手工候选正在保存或核对，请等待本次结果再离开。");
        return false;
      }
      if (
        s.journal.kind === "BLOCKED" ||
        (c && (!s.storage || !preserveCandidateJournal(s.storage, c)))
      ) {
        setNotice("手工候选原输入日志无法完整保留，请先准确核对。");
        return false;
      }
      return true;
    };
    registerLeaveCheck?.({ preserve, dirty: () => leave.current.dirty });
    const warn = (event: BeforeUnloadEvent) => {
      if (leave.current.dirty || !preserve()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      registerLeaveCheck?.(null);
      window.removeEventListener("beforeunload", warn);
    };
  }, [registerLeaveCheck]);
  function refreshJournal() {
    const c = owned.current.get(scope);
    setJournal(
      !storage || (c && !preserveCandidateJournal(storage, c))
        ? { kind: "BLOCKED" }
        : readCandidateJournal(storage, p, e),
    );
  }
  async function exactSource(selected: ManualMediaCandidateInput) {
    const r = await api.getMediaPreparation!(p, e, selected.preparation_version_id);
    return r.kind === "FOUND" &&
      impactEnvelope(r.receipt, r.receipt.request_id) &&
      (await verifiedMediaVersion(r.receipt.data, p, e)) &&
      r.receipt.data.version_id === selected.preparation_version_id &&
      r.receipt.data.content_hash === selected.preparation_content_hash
      ? r.receipt.data
      : null;
  }
  async function load(cursor?: string) {
    if (!ready || !storage || inFlight.current) return;
    const token = ++epoch.current;
    setBusy(true);
    inFlight.current = true;
    try {
      const j = readCandidateJournal(storage, p, e),
        original = owned.current.get(scope) ?? (j.kind === "PENDING" ? j.command : null);
      const [r, assets, savedSource] = await Promise.all([
        api.listManualMediaCandidates!(p, e, cursor),
        readAssetLibrary(api.assetLibrary, p),
        original ? exactSource(original.payload.input) : Promise.resolve(null),
      ]);
      const valid =
        r.kind === "FOUND" &&
        impactEnvelope(r.receipt, r.receipt.request_id) &&
        (await candidatePage(r.receipt.data, p, e));
      if (token !== epoch.current || active.current !== scope) return;
      setLibrary(assets.kind === "READY" ? assets.assets : null);
      if (
        !valid ||
        r.kind !== "FOUND" ||
        (cursor &&
          r.receipt.data.items.some((i) => page?.items.some((v) => v.version_id === i.version_id)))
      ) {
        setNotice("候选历史或分页无法完整核对；保留输入。");
        return;
      }
      const next = r.receipt.data;
      setPage((old) => (cursor && old ? { ...next, items: [...old.items, ...next.items] } : next));
      if (savedSource) setSource(savedSource);
    } catch {
      if (token === epoch.current) setNotice("候选读取结果未知，保留完整输入。");
    } finally {
      if (token === epoch.current) {
        setBusy(false);
        inFlight.current = false;
        refreshJournal();
      }
    }
  }
  useEffect(() => {
    ++epoch.current;
    inFlight.current = false;
    setBusy(false);
    setInput(null);
    setSource(null);
    setPage(null);
    setLibrary(null);
    setDetail(null);
    setDirty(false);
    setNotice("");
    const original = owned.current.get(scope),
      j = storage ? readCandidateJournal(storage, p, e) : { kind: "BLOCKED" as const };
    if (original) {
      setInput(original.payload.input);
      if (storage) preserveCandidateJournal(storage, original);
    } else if (j.kind === "PENDING") {
      owned.current.set(scope, j.command);
      setInput(j.command.payload.input);
    }
    refreshJournal();
    void load();
    return () => {
      ++epoch.current;
      inFlight.current = false;
    };
  }, [scope, api]);
  const locked = busy || journal.kind !== "EMPTY" || owned.current.has(scope),
    choices = (library ?? []).flatMap((a) =>
      a.versions
        .filter(
          (v) => (v.kind === "image" || v.kind === "video") && v.rights_status !== "RESTRICTED",
        )
        .map((v) => ({ asset: a, version: v, key: `${a.id}/${v.id}` })),
    );
  function chooseSource() {
    if (!preparation || locked) return;
    if (dirty && !window.confirm("放弃候选未保存关联输入，改用此精确制作请求吗？")) return;
    setSource(preparation);
    setDetail(null);
    setInput({
      schema_version: "1.0.0",
      project_id: p,
      episode_id: e,
      preparation_version_id: preparation.version_id,
      preparation_content_hash: preparation.content_hash,
      asset_id: "",
      asset_version_id: "",
      asset_sha256: "",
      association_note: "",
    });
    setDirty(true);
  }
  async function inspect(id: string) {
    if (!api.getManualMediaCandidate || !api.getMediaPreparation || inFlight.current) return;
    const token = ++epoch.current;
    setBusy(true);
    inFlight.current = true;
    try {
      const r = await api.getManualMediaCandidate(p, e, id),
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
        setNotice("精确手工候选回执或哈希不符。");
        return;
      }
      setDetail(r.receipt.data);
    } catch {
      if (token === epoch.current) setNotice("候选详情读取UNKNOWN。");
    } finally {
      if (token === epoch.current) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }
  async function mutate(recovery: boolean) {
    if (!ready || !storage || inFlight.current) return;
    let c = owned.current.get(scope);
    if (!recovery) {
      if (journal.kind !== "EMPTY" || c || !page || !input || !candidateInput(input, p, e)) return;
      c = {
        operation_id: crypto.randomUUID(),
        payload: {
          input,
          parent_version_id: page.head_version_id,
          expected_revision: page.head_revision,
        },
      };
      owned.current.set(scope, c);
    } else if (!c && journal.kind === "PENDING") {
      c = journal.command;
      owned.current.set(scope, c);
    }
    if (!c) {
      setNotice("缺少完整原候选输入，不能推断未写入或重发。");
      return;
    }
    const token = ++epoch.current;
    setBusy(true);
    inFlight.current = true;
    const r = await (recovery ? recoverCandidate : saveCandidate)(
      api as ManualMediaCandidateGateway,
      storage,
      c,
      () => token === epoch.current && active.current === scope,
    );
    if (token !== epoch.current || active.current !== scope) return;
    setBusy(false);
    inFlight.current = false;
    if (r.kind === "UNKNOWN") {
      setNotice("候选关联UNKNOWN；只允许核对原操作，不自动重复提交。");
      refreshJournal();
      return;
    }
    owned.current.delete(scope);
    refreshJournal();
    if (r.kind === "SAVED") {
      setDetail(r.version);
      setDirty(false);
      setNotice("手工候选已持久保存；尚未选入装配。费用UNKNOWN。");
      void load();
    } else setNotice(`候选明确拒绝：${r.code}。输入保留，请核对原件和当前历史。`);
  }
  return (
    <section className="manual-media-candidate-panel" aria-label="手工本地媒体候选">
      <h2>手工本地媒体候选 · 草稿</h2>
      <p>
        关联已导入的精确素材；LOCAL_IMPORT／手工关联／费用UNKNOWN。此操作不代表模型生成、镜头完成或正式批准。
      </p>
      <p role="status">
        {notice ||
          (!ready
            ? "当前桌面缺少候选持久接口，请保留输入。"
            : "先在制作请求历史查看一个精确版本，再明确选择它作为关联来源。")}
      </p>
      <Button disabled={!ready || locked || !preparation} onClick={chooseSource}>
        使用已查看的制作请求关联素材
      </Button>
      {input && (
        <fieldset disabled={locked}>
          <legend>未保存的手工关联输入</legend>
          <p>
            制作请求：{input.preparation_version_id} · {input.preparation_content_hash}
          </p>
          <p>
            镜头：{source?.content.input.shot_id ?? "尚未核对"} ·{" "}
            {source?.content.input.capability_intent ?? "UNKNOWN"}
          </p>
          <label>
            精确本地素材版本
            <Select
              value={input.asset_id ? `${input.asset_id}/${input.asset_version_id}` : ""}
              onChange={(event) => {
                const c = choices.find((v) => v.key === event.target.value);
                if (c) {
                  setInput({
                    ...input,
                    asset_id: c.asset.id,
                    asset_version_id: c.version.id,
                    asset_sha256: c.version.sha256,
                  });
                  setDirty(true);
                }
              }}
            >
              <option value="">请选择精确版本</option>
              {choices
                .filter(
                  (c) =>
                    !source ||
                    c.version.kind === source.content.input.capability_intent.toLowerCase(),
                )
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.version.filename} · {c.version.kind} · {c.version.id} ·{" "}
                    {c.version.availability}
                  </option>
                ))}
            </Select>
          </label>
          <label>
            完整手工关联说明
            <textarea
              value={input.association_note}
              maxLength={20000}
              onChange={(event) => {
                setInput({ ...input, association_note: event.target.value });
                setDirty(true);
              }}
            />
          </label>
          <p>
            尺寸、时长和表现由用户另行审查；关联不会证明满足制作请求。保存前后端重新核对原件及权益。
          </p>
        </fieldset>
      )}
      <div className="media-input-actions">
        <Button
          disabled={!ready || locked || !input || !candidateInput(input, p, e)}
          onClick={() => void mutate(false)}
        >
          保存手工候选关联
        </Button>
        <Button
          disabled={!ready || busy || (journal.kind === "EMPTY" && !owned.current.has(scope))}
          onClick={() => void mutate(true)}
        >
          只读核对原候选关联
        </Button>
        <Button disabled={!ready || busy} onClick={() => void load()}>
          刷新候选历史
        </Button>
      </div>
      <details>
        <summary>本分集手工候选历史 · {page?.items.length ?? 0}</summary>
        {page?.items.map((v) => (
          <Button key={v.version_id} disabled={busy} onClick={() => void inspect(v.version_id)}>
            查看候选 {v.version_number} · {v.content.asset_snapshot.filename} ·{" "}
            {v.content.input.preparation_version_id}
          </Button>
        ))}
        {page?.next_cursor && (
          <Button disabled={busy} onClick={() => void load(page.next_cursor!)}>
            读取下一页候选
          </Button>
        )}
      </details>
      {detail && (
        <details open>
          <summary>已保存候选 {detail.version_id} · 尚需明确选入装配</summary>
          <p>{detail.content.input.association_note}</p>
          <p>来源LOCAL_IMPORT · 作者{detail.author_actor_id} · 费用UNKNOWN</p>
          <p>
            素材{detail.content.input.asset_version_id} · SHA {detail.content.input.asset_sha256}
          </p>
          <p>
            制作请求{detail.content.input.preparation_version_id} ·{" "}
            {detail.content.input.preparation_content_hash}
          </p>
          <Button onClick={go}>回本分集装配明确选用</Button>
        </details>
      )}
    </section>
  );
}
