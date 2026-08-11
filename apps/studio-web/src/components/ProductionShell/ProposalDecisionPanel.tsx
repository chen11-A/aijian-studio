import { useEffect, useRef, useState } from "react";

import type {
  ArtifactProposalDraftAcceptanceInput,
  ArtifactProposalRejectionInput,
  ProposalDecisionCapability,
} from "../../api/studio";
import {
  type DecisionOutcome,
  ProposalAcceptConfirmation,
  ProposalDecisionOutcomeView,
  ProposalRejectionForm,
} from "./ProposalDecisionViews";

interface ProposalDecisionPanelProps {
  projectId: string;
  proposalId: string;
  targetArtifactType: string;
  capability?: ProposalDecisionCapability;
  onRefresh(): void;
}

type Mode = "idle" | "accept" | "reject";
type PendingDecision =
  | { kind: "accept"; input: ArtifactProposalDraftAcceptanceInput }
  | { kind: "reject"; input: ArtifactProposalRejectionInput };

function useDecisionViewport(): boolean {
  const readViewport = () => (typeof window === "undefined" ? false : window.innerWidth > 480);
  const [allowed, setAllowed] = useState(readViewport);
  useEffect(() => {
    const update = () => setAllowed(readViewport());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return allowed;
}

export function ProposalDecisionPanel({
  projectId,
  proposalId,
  targetArtifactType,
  capability,
  onRefresh,
}: ProposalDecisionPanelProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  const inFlight = useRef(false);
  const pending = useRef<PendingDecision | null>(null);
  const decisionViewport = useDecisionViewport();

  if (!capability || !decisionViewport) return null;
  if (targetArtifactType !== "SourceExtraction") {
    return <p className="proposal-decision-unavailable">当前切片仅支持来源提取提案的决定操作。</p>;
  }

  const submit = async (decision: PendingDecision) => {
    if (inFlight.current) return;
    inFlight.current = true;
    pending.current = decision;
    setBusy(true);
    setOutcome(null);
    try {
      if (decision.kind === "accept") {
        const result = await capability.acceptAsDraft(projectId, proposalId, decision.input);
        if (result.kind === "REMOTE_UNKNOWN") {
          setOutcome({ kind: "unknown" });
          return;
        }
        if (result.kind === "DEFINITE_SERVER_ERROR") {
          pending.current = null;
          setOutcome({
            kind: "definite-error",
            status: result.status,
            code: result.code,
            requestId: result.request_id,
          });
          return;
        }
        pending.current = null;
        setOutcome({
          kind: "accepted",
          versionId: result.receipt.data.draft_version_id,
          actorId: result.receipt.data.actor_id,
          replayed: result.receipt.data.replayed,
        });
        return;
      }

      const result = await capability.reject(projectId, proposalId, decision.input);
      if (result.kind === "REMOTE_UNKNOWN") {
        setOutcome({ kind: "unknown" });
        return;
      }
      if (result.kind === "DEFINITE_SERVER_ERROR") {
        pending.current = null;
        setOutcome({
          kind: "definite-error",
          status: result.status,
          code: result.code,
          requestId: result.request_id,
        });
        return;
      }
      pending.current = null;
      setOutcome({
        kind: "rejected",
        reason: result.receipt.data.reason_code,
        actorId: result.receipt.data.actor_id,
        replayed: result.receipt.data.replayed,
      });
    } catch {
      setOutcome({ kind: "unknown" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (outcome) {
    return (
      <ProposalDecisionOutcomeView
        outcome={outcome}
        busy={busy}
        onRetry={() => pending.current && void submit(pending.current)}
        onRefresh={onRefresh}
      />
    );
  }

  if (mode === "accept") {
    return (
      <ProposalAcceptConfirmation
        busy={busy}
        onCancel={() => setMode("idle")}
        onConfirm={() =>
          void submit({
            kind: "accept",
            input: { parent_version_id: null, expected_head_revision: null },
          })
        }
      />
    );
  }

  if (mode === "reject") {
    return (
      <ProposalRejectionForm
        busy={busy}
        onCancel={() => setMode("idle")}
        onSubmit={(input) => void submit({ kind: "reject", input })}
      />
    );
  }

  return (
    <div className="proposal-decision-actions" aria-label="提案决定">
      <button type="button" className="proposal-primary-action" onClick={() => setMode("accept")}>
        接受为 DRAFT
      </button>
      <button type="button" className="proposal-reject-action" onClick={() => setMode("reject")}>
        退回并填写意见
      </button>
    </div>
  );
}
