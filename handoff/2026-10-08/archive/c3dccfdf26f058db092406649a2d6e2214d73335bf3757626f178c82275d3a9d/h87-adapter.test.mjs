import {
  acceptSourceExtractionProposal,
  queueRemoteSourceExtract,
  readRemoteSourceExtractJournal,
  readSourceExtractionAcceptance,
} from "@qa-h87/adapters/remoteSourceExtract.ts";

const projectId = `prj_${"a".repeat(32)}`;
const proposalId = `prp_${"b".repeat(32)}`;
const runId = `agr_${"c".repeat(32)}`;
const draftVersionId = `ver_${"d".repeat(32)}`;
const identity = {
  projectId,
  manifestVersionId: `ver_${"e".repeat(32)}`,
  manifestContentHash: `sha256:${"1".repeat(64)}`,
  sourceDocumentId: `src_${"f".repeat(32)}`,
  sourceBlockId: `srcb_${"a".repeat(32)}`,
  sourceBlockHash: `sha256:${"2".repeat(64)}`,
  startByte: 0,
  endByte: 20,
  connectionId: `pcn_${"b".repeat(32)}`,
  connectionRevision: 2,
  modelId: "cpa-text-model",
};
function storage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
  };
}
beforeEach(() => vi.stubGlobal("crypto", {
  randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
}));
afterEach(() => vi.unstubAllGlobals());

test("storage failure blocks remote POST", async () => {
  const create = vi.fn();
  const broken = { getItem: () => null, setItem: () => { throw Error("disk full"); } };
  await expect(queueRemoteSourceExtract({ create }, broken, identity)).resolves.toMatchObject({
    kind: "UNAVAILABLE",
  });
  expect(create).not.toHaveBeenCalled();
});

test("UNKNOWN remains on original operation and a second queue request does not POST", async () => {
  const s = storage();
  const create = vi.fn(async () => { throw Error("lost response"); });
  const capability = { create };
  const first = await queueRemoteSourceExtract(capability, s, identity);
  expect(first.kind).toBe("UNKNOWN");
  const saved = readRemoteSourceExtractJournal(s, projectId);
  expect(saved.kind).toBe("VALID");
  expect(saved.operation.operationId).toBe(first.operation.operationId);
  expect(saved.operation.status).toBe("UNKNOWN");
  const second = await queueRemoteSourceExtract(capability, s, identity);
  expect(second.kind).toBe("TRACKED");
  expect(second.operation.operationId).toBe(first.operation.operationId);
  expect(create).toHaveBeenCalledTimes(1);
});

test("manual accept persists original proposal before POST and blocks duplicate accept", async () => {
  const s = storage();
  const operation = {
    ...identity,
    operationId: "123e4567-e89b-42d3-a456-426614174000",
    status: "QUEUED",
    runId,
    rejection: null,
  };
  s.setItem(`aivora.remote-source-extract.v1.${projectId}`, JSON.stringify(operation));
  const acceptAsDraft = vi.fn(async (sentProject, sentProposal) => {
    const before = readSourceExtractionAcceptance(s, projectId, proposalId);
    expect(before.kind).toBe("VALID");
    expect(before.acceptance.status).toBe("UNKNOWN");
    expect(before.acceptance.runId).toBe(runId);
    expect(sentProject).toBe(projectId);
    expect(sentProposal).toBe(proposalId);
    return { kind: "SUCCEEDED", receipt: { data: {
      project_id: projectId, proposal_id: proposalId, draft_version_id: draftVersionId,
    } } };
  });
  const transport = { proposalDecisions: { acceptAsDraft } };
  const first = await acceptSourceExtractionProposal(
    transport, s, operation, proposalId, null, null,
  );
  expect(first).toMatchObject({ kind: "ACCEPTED", acceptance: {
    projectId, proposalId, runId, draftVersionId,
  } });
  const second = await acceptSourceExtractionProposal(
    transport, s, operation, proposalId, null, null,
  );
  expect(second.kind).toBe("TRACKED");
  expect(acceptAsDraft).toHaveBeenCalledTimes(1);
});
