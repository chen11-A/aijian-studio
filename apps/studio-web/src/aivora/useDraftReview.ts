import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftExportJob } from "./adapters/draftExport";
import {
  pendingMatches,
  reviewFailure,
  reviewMatches,
  type DraftReviewData,
  type DraftReviewGateway,
  type PendingReview,
} from "./adapters/draftReview";
import { readPendingReview } from "./adapters/draftReviewRecovery";

export function useDraftReview(job: DraftExportJob, gateway: DraftReviewGateway) {
  const key = `aivora:draft-review:pending:${job.project_id}:${job.episode_id}:${job.operation_id}`;
  const [data, setData] = useState<DraftReviewData | null>(null);
  const [pending, setPending] = useState(() => readPendingReview(key));
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState<PendingReview | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef({ active: true, busy: false, epoch: 0 });
  const accept = useCallback(
    (result: DraftReviewData, intent: PendingReview | null | undefined) => {
      if (!reviewMatches(result, job)) return false;
      setData(result);
      if (intent && pendingMatches(result, intent)) {
        setConfirmed(intent);
        try {
          localStorage.removeItem(key);
          setPending(null);
        } catch {
          setPending(undefined);
          setNotice("恢复记录无法更新，已暂停新提交。");
          return true;
        }
        setNotice("手工记录已保存并读回；仅对应原草稿版本，不代表正式批准。");
      }
      return true;
    },
    [job, key],
  );
  const load = useCallback(async () => {
    const state = live.current;
    if (state.busy) return;
    const epoch = ++state.epoch;
    state.busy = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await gateway.listDraftReviewNotes(
        job.project_id,
        job.episode_id,
        job.operation_id,
      );
      if (!state.active || state.epoch !== epoch) return;
      const stored = readPendingReview(key);
      setPending(stored);
      if (result.kind !== "FOUND" || !accept(result.receipt.data, stored)) {
        setData(null);
        setNotice(reviewFailure(result));
      } else if (stored && !pendingMatches(result.receipt.data, stored)) {
        setNotice("原提交尚未读回。可再次核对，或使用相同标识重试原提交。");
      }
    } catch {
      if (state.active) {
        setData(null);
        setNotice(reviewFailure());
      }
    } finally {
      if (state.active && state.epoch === epoch) {
        state.busy = false;
        setBusy(false);
      }
    }
  }, [accept, gateway, job, key]);
  useEffect(() => {
    const state = live.current;
    state.active = true;
    void load();
    return () => {
      state.active = false;
      state.epoch++;
      state.busy = false;
    };
  }, [load]);
  const submit = async (intent: PendingReview): Promise<boolean> => {
    const state = live.current;
    if (state.busy || pending === undefined || !data) return false;
    state.busy = true;
    const epoch = ++state.epoch;
    setBusy(true);
    setNotice("");
    try {
      localStorage.setItem(key, JSON.stringify(intent));
      setPending(intent);
    } catch {
      state.busy = false;
      setBusy(false);
      setPending(undefined);
      setNotice("无法保存本机恢复记录，未发送提交。请恢复本地存储后重开页面。");
      return false;
    }
    try {
      const result =
        intent.kind === "create"
          ? await gateway.createDraftReviewNote(
              job.project_id,
              job.episode_id,
              job.operation_id,
              intent.command,
            )
          : await gateway.resolveDraftReviewNote(
              job.project_id,
              job.episode_id,
              job.operation_id,
              intent.noteId,
              intent.command,
            );
      if (!state.active || state.epoch !== epoch) return false;
      if (
        result.kind === "FOUND" &&
        accept(result.receipt.data, intent) &&
        pendingMatches(result.receipt.data, intent)
      )
        return true;
      if (result.kind === "DEFINITE_SERVER_ERROR") {
        localStorage.removeItem(key);
        setPending(null);
      }
      setNotice(reviewFailure(result));
      return false;
    } catch {
      if (state.active) setNotice(reviewFailure());
      return false;
    } finally {
      if (state.active && state.epoch === epoch) {
        state.busy = false;
        setBusy(false);
      }
    }
  };
  return { data, pending, busy, notice, confirmed, load, submit };
}
