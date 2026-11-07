import { useEffect, useRef, useState } from "react";
import type { GenerationFailurePolicy } from "@aijian/contracts/generation-failure-policy";
import type { FilmProject } from "../film/project";
import {
  GenerationFailurePolicyView,
  type FailurePolicyViewState,
} from "./GenerationFailurePolicyView";

function validPolicy(value: GenerationFailurePolicy): boolean {
  return (
    !!value &&
    Object.keys(value).length === 4 &&
    value.scope === "GROK_VIDEO_SUBMIT_FAILURES" &&
    Number.isSafeInteger(value.revision) &&
    (value.state === "UNCONFIGURED"
      ? value.revision === 0 && value.failure_limit === null
      : value.state === "CONFIGURED" &&
        value.revision > 0 &&
        Number.isInteger(value.failure_limit) &&
        value.failure_limit !== null &&
        value.failure_limit >= 0 &&
        value.failure_limit <= 1000)
  );
}
export function useGenerationFailurePolicy(
  film: FilmProject | null,
  current: () => FilmProject | null,
) {
  const live = useRef(current);
  live.current = current;
  const lifetime = useRef(0),
    mounted = useRef(true),
    working = useRef(false);
  const target = useRef<{ filmId: string; projectId: string } | null>(null);
  const policy = useRef<GenerationFailurePolicy | null>(null);
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false);
  const [state, setState] = useState<FailurePolicyViewState>({ kind: "loading" });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lifetime.current++;
    };
  }, []);
  function close() {
    lifetime.current++;
    target.current = null;
    policy.current = null;
    working.current = false;
    setOpened(false);
    setBusy(false);
  }
  useEffect(() => {
    const captured = target.current;
    if (captured && (film?.id !== captured.filmId || film?.backendProjectId !== captured.projectId))
      close();
  }, [film?.id, film?.backendProjectId]);
  function valid(attempt: number) {
    const captured = target.current,
      actual = live.current();
    return (
      mounted.current &&
      attempt === lifetime.current &&
      !!captured &&
      actual?.id === captured.filmId &&
      actual.backendProjectId === captured.projectId
    );
  }
  async function read(message?: string) {
    const attempt = ++lifetime.current,
      captured = target.current;
    if (!captured) return;
    working.current = true;
    setBusy(true);
    policy.current = null;
    setState({ kind: "loading" });
    try {
      const result = await window.aijian!.getGenerationFailurePolicy!(captured.projectId);
      if (!valid(attempt)) return;
      if (result.kind !== "POLICY" || !validPolicy(result.policy)) {
        setState({
          kind: "error",
          message:
            result.kind === "FAILED" && result.code === "PROJECT_NOT_FOUND"
              ? "找不到本集关联的作品，暂时不能配置。"
              : "上限暂时没有读到，请重新核对。",
        });
        return;
      }
      policy.current = result.policy;
      setState({ kind: "ready", limit: result.policy.failure_limit, message });
    } catch {
      if (valid(attempt)) setState({ kind: "error", message: "上限暂时没有读到，请重新核对。" });
    } finally {
      if (valid(attempt)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  function open() {
    lifetime.current++;
    policy.current = null;
    working.current = false;
    setBusy(false);
    setOpened(true);
    const actual = live.current();
    target.current = actual ? { filmId: actual.id, projectId: actual.backendProjectId } : null;
    if (
      !window.aijian?.getGenerationFailurePolicy ||
      !window.aijian.configureGenerationFailurePolicy
    ) {
      setState({ kind: "unsupported" });
      return;
    }
    if (!actual || !/^prj_[0-9a-f]{32}$/.test(actual.backendProjectId)) {
      setState({ kind: "error", message: "本集尚未关联可配置的作品，不能保存上限。" });
      return;
    }
    void read();
  }
  async function save(limit: number, capturedAttempt: number) {
    if (capturedAttempt !== lifetime.current) return;
    const before = policy.current,
      captured = target.current,
      attempt = lifetime.current;
    if (
      working.current ||
      !before ||
      !captured ||
      !valid(attempt) ||
      !Number.isInteger(limit) ||
      limit < 0 ||
      limit > 1000
    )
      return;
    working.current = true;
    setBusy(true);
    try {
      const result = await window.aijian!.configureGenerationFailurePolicy!(captured.projectId, {
        expected_revision: before.revision,
        failure_limit: limit,
      });
      if (!valid(attempt)) return;
      if (
        result.kind === "POLICY" &&
        validPolicy(result.policy) &&
        result.policy.state === "CONFIGURED" &&
        result.policy.revision > before.revision &&
        result.policy.failure_limit === limit
      ) {
        policy.current = result.policy;
        setState({ kind: "ready", limit, message: "上限已保存。" });
      } else if (result.kind === "FAILED" && result.code === "POLICY_CHANGED") {
        await read("设置已被修改，请核对已保存的值，再次提交你的上限。");
      } else {
        policy.current = null;
        setState({
          kind: "error",
          message:
            result.kind === "FAILED" && result.code === "PROJECT_NOT_FOUND"
              ? "找不到本集关联的作品，暂时不能保存。"
              : "保存结果尚未确认，请重新核对。不要重复提交。",
        });
      }
    } catch {
      if (valid(attempt)) {
        policy.current = null;
        setState({ kind: "error", message: "保存结果尚未确认，请重新核对。不要重复提交。" });
      }
    } finally {
      if (valid(attempt)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  const displayedAttempt = lifetime.current;
  return {
    open,
    view: opened ? (
      <GenerationFailurePolicyView
        key={`${target.current?.filmId}:${target.current?.projectId}`}
        state={state}
        busy={busy}
        canRefresh={
          !!window.aijian?.getGenerationFailurePolicy &&
          /^prj_[0-9a-f]{32}$/.test(target.current?.projectId ?? "")
        }
        onClose={() => {
          if (displayedAttempt === lifetime.current) close();
        }}
        onRefresh={() => {
          if (
            displayedAttempt === lifetime.current &&
            !working.current &&
            target.current &&
            /^prj_[0-9a-f]{32}$/.test(target.current.projectId)
          )
            void read();
        }}
        onSave={(limit) => void save(limit, displayedAttempt)}
      />
    ) : null,
  };
}
