import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import type { StoryWorkshopAdapter } from "./story-workshop-adapter";
import {
  createInitialStoryWorkshopMachine,
  unavailableMessage,
  updateDraft,
  type StoryDisposition,
  type StoryWorkshopContext,
  type StoryWorkshopMachine,
} from "./story-workshop-model";

interface StoryWorkshopActionsProps {
  context: StoryWorkshopContext;
  openQuestionIds: string[];
  unresolvedConflictIds: string[];
  adapter: StoryWorkshopAdapter;
}

export function StoryWorkshopActions({
  context,
  openQuestionIds,
  unresolvedConflictIds,
  adapter,
}: StoryWorkshopActionsProps) {
  const sourceAcceptedVersionId = context.manifest?.data.head.accepted_version_id ?? null;
  const storyVersionId = context.story?.id ?? null;
  const storyContentHash = context.story?.content_hash ?? null;
  const storySourceVersionId =
    context.story?.content.source_scope.source_manifest_version_id ?? null;
  const initialMachine = useMemo(
    () => createInitialStoryWorkshopMachine(context),
    [
      context.manifest,
      context.story,
      context.storyRole,
      sourceAcceptedVersionId,
      storyContentHash,
      storySourceVersionId,
      storyVersionId,
    ],
  );
  const [machine, setMachine] = useState<StoryWorkshopMachine>(initialMachine);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [draftFields, setDraftFields] = useState({
    title: "",
    logline: "",
    notes: "",
  });

  useEffect(() => {
    setMachine(initialMachine);
    setDraftFields({
      title: "",
      logline: "",
      notes: "",
    });
  }, [initialMachine]);

  const disposedQuestionIds = new Set(
    machine.dispositions
      .filter((item) => item.target_type === "question")
      .map((item) => item.target_id),
  );
  const disposedConflictIds = new Set(
    machine.dispositions
      .filter((item) => item.target_type === "conflict")
      .map((item) => item.target_id),
  );
  const pendingQuestions = openQuestionIds.filter((id) => !disposedQuestionIds.has(id)).length;
  const pendingConflicts = unresolvedConflictIds.filter(
    (id) => !disposedConflictIds.has(id),
  ).length;
  const readyToPrepare =
    machine.draftSaved &&
    machine.sourceVerified &&
    pendingQuestions === 0 &&
    pendingConflicts === 0;
  const cannotEdit = Boolean(
    machine.unavailable && machine.unavailable !== "trusted_backend_missing",
  );

  async function runAction(name: string, action: () => Promise<void>) {
    setBusyAction(name);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  const recordFirst = async (targetType: StoryDisposition["target_type"], ids: string[]) => {
    const target_id =
      targetType === "question"
        ? ids.find((id) => !disposedQuestionIds.has(id))
        : ids.find((id) => !disposedConflictIds.has(id));
    if (!target_id) return;
    const next = await adapter.recordDisposition(machine, {
      target_type: targetType,
      target_id,
      decision: targetType === "question" ? "deferred" : "resolved",
      note:
        targetType === "question"
          ? "先记下来，稍后编剧再看，不算正式通过。"
          : "先记下来，正式关闭需要审阅通过。",
    });
    setMachine(next);
  };

  const saveDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction("save", async () => {
      const result = await adapter.saveDraft(
        machine,
        {
          title: draftFields.title.trim() || machine.draft?.title,
          logline: draftFields.logline.trim() || machine.draft?.logline,
          notes: draftFields.notes,
        },
        { ifMatch: machine.etag },
      );
      setMachine(result.machine);
    });
  };

  return (
    <section
      className="story-action-panel"
      aria-labelledby="story-action-title"
      aria-describedby="story-action-canon-boundary"
    >
      <header>
        <span className="section-caption">本机草稿</span>
        <h4 id="story-action-title">整理本机草稿</h4>
        <p id="story-action-canon-boundary">
          上方三个版本是已保存的稿。下面只改本机草稿，不会当成已通过的设定。
        </p>
      </header>

      <div className="story-stepper" aria-label="操作顺序">
        {[
          ["verify_sources", "核对来源"],
          ["edit_draft", "编辑草稿"],
          ["resolve_review", "处理问题"],
          ["prepare_g2", "准备审阅"],
        ].map(([step, label], index) => (
          <span
            key={step}
            className={machine.currentStep === step ? "active" : undefined}
            aria-current={machine.currentStep === step ? "step" : undefined}
          >
            {index + 1}. {label}
          </span>
        ))}
      </div>

      <p className={`story-action-message ${machine.status}`} role="status" aria-live="polite">
        {machine.message}
      </p>

      {machine.unavailable && machine.unavailable !== "trusted_backend_missing" && (
        <p className="story-action-error" role="alert">
          {unavailableMessage(machine.unavailable)}
        </p>
      )}

      <button
        type="button"
        className="secondary-button"
        disabled={cannotEdit || busyAction !== null || machine.sourceVerified}
        onClick={() =>
          void runAction("verify", async () => {
            const result = await adapter.verifySources(machine);
            setMachine(result.machine);
          })
        }
      >
        {busyAction === "verify" ? "正在核对来源..." : "核对已确认的原文"}
      </button>

      <form className="story-draft-editor" onSubmit={saveDraft}>
        <label htmlFor="story-draft-title">草稿标题</label>
        <input
          id="story-draft-title"
          value={draftFields.title}
          placeholder={machine.draft?.title ?? "输入本地草稿标题"}
          disabled={cannotEdit}
          onChange={(event) => {
            setDraftFields((current) => ({ ...current, title: event.target.value }));
            setMachine((current) => updateDraft(current, { title: event.target.value }));
          }}
        />
        <label htmlFor="story-draft-logline">草稿梗概</label>
        <textarea
          id="story-draft-logline"
          rows={3}
          value={draftFields.logline}
          placeholder={machine.draft?.logline ?? "输入本地草稿梗概"}
          disabled={cannotEdit}
          onChange={(event) => {
            setDraftFields((current) => ({ ...current, logline: event.target.value }));
            setMachine((current) => updateDraft(current, { logline: event.target.value }));
          }}
        />
        <label htmlFor="story-draft-notes">编剧备注</label>
        <textarea
          id="story-draft-notes"
          rows={3}
          value={draftFields.notes}
          disabled={cannotEdit}
          onChange={(event) => {
            setDraftFields((current) => ({ ...current, notes: event.target.value }));
            setMachine((current) => updateDraft(current, { notes: event.target.value }));
          }}
        />
        <button
          type="submit"
          className="secondary-button"
          disabled={cannotEdit || busyAction !== null || !machine.sourceVerified}
        >
          {busyAction === "save" ? "正在保存草稿..." : "保存本地草稿"}
        </button>
      </form>

      <div className="story-disposition-actions">
        <button
          type="button"
          disabled={cannotEdit || busyAction !== null || pendingQuestions === 0}
          onClick={() =>
            void runAction("question", async () => {
              await recordFirst("question", openQuestionIds);
            })
          }
        >
          处置 1 个开放问题
        </button>
        <button
          type="button"
          disabled={cannotEdit || busyAction !== null || pendingConflicts === 0}
          onClick={() =>
            void runAction("conflict", async () => {
              await recordFirst("conflict", unresolvedConflictIds);
            })
          }
        >
          处置 1 个冲突
        </button>
      </div>

      <dl className="story-action-readiness">
        <div>
          <dt>待处置问题</dt>
          <dd>{pendingQuestions}</dd>
        </div>
        <div>
          <dt>待处置冲突</dt>
          <dd>{pendingConflicts}</dd>
        </div>
        <div>
          <dt>草稿状态</dt>
          <dd>{machine.draftSaved ? "已保存" : "未保存"}</dd>
        </div>
      </dl>

      <button
        type="button"
        className="accent-button review-submit"
        disabled={!readyToPrepare || busyAction !== null}
        onClick={() =>
          void runAction("prepare", async () => {
            const result = await adapter.prepareG2Package(machine, { ifMatch: machine.etag });
            setMachine(result.machine);
          })
        }
      >
        {busyAction === "prepare" ? "正在准备审阅材料..." : "准备审阅材料（尚未开放）"}
      </button>
      <details className="inline-technical-detail">
        <summary>技术详情</summary>
        <code>{machine.etag ?? "无版本标记"}</code>
      </details>
      <small className="trusted-backend-note">现在还不能真正提交或签署，只会留下本机状态。</small>
    </section>
  );
}
