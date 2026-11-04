import { useCallback, useEffect, useRef, useState } from "react";
import {
  pendingRevisionMatches,
  revisionFailure,
  revisionMatches,
  revisionPreservesHistory,
  revisionScopeMatches,
  sameRevisionValue,
  type DraftReviewRevisionData,
  type DraftReviewRevisionGateway,
  type DraftReviewRevisionScopeData,
  type DraftReviewRevisionSource,
  type PendingRevision,
} from "./adapters/draftReviewRevision";
import {
  parsePendingRevision,
  readPendingRevision,
  readSetAsideRevisions,
  revisionRecoveryKey,
  setAsidePendingRevision,
} from "./adapters/draftReviewRevisionRecovery";

export function useDraftReviewRevision(
  job: DraftReviewRevisionSource,
  gateway: DraftReviewRevisionGateway,
) {
  const key = revisionRecoveryKey(job);
  const [data, setData] = useState<DraftReviewRevisionData | null>(null);
  const [scope, setScope] = useState<DraftReviewRevisionScopeData | null>(null);
  const [pending, setPending] = useState(() => readPendingRevision(key));
  const [setAside, setSetAside] = useState(() => readSetAsideRevisions(job));
  const [confirmed, setConfirmed] = useState<PendingRevision | null>(null);
  const [busy, setBusy] = useState(false);
  const [reliable, setReliable] = useState(false);
  const [notice, setNotice] = useState("");
  const currentJob = useRef(job);
  currentJob.current = job;
  const live = useRef({ active: true, busy: false, epoch: 0 });
  const trusted = useRef<{ key: string; data: DraftReviewRevisionData | null }>({
    key,
    data: null,
  });
  const accept = useCallback(
    (value: DraftReviewRevisionData, intent: PendingRevision | null | undefined) => {
      if (
        !revisionMatches(value, currentJob.current) ||
        (trusted.current.key === key &&
          trusted.current.data &&
          !revisionPreservesHistory(trusted.current.data, value))
      )
        return false;
      const snapshot: DraftReviewRevisionData = JSON.parse(JSON.stringify(value));
      trusted.current = { key, data: snapshot };
      setData(snapshot);
      setReliable(true);
      if (intent && pendingRevisionMatches(value, intent)) {
        try {
          const owner = readPendingRevision(key);
          if (
            owner === undefined ||
            (owner !== null && JSON.stringify(owner) !== JSON.stringify(intent))
          ) {
            setPending(owner);
            setNotice("较早原提交已读回；当前另一个恢复标识仍保留，请继续核对当前提交。");
            return true;
          }
          if (owner !== null) localStorage.removeItem(key);
          setConfirmed(intent);
          setPending(null);
          setNotice("原手工修改提交已保存并核对。记录仅为人工修改与复核证据。");
        } catch {
          setPending(undefined);
          setNotice("原提交已读回，但本机恢复记录无法更新，已暂停新提交。");
        }
      }
      return true;
    },
    [key],
  );
  const load = useCallback(async () => {
    const state = live.current;
    if (state.busy) return;
    const ticket = ++state.epoch;
    state.busy = true;
    setBusy(true);
    setNotice("");
    const job = currentJob.current;
    try {
      const [history, selection] = await Promise.all([
        gateway.listDraftReviewRevisionPlans(job.project_id, job.episode_id, job.operation_id),
        gateway.getDraftReviewRevisionScope(job.project_id, job.episode_id, job.operation_id),
      ]);
      if (!state.active || state.epoch !== ticket) return;
      const stored = readPendingRevision(key);
      setPending(stored);
      setSetAside(readSetAsideRevisions(job));
      const historyReady = history.kind === "FOUND" && accept(history.receipt.data, stored);
      const scopeReady =
        historyReady &&
        history.kind === "FOUND" &&
        selection.kind === "FOUND" &&
        revisionScopeMatches(selection.receipt.data, job) &&
        sameRevisionValue(selection.receipt.data.source, history.receipt.data.source);
      if (!historyReady) {
        setData(trusted.current.key === key ? trusted.current.data : null);
        setReliable(false);
        setNotice(
          history.kind === "FOUND"
            ? "新读取的记录未保持原有不可变历史，已有证据仍保留，新提交已暂停。请重新读取核对。"
            : revisionFailure(history),
        );
      }
      setScope(scopeReady && selection.kind === "FOUND" ? selection.receipt.data : null);
      if (
        historyReady &&
        history.kind === "FOUND" &&
        stored &&
        !pendingRevisionMatches(history.receipt.data, stored)
      )
        setNotice("原提交尚未读回。可只读核对；明确重试时会沿用原标识与全部内容。");
      else if (historyReady && !scopeReady && !stored)
        setNotice("已读取历史，原片段范围暂不可可靠读取，不能建立新计划。");
    } catch {
      if (state.active && state.epoch === ticket) {
        setData(trusted.current.key === key ? trusted.current.data : null);
        setReliable(false);
        setScope(null);
        setNotice(revisionFailure());
      }
    } finally {
      if (state.active && state.epoch === ticket) {
        state.busy = false;
        setBusy(false);
      }
    }
  }, [accept, gateway, key]);
  useEffect(() => {
    const state = live.current;
    state.active = true;
    state.busy = false;
    if (trusted.current.key !== key) trusted.current = { key, data: null };
    setData(trusted.current.data);
    setReliable(false);
    setScope(null);
    setConfirmed(null);
    setPending(readPendingRevision(key));
    setSetAside(readSetAsideRevisions(currentJob.current));
    void load();
    return () => {
      state.active = false;
      state.epoch++;
      state.busy = false;
    };
  }, [load, key]);
  const submit = async (intent: PendingRevision): Promise<boolean> => {
    const state = live.current;
    if (state.busy || !data || !parsePendingRevision(intent)) return false;
    const stored = readPendingRevision(key);
    if (
      stored === undefined ||
      readSetAsideRevisions(currentJob.current) === undefined ||
      (stored === null && !reliable) ||
      (stored !== null && JSON.stringify(stored) !== JSON.stringify(intent))
    ) {
      setPending(stored);
      setNotice("本机恢复记录尚未核对，不能替换为另一条提交。");
      return false;
    }
    // Retry is an explicit action with the same command. Never generate a replacement ID here.
    const ticket = ++state.epoch;
    state.busy = true;
    setBusy(true);
    setNotice("");
    try {
      localStorage.setItem(key, JSON.stringify(intent));
      setPending(intent);
    } catch {
      state.busy = false;
      setBusy(false);
      setPending(undefined);
      setNotice("无法保存本机恢复记录，未发送请求。请恢复本地存储后重新打开。");
      return false;
    }
    const job = currentJob.current;
    try {
      const result =
        intent.kind === "create"
          ? await gateway.createDraftReviewRevisionPlan(
              job.project_id,
              job.episode_id,
              job.operation_id,
              intent.command,
            )
          : intent.kind === "approve"
            ? await gateway.approveDraftReviewRevisionPlan(
                job.project_id,
                job.episode_id,
                job.operation_id,
                intent.planId,
                intent.command,
              )
            : intent.kind === "attach"
              ? await gateway.attachDraftReviewRevisionCandidate(
                  job.project_id,
                  job.episode_id,
                  job.operation_id,
                  intent.planId,
                  intent.command,
                )
              : await gateway.recheckDraftReviewRevisionCandidate(
                  job.project_id,
                  job.episode_id,
                  job.operation_id,
                  intent.planId,
                  intent.candidateId,
                  intent.command,
                );
      if (!state.active || state.epoch !== ticket) return false;
      if (
        result.kind === "FOUND" &&
        accept(result.receipt.data, intent) &&
        pendingRevisionMatches(result.receipt.data, intent)
      )
        return true;
      // A generic 4xx may be a failed post-commit history read, so it cannot
      // establish that nothing was saved. Preserve the exact durable intent.
      setReliable(false);
      setNotice(revisionFailure(result));
      return false;
    } catch {
      if (state.active && state.epoch === ticket) {
        setReliable(false);
        setNotice(revisionFailure());
      }
      return false;
    } finally {
      if (state.active && state.epoch === ticket) {
        state.busy = false;
        setBusy(false);
      }
    }
  };
  const putAside = async (): Promise<boolean> => {
    if (live.current.busy || !pending) return false;
    const job = currentJob.current;
    if (!setAsidePendingRevision(job, pending)) {
      setPending(readPendingRevision(key));
      setSetAside(readSetAsideRevisions(job));
      setNotice("未能可靠保留并读回本机原提交证据，原提交仍待核对。请恢复本地存储后重试。");
      return false;
    }
    setPending(null);
    setSetAside(readSetAsideRevisions(job));
    setReliable(false);
    await load();
    return true;
  };
  return {
    data,
    scope,
    pending,
    setAside,
    confirmed,
    busy,
    reliable,
    notice,
    load,
    submit,
    putAside,
  };
}
