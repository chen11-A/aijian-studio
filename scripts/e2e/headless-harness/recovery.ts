import type {
  AijianDesktopBridge,
  FakeTimelineRunCapability,
  FakeTimelineRunCreateInput,
  ProposalRunCapability,
  ProposalRunCreateInput,
} from "../../../apps/studio-web/src/api/studio";
import {
  createFakeTimelineRunOperationJournal,
  submitFakeTimelineRunOperation,
} from "../../../apps/studio-web/src/fake-timeline-run-operation-journal";
import type { FakeTimelineRunSubmissionResult } from "../../../apps/studio-web/src/fake-timeline-run-operation-journal";
import {
  createProposalRunOperationJournal,
  submitProposalRunOperation,
} from "../../../apps/studio-web/src/proposal-run-operation-journal";
import type { ProposalRunSubmissionResult } from "../../../apps/studio-web/src/proposal-run-operation-journal";

type FakeTimelineRequest = {
  kind: "fake-timeline";
  projectId: string;
  input: FakeTimelineRunCreateInput;
};
type ProposalRequest = {
  kind: "proposal";
  projectId: string;
  input: ProposalRunCreateInput;
};
export type C20HeadlessRunRequest = FakeTimelineRequest | ProposalRequest;
export type C20HeadlessRunResult = FakeTimelineRunSubmissionResult | ProposalRunSubmissionResult;

declare global {
  interface Window {
    c20HeadlessRun?: (request: C20HeadlessRunRequest) => Promise<C20HeadlessRunResult>;
  }
}

function bridge(): Pick<AijianDesktopBridge, "createFakeTimelineRun" | "createProposalRun"> {
  if (!window.aijian) throw new Error("C20 headless recovery requires the desktop bridge");
  return window.aijian;
}

function fakeTimelineCapability(): FakeTimelineRunCapability {
  const desktop = bridge();
  return { create: (projectId, command) => desktop.createFakeTimelineRun(projectId, command) };
}

function proposalCapability(): ProposalRunCapability {
  const desktop = bridge();
  return { create: (projectId, command) => desktop.createProposalRun(projectId, command) };
}

/** Test-only renderer entry. It composes the real journals with the typed preload bridge. */
window.c20HeadlessRun = async (request) => {
  if (request.kind === "fake-timeline") {
    return submitFakeTimelineRunOperation(
      createFakeTimelineRunOperationJournal(window.localStorage),
      fakeTimelineCapability(),
      request.projectId,
      request.input,
    );
  }
  return submitProposalRunOperation(
    createProposalRunOperationJournal(window.localStorage),
    proposalCapability(),
    request.projectId,
    request.input,
  );
};
