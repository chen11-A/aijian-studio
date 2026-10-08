import type { StudioTransport } from "../../api/studio";
import {
  newScriptId,
  readAcceptedSourceBinding,
  type AcceptedSourceBinding,
  type ScriptScene,
} from "./episodeScript";

export type AcceptedSummary = {
  summary: string;
  binding: AcceptedSourceBinding;
  contentHash: string;
};
export type SummaryRead = { kind: "FOUND"; value: AcceptedSummary } | { kind: "EMPTY" | "UNKNOWN" };
export type SummaryGateway = Required<
  Pick<StudioTransport, "getSourceExtraction" | "getSourceProposalAcceptanceForVersion">
>;

/** Read only: an approved proposal's current version, never an unaccepted model candidate. */
export async function readAcceptedSummary(
  gateway: SummaryGateway,
  projectId: string,
): Promise<SummaryRead> {
  try {
    const latest = await gateway.getSourceExtraction(projectId);
    const binding = await readAcceptedSourceBinding(
      {
        getSourceExtraction: async () => latest,
        getSourceProposalAcceptanceForVersion: gateway.getSourceProposalAcceptanceForVersion,
      },
      projectId,
    );
    if (binding.kind === "UNBOUND") return { kind: "EMPTY" };
    if (binding.kind !== "BOUND" || latest.kind !== "FOUND") return { kind: "UNKNOWN" };
    const summary = latest.receipt.data.version.content.summary;
    if (typeof summary !== "string" || !summary.trim() || [...summary].length > 10_000)
      return { kind: "UNKNOWN" };
    return {
      kind: "FOUND",
      value: {
        summary,
        binding: binding.binding,
        contentHash: latest.receipt.data.version.content_hash,
      },
    };
  } catch {
    return { kind: "UNKNOWN" };
  }
}

export function sameAcceptedSummary(first: AcceptedSummary, second: AcceptedSummary): boolean {
  return (
    first.binding.sourceVersionId === second.binding.sourceVersionId &&
    first.binding.acceptanceId === second.binding.acceptanceId &&
    first.contentHash === second.contentHash &&
    first.summary === second.summary
  );
}

/** Explicit starting material, not a generated screenplay or an automatically saved script. */
export function summaryStartingScene(summary: string): ScriptScene | null {
  const sceneId = newScriptId("scn");
  const blockId = newScriptId("sblk");
  if (!sceneId || !blockId || !summary.trim() || [...summary].length > 10_000) return null;
  return {
    scene_id: sceneId,
    ordinal: 1,
    heading: "来源摘要 · 待改编",
    blocks: [
      {
        block_id: blockId,
        ordinal: 1,
        kind: "ACTION",
        text: summary,
        speaker: null,
        delivery: null,
      },
    ],
  };
}
