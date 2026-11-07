import { useEffect, useRef, useState } from "react";
import type { StoryCreationFailurePolicy } from "@aijian/contracts/generation-failure-policy";
import type { FilmProject } from "../film/project";
import {
  StoryCreationFailurePolicyView,
  type StoryCreationPolicyState,
} from "./StoryCreationFailurePolicyView";
function validPolicy(value: unknown): value is StoryCreationFailurePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  return (
    Object.keys(policy).sort().join() === "failure_limit,revision,scope,state" &&
    policy.scope === "GROK_STORY_CREATION_FAILURES" &&
    Number.isSafeInteger(policy.revision) &&
    (policy.state === "UNCONFIGURED"
      ? policy.revision === 0 && policy.failure_limit === null
      : policy.state === "CONFIGURED" &&
        typeof policy.revision === "number" &&
        policy.revision > 0 &&
        typeof policy.failure_limit === "number" &&
        Number.isInteger(policy.failure_limit) &&
        policy.failure_limit >= 0 &&
        policy.failure_limit <= 1000)
  );
}
export function useStoryCreationFailurePolicy(
  film: FilmProject | null,
  current: () => FilmProject | null,
  account: { state: string; label: string },
) {
  const live = useRef({ current, account });
  live.current = { current, account };
  const epoch = useRef(0),
    mounted = useRef(true),
    working = useRef(false),
    target = useRef<{ filmId: string; projectId: string; account: string } | null>(null),
    policy = useRef<StoryCreationFailurePolicy | null>(null);
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [state, setState] = useState<StoryCreationPolicyState>({ kind: "loading" });
  const accountKey = () => JSON.stringify([live.current.account.state, live.current.account.label]);
  function close() {
    epoch.current++;
    target.current = null;
    policy.current = null;
    working.current = false;
    setOpened(false);
    setBusy(false);
  }
  useEffect(() => {
    mounted.current = true;
    const changed = () => close();
    window.addEventListener("aivora-grok-changed", changed);
    return () => {
      mounted.current = false;
      epoch.current++;
      window.removeEventListener("aivora-grok-changed", changed);
    };
  }, []);
  useEffect(() => {
    const captured = target.current;
    if (
      captured &&
      (film?.id !== captured.filmId ||
        film?.backendProjectId !== captured.projectId ||
        accountKey() !== captured.account)
    )
      close();
  }, [film?.id, film?.backendProjectId, account.state, account.label]);
  function valid(version: number) {
    const captured = target.current,
      actual = live.current.current();
    return (
      mounted.current &&
      version === epoch.current &&
      !!captured &&
      actual?.id === captured.filmId &&
      actual.backendProjectId === captured.projectId &&
      accountKey() === captured.account
    );
  }
  async function read(message?: string) {
    const version = ++epoch.current,
      captured = target.current;
    if (!captured) return;
    working.current = true;
    setBusy(true);
    policy.current = null;
    setState({ kind: "loading" });
    try {
      const result = await window.aijian!.getStoryCreationFailurePolicy!(captured.projectId);
      if (!valid(version)) return;
      if (result?.kind !== "POLICY" || !validPolicy(result.policy)) {
        setState({
          kind: "error",
          message:
            result?.kind === "FAILED" && result.code === "PROJECT_NOT_FOUND"
              ? "找不到本集关联的作品，暂时不能配置创作流程上限。"
              : "创作流程上限暂时没有读到，请重新核对。",
        });
        return;
      }
      policy.current = result.policy;
      setState({ kind: "ready", limit: result.policy.failure_limit, message });
    } catch {
      if (valid(version))
        setState({ kind: "error", message: "创作流程上限暂时没有读到，请重新核对。" });
    } finally {
      if (valid(version)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  function open() {
    epoch.current++;
    policy.current = null;
    working.current = false;
    setBusy(false);
    setOpened(true);
    const actual = live.current.current();
    target.current = actual
      ? { filmId: actual.id, projectId: actual.backendProjectId, account: accountKey() }
      : null;
    if (
      !window.aijian?.getStoryCreationFailurePolicy ||
      !window.aijian.configureStoryCreationFailurePolicy
    ) {
      setState({ kind: "unsupported" });
      return;
    }
    if (!actual || !/^prj_[0-9a-f]{32}$/.test(actual.backendProjectId)) {
      setState({ kind: "error", message: "本集尚未关联可配置的作品，不能保存创作流程上限。" });
      return;
    }
    void read();
  }
  async function save(limit: number, capturedEpoch: number) {
    if (capturedEpoch !== epoch.current) return;
    const before = policy.current,
      captured = target.current,
      version = epoch.current;
    if (
      working.current ||
      !before ||
      !captured ||
      !valid(version) ||
      !Number.isInteger(limit) ||
      limit < 0 ||
      limit > 1000
    )
      return;
    working.current = true;
    setBusy(true);
    try {
      const result = await window.aijian!.configureStoryCreationFailurePolicy!(captured.projectId, {
        expected_revision: before.revision,
        failure_limit: limit,
      });
      if (!valid(version)) return;
      if (
        result?.kind === "POLICY" &&
        validPolicy(result.policy) &&
        result.policy.state === "CONFIGURED" &&
        result.policy.revision === before.revision + 1 &&
        result.policy.failure_limit === limit
      ) {
        policy.current = result.policy;
        setState({ kind: "ready", limit, message: "创作流程上限已保存。" });
      } else if (result?.kind === "FAILED" && result.code === "POLICY_CHANGED") {
        await read("设置已被修改，请核对已保存的值，再次提交你的创作流程上限。");
      } else {
        policy.current = null;
        setState({
          kind: "error",
          message:
            result?.kind === "FAILED" && result.code === "PROJECT_NOT_FOUND"
              ? "找不到本集关联的作品，暂时不能保存。"
              : "创作流程上限的保存结果尚未确认，请重新核对。不要重复提交。",
        });
      }
    } catch {
      if (valid(version)) {
        policy.current = null;
        setState({
          kind: "error",
          message: "创作流程上限的保存结果尚未确认，请重新核对。不要重复提交。",
        });
      }
    } finally {
      if (valid(version)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  const displayedEpoch = epoch.current;
  return {
    open,
    view: opened ? (
      <StoryCreationFailurePolicyView
        key={`${target.current?.filmId}:${target.current?.projectId}:${target.current?.account}`}
        state={state}
        busy={busy}
        canRefresh={
          !!window.aijian?.getStoryCreationFailurePolicy &&
          /^prj_[0-9a-f]{32}$/.test(target.current?.projectId ?? "")
        }
        onClose={() => {
          if (displayedEpoch === epoch.current) close();
        }}
        onRefresh={() => {
          if (
            displayedEpoch === epoch.current &&
            !working.current &&
            target.current &&
            /^prj_[0-9a-f]{32}$/.test(target.current.projectId)
          )
            void read();
        }}
        onSave={(limit) => void save(limit, displayedEpoch)}
      />
    ) : null,
  };
}
