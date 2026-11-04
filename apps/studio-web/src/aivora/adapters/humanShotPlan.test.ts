import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ShotPlanContent,
  ShotPlanGateway,
  ShotPlanPreparation,
  ShotPlanProposal,
} from "@aijian/contracts/shot-plan";
import {
  adoptHumanShotPlan,
  buildHumanShotPlanTemplate,
  createHumanShotPlan,
  humanShotPlanContentHash,
  humanShotPlanRequest,
  readHumanShotPlanJournal,
  readHumanShotPlanPreparation,
  readHumanShotPlanProposal,
  recoverHumanShotPlan,
  reorderHumanShotPlanShots,
  validHumanShotPlanContent,
} from "./humanShotPlan";

const project = `prj_${"1".repeat(32)}`;
const episode = `ep_${"2".repeat(32)}`;
const version = (n: number) => `ver_${n.toString(16).padStart(32, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;
const operation = "11111111-1111-4111-8111-111111111111";
const request = "22222222-2222-4222-8222-222222222222";
const clean = () => true;
const receipt = <T>(data: T) => ({ data, request_id: request });
function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, raw: string) => {
      entries.set(key, raw);
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
  };
}
function proofHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (item !== null && typeof item === "object") {
      const source = item as Record<string, unknown>;
      return `{${Object.keys(source)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(source[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(item);
  };
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}
function withProofs(input: ShotPlanPreparation): ShotPlanPreparation {
  input.script_stored_content = structuredClone(input.script_content);
  input.production_brief_stored_content = structuredClone(input.production_brief_content);
  return rehashProofs(input);
}
function rehashProofs(input: ShotPlanPreparation): ShotPlanPreparation {
  input.authority.script.content_hash = proofHash(input.script_stored_content);
  input.authority.production_brief.content_hash = proofHash(input.production_brief_stored_content);
  return input;
}
function proofRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid proof fixture");
  return value as Record<string, unknown>;
}
function preparation(sceneCount = 3): ShotPlanPreparation {
  return withProofs({
    script_stored_content: {},
    production_brief_stored_content: {},
    project_id: project,
    episode_id: episode,
    authority: {
      mode: "ORIGINAL",
      script: {
        version_id: version(1),
        content_hash: hash,
        confirmation_id: `esc_${"3".repeat(32)}`,
        head_revision: 1,
      },
      production_brief: { version_id: version(2), content_hash: hash },
    },
    storyboard_base: { version_id: version(3), content_hash: hash, head_revision: 1 },
    generation_status: "UNAVAILABLE",
    script_content: {
      schema_version: "1.0.0",
      project_id: project,
      episode_id: episode,
      production_brief_version_id: version(2),
      story_bible_version_id: null,
      source_extraction_version_id: null,
      source_proposal_acceptance_id: null,
      scenes: Array.from({ length: sceneCount }, (_, i) => ({
        scene_id: `scn_${(i + 1).toString(16).padStart(32, "0")}`,
        ordinal: i + 1,
        heading: `场景 ${i + 1}`,
        blocks: Array.from({ length: 3 }, (_, j) => ({
          block_id: `sblk_${(i * 3 + j + 1).toString(16).padStart(32, "0")}`,
          ordinal: j + 1,
          kind: j === 1 ? "DIALOGUE" : "ACTION",
          text: j === 1 ? "先走吧。" : "人物走进房间。",
          speaker: j === 1 ? "阿林" : null,
          delivery: j === 1 ? "ON_SCREEN" : null,
        })),
      })),
    },
    production_brief_content: {
      schema_version: "1.0.0",
      creative_entry: { kind: "original_idea", origin_statement: "原创测试", references: [] },
      creative: {
        premise: "重逢",
        intent: "展现迟疑",
        audience: null,
        genre: null,
        style: null,
        constraints: ["人物留在安全区"],
      },
      delivery: {
        language: "中文",
        display_aspect_ratio: { num: 9, den: 16 },
        width_px: 1080,
        height_px: 1920,
        frame_rate: { num: 24, den: 1 },
      },
      duration_intent: { work_seconds: null, episode_mode: "per_episode", episode_seconds: 40 },
      budget_intent: { state: "unknown", currency: null, amount_micros: null },
      rights_declaration: { state: "unknown", statement: null },
    },
  });
}
function template(count = 7): ShotPlanContent {
  const built = buildHumanShotPlanTemplate(preparation(), count);
  if (built.kind !== "READY") throw new Error("Fixture template failed");
  return built.content;
}
async function proposal(content = template()): Promise<ShotPlanProposal> {
  return {
    version_id: version(4),
    content_hash: await humanShotPlanContentHash(content),
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content,
    author_actor_id: "local-human",
    created_at: "2026-10-08T00:00:00Z",
    generation_status: "UNAVAILABLE",
    capability_losses: [],
    adoption: null,
  };
}
function gateway(value?: ShotPlanProposal): ShotPlanGateway {
  return {
    prepareHumanShotPlan: vi.fn<ShotPlanGateway["prepareHumanShotPlan"]>(async () => ({
      kind: "PREPARED",
      receipt: receipt(preparation()),
    })),
    getShotPlanProposal: vi.fn<ShotPlanGateway["getShotPlanProposal"]>(async () =>
      value ? { kind: "FOUND", receipt: receipt(value) } : { kind: "EMPTY" },
    ),
    getShotPlanProposalVersion: vi.fn<ShotPlanGateway["getShotPlanProposalVersion"]>(async () =>
      value ? { kind: "FOUND", receipt: receipt(value) } : { kind: "REMOTE_UNKNOWN" },
    ),
    getHumanShotPlanWriteStatus: vi.fn<ShotPlanGateway["getHumanShotPlanWriteStatus"]>(
      async () => ({ kind: "STATUS", receipt: receipt({ proposal: value ?? null }) }),
    ),
    getShotPlanAdoptionStatus: vi.fn<ShotPlanGateway["getShotPlanAdoptionStatus"]>(async () => ({
      kind: "STATUS",
      receipt: receipt({
        proposal_version_id: value?.version_id ?? version(4),
        adoption: value?.adoption ?? null,
      }),
    })),
    createHumanShotPlanProposal: vi.fn<ShotPlanGateway["createHumanShotPlanProposal"]>(
      async () => ({ kind: "REMOTE_UNKNOWN" }),
    ),
    adoptHumanShotPlanProposal: vi.fn<ShotPlanGateway["adoptHumanShotPlanProposal"]>(async () => ({
      kind: "REMOTE_UNKNOWN",
    })),
  };
}
function adopted(value: ShotPlanProposal): ShotPlanProposal {
  return {
    ...structuredClone(value),
    adoption: {
      proposal_version_id: value.version_id,
      proposal_content_hash: value.content_hash,
      storyboard_version_id: version(5),
      storyboard_content_hash: hash,
      actor_id: "local-human",
      adopted_at: "2026-10-08T00:01:00Z",
    },
  };
}
vi.stubGlobal("crypto", webcrypto);
afterEach(() => vi.restoreAllMocks());

describe("HUMAN director template", () => {
  it.each([7, 11, 13])(
    "covers exact scene/block/dialogue references with %i stable identities",
    (count) => {
      const input = preparation();
      const built = buildHumanShotPlanTemplate(input, count);
      expect(built.kind).toBe("READY");
      if (built.kind !== "READY") return;
      expect(built.content.provenance).toBe("HUMAN");
      expect(built.content.shots).toHaveLength(count);
      expect(validHumanShotPlanContent(built.content, project, episode, input)).toBe(true);
      const refs = new Set(built.content.shots.flatMap((shot) => shot.script_block_ids));
      expect(refs.size).toBe(9);
      for (const shot of built.content.shots) {
        expect(shot.shot_id).toMatch(/^shp_[0-9a-f]{32}$/);
        expect(shot.composition).toContain("待人工审阅");
        expect(Number.isInteger(shot.duration_frames)).toBe(true);
        const scene = input.script_content.scenes.find((s) => s.scene_id === shot.script_scene_id);
        expect(shot.dialogue_block_ids).toEqual(
          scene?.blocks
            .filter((b) => shot.script_block_ids.includes(b.block_id) && b.kind === "DIALOGUE")
            .map((b) => b.block_id),
        );
      }
      const reordered = reorderHumanShotPlanShots(built.content.shots, 0, count - 1);
      expect(reordered.at(-1)?.shot_id).toBe(built.content.shots[0]?.shot_id);
      expect(reordered.at(-1)?.script_block_ids).toEqual(built.content.shots[0]?.script_block_ids);
      expect(reordered.map((s) => s.ordinal)).toEqual(
        Array.from({ length: count }, (_, i) => i + 1),
      );
    },
  );
  it("supports variable scenes and refuses insufficient or invalid counts and empty scenes", () => {
    expect(buildHumanShotPlanTemplate(preparation(5), 7).kind).toBe("READY");
    for (const count of [0, 2, 1001, 7.2, NaN])
      expect(buildHumanShotPlanTemplate(preparation(), count).kind).toBe("BLOCKED");
    const empty = preparation();
    empty.script_content.scenes[0]!.blocks = [];
    expect(buildHumanShotPlanTemplate(empty, 7).kind).toBe("BLOCKED");
    expect(buildHumanShotPlanTemplate(preparation(0), 7).kind).toBe("BLOCKED");
  });
  it("preserves supported rational rate and blocks unsupported rates without rounding", () => {
    const input = preparation();
    input.production_brief_content.delivery.frame_rate = { num: 30000, den: 1001 };
    const built = buildHumanShotPlanTemplate(withProofs(input), 11);
    if (built.kind !== "READY") throw new Error("Rational template failed");
    expect(built.content.timebase).toEqual({
      frame_rate: { num: 30000, den: 1001 },
      timecode_mode: "NON_DROP_FRAME",
    });
    input.production_brief_content.delivery.frame_rate = { num: 30, den: 1 };
    expect(buildHumanShotPlanTemplate(input, 7).kind).toBe("BLOCKED");
  });
});

describe("original operation journal", () => {
  it("never repeats unknown CREATE, including after restart and missing/error status", async () => {
    const port = storage();
    const api = gateway();
    const payload = humanShotPlanRequest(template(), null, "人工模板");
    expect(
      (await createHumanShotPlan(api, port, project, episode, operation, payload, clean)).kind,
    ).toBe("UNKNOWN");
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("PENDING");
    expect(
      (await createHumanShotPlan(api, port, project, episode, operation, payload, clean)).kind,
    ).toBe("BLOCKED");
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    vi.mocked(api.getHumanShotPlanWriteStatus).mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 500,
      code: "SHOT_PLAN_STORAGE_FAILED",
      request_id: request,
    });
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("PENDING");
    expect(api.createHumanShotPlanProposal).toHaveBeenCalledTimes(1);
    expect(api.adoptHumanShotPlanProposal).not.toHaveBeenCalled();
  });
  it("reconciles CREATE only through original-operation status and exact immutable version", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    const payload = humanShotPlanRequest(value.content, null, "人工模板");
    await createHumanShotPlan(api, port, project, episode, operation, payload, clean);
    expect(await recoverHumanShotPlan(api, port, project, episode)).toEqual({
      kind: "SAVED",
      proposal: value,
    });
    expect(api.getHumanShotPlanWriteStatus).toHaveBeenCalledWith(project, episode, operation);
    expect(api.getShotPlanProposalVersion).toHaveBeenCalledWith(project, episode, value.version_id);
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("EMPTY");
    expect(api.createHumanShotPlanProposal).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong scope, hash, authority, base and malformed booleans on status/exact receipts", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    await createHumanShotPlan(
      api,
      port,
      project,
      episode,
      operation,
      humanShotPlanRequest(value.content, null, "模板"),
      clean,
    );
    const wrong = structuredClone(value);
    wrong.content.authority.script.version_id = version(99);
    vi.mocked(api.getHumanShotPlanWriteStatus).mockResolvedValue({
      kind: "STATUS",
      receipt: receipt({ proposal: wrong }),
    });
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    vi.mocked(api.getHumanShotPlanWriteStatus).mockResolvedValue({
      kind: "STATUS",
      receipt: receipt({ proposal: value }),
    });
    const exact = structuredClone(value);
    exact.content.storyboard_base = null;
    vi.mocked(api.getShotPlanProposalVersion).mockResolvedValue({
      kind: "FOUND",
      receipt: receipt(exact),
    });
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("PENDING");
    const badReplay = { kind: "CREATED", receipt: receipt({ proposal: value, replayed: "false" }) };
    const fresh = storage();
    vi.mocked(api.createHumanShotPlanProposal).mockResolvedValue(badReplay as never);
    expect(
      (
        await createHumanShotPlan(
          api,
          fresh,
          project,
          episode,
          operation,
          humanShotPlanRequest(value.content, null, "模板"),
          clean,
        )
      ).kind,
    ).toBe("UNKNOWN");
  });
  it("blocks dirty commits and storage denial before transmitting", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    expect(
      (
        await createHumanShotPlan(
          api,
          port,
          project,
          episode,
          operation,
          humanShotPlanRequest(value.content, null, "模板"),
          () => false,
        )
      ).kind,
    ).toBe("BLOCKED");
    const dirty = structuredClone(value.content);
    dirty.shots[0]!.title = "修改后";
    expect(
      (await adoptHumanShotPlan(api, port, project, episode, value, operation, dirty, clean)).kind,
    ).toBe("BLOCKED");
    expect(
      (
        await adoptHumanShotPlan(
          api,
          port,
          project,
          episode,
          value,
          operation,
          value.content,
          () => false,
        )
      ).kind,
    ).toBe("BLOCKED");
    port.setItem.mockImplementation(() => {
      throw new Error("Quota denied");
    });
    expect(
      (
        await createHumanShotPlan(
          api,
          port,
          project,
          episode,
          operation,
          humanShotPlanRequest(value.content, null, "模板"),
          clean,
        )
      ).kind,
    ).toBe("BLOCKED");
    expect(api.createHumanShotPlanProposal).not.toHaveBeenCalled();
    expect(api.adoptHumanShotPlanProposal).not.toHaveBeenCalled();
  });
  it("captures latest proposal parent/revision and clears only validated safe mutation rejection", async () => {
    const value = await proposal();
    value.head_revision = 3;
    expect(humanShotPlanRequest(value.content, value, "人工修订")).toMatchObject({
      parent_version_id: value.version_id,
      expected_revision: 3,
    });
    const api = gateway();
    const port = storage();
    vi.mocked(api.createHumanShotPlanProposal).mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "SHOT_PLAN_PROPOSAL_STALE",
      request_id: request,
    });
    expect(
      (
        await createHumanShotPlan(
          api,
          port,
          project,
          episode,
          operation,
          humanShotPlanRequest(value.content, null, "模板"),
          clean,
        )
      ).kind,
    ).toBe("REJECTED");
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("EMPTY");
  });
  it("preserves unknown ADOPT across missing adoption and validates immutable adoption binding", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    await adoptHumanShotPlan(api, port, project, episode, value, operation, value.content, clean);
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    expect(
      (
        await adoptHumanShotPlan(
          api,
          port,
          project,
          episode,
          value,
          operation,
          value.content,
          clean,
        )
      ).kind,
    ).toBe("BLOCKED");
    const accepted = adopted(value);
    accepted.adoption!.proposal_content_hash = `sha256:${"b".repeat(64)}`;
    vi.mocked(api.getShotPlanAdoptionStatus).mockResolvedValue({
      kind: "STATUS",
      receipt: receipt({ proposal_version_id: value.version_id, adoption: accepted.adoption }),
    });
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    const good = adopted(value);
    vi.mocked(api.getShotPlanAdoptionStatus).mockResolvedValue({
      kind: "STATUS",
      receipt: receipt({ proposal_version_id: value.version_id, adoption: good.adoption }),
    });
    vi.mocked(api.getShotPlanProposalVersion).mockResolvedValue({
      kind: "FOUND",
      receipt: receipt(good),
    });
    expect(await recoverHumanShotPlan(api, port, project, episode)).toEqual({
      kind: "ADOPTED",
      proposal: good,
    });
    expect(api.adoptHumanShotPlanProposal).toHaveBeenCalledTimes(1);
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("EMPTY");
  });
  it("scopes pending journals to project/episode and fails closed on corrupt or unreadable records", async () => {
    const api = gateway();
    const port = storage();
    await createHumanShotPlan(
      api,
      port,
      project,
      episode,
      operation,
      humanShotPlanRequest(template(), null, "模板"),
      clean,
    );
    expect(readHumanShotPlanJournal(port, project, `ep_${"4".repeat(32)}`).kind).toBe("EMPTY");
    expect(readHumanShotPlanJournal(port, `prj_${"4".repeat(32)}`, episode).kind).toBe("EMPTY");
    port.getItem.mockReturnValue("invalid JSON");
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("BLOCKED");
    port.getItem.mockImplementation(() => {
      throw new Error("Read denied");
    });
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("BLOCKED");
  });
});

describe("commit and exact-receipt boundaries", () => {
  it("confirms successful initial CREATE and ADOPT only after exact readback", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    vi.mocked(api.createHumanShotPlanProposal).mockResolvedValue({
      kind: "CREATED",
      receipt: receipt({ proposal: value, replayed: false }),
    });
    expect(
      await createHumanShotPlan(
        api,
        port,
        project,
        episode,
        operation,
        humanShotPlanRequest(value.content, null, "人工模板"),
        clean,
      ),
    ).toEqual({ kind: "SAVED", proposal: value });
    const accepted = adopted(value);
    vi.mocked(api.adoptHumanShotPlanProposal).mockResolvedValue({
      kind: "ADOPTED",
      receipt: receipt({ proposal: accepted, replayed: false }),
    });
    vi.mocked(api.getShotPlanProposalVersion).mockResolvedValue({
      kind: "FOUND",
      receipt: receipt(accepted),
    });
    expect(
      await adoptHumanShotPlan(api, port, project, episode, value, operation, value.content, clean),
    ).toEqual({ kind: "ADOPTED", proposal: accepted });
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("EMPTY");
  });
  it("rechecks live guard after digest and after persistence before either mutation", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    const guard = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    expect(
      (
        await createHumanShotPlan(
          api,
          port,
          project,
          episode,
          operation,
          humanShotPlanRequest(value.content, null, "人工模板"),
          guard,
        )
      ).kind,
    ).toBe("BLOCKED");
    const adoptionGuard = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    expect(
      (
        await adoptHumanShotPlan(
          api,
          port,
          project,
          episode,
          value,
          operation,
          value.content,
          adoptionGuard,
        )
      ).kind,
    ).toBe("BLOCKED");
    expect(api.createHumanShotPlanProposal).not.toHaveBeenCalled();
    expect(api.adoptHumanShotPlanProposal).not.toHaveBeenCalled();
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("EMPTY");
  });
  it("keeps pending on exact read storage errors and cannot clear when storage removal fails", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    vi.mocked(api.createHumanShotPlanProposal).mockResolvedValue({
      kind: "CREATED",
      receipt: receipt({ proposal: value, replayed: false }),
    });
    vi.mocked(api.getShotPlanProposalVersion).mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 500,
      code: "SHOT_PLAN_STORAGE_FAILED",
      request_id: request,
    });
    expect(
      (
        await createHumanShotPlan(
          api,
          port,
          project,
          episode,
          operation,
          humanShotPlanRequest(value.content, null, "人工模板"),
          clean,
        )
      ).kind,
    ).toBe("UNKNOWN");
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    vi.mocked(api.getShotPlanProposalVersion).mockResolvedValue({
      kind: "FOUND",
      receipt: receipt(value),
    });
    port.removeItem.mockImplementation(() => {
      throw new Error("Remove denied");
    });
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("PENDING");
    expect(api.createHumanShotPlanProposal).toHaveBeenCalledTimes(1);
  });
  it("never treats a recovery 404 or wrong-version adoption status as safe rejection", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    await adoptHumanShotPlan(api, port, project, episode, value, operation, value.content, clean);
    vi.mocked(api.getShotPlanAdoptionStatus).mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 404,
      code: "SHOT_PLAN_NOT_FOUND",
      request_id: request,
    });
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    vi.mocked(api.getShotPlanAdoptionStatus).mockResolvedValue({
      kind: "STATUS",
      receipt: receipt({ proposal_version_id: version(90), adoption: adopted(value).adoption }),
    });
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("PENDING");
    expect(api.adoptHumanShotPlanProposal).toHaveBeenCalledTimes(1);
  });
  it("serializes same-scope concurrent commits through the persisted original journal", async () => {
    const api = gateway();
    const port = storage();
    const payload = humanShotPlanRequest(template(), null, "人工模板");
    const outcomes = await Promise.all([
      createHumanShotPlan(api, port, project, episode, operation, payload, clean),
      createHumanShotPlan(api, port, project, episode, request, payload, clean),
    ]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["BLOCKED", "UNKNOWN"]);
    expect(api.createHumanShotPlanProposal).toHaveBeenCalledTimes(1);
  });
  it("allows full 4k saved intentions but blocks reported projection loss at adoption", async () => {
    const content = template();
    content.shots[0]!.composition = "构".repeat(4000);
    const value = await proposal(content);
    value.capability_losses = [
      {
        code: "STORYBOARD_PROJECTION_LIMIT",
        severity: "BLOCKING",
        shot_id: null,
        message: "完整意图超过旧分镜投影限制。",
      },
    ];
    const api = gateway(value);
    const port = storage();
    expect((await readHumanShotPlanProposal(api, project, episode)).kind).toBe("FOUND");
    expect(
      (
        await adoptHumanShotPlan(
          api,
          port,
          project,
          episode,
          value,
          operation,
          value.content,
          clean,
        )
      ).kind,
    ).toBe("BLOCKED");
    expect(api.adoptHumanShotPlanProposal).not.toHaveBeenCalled();
  });
  it("fails closed when proof digest is unavailable while allowing synchronous template equivalence", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    vi.stubGlobal("crypto", { randomUUID: webcrypto.randomUUID.bind(webcrypto) });
    try {
      expect((await readHumanShotPlanPreparation(api, project, episode)).kind).toBe("UNKNOWN");
      expect(buildHumanShotPlanTemplate(preparation(), 7).kind).toBe("READY");
      expect((await readHumanShotPlanProposal(api, project, episode)).kind).toBe("UNKNOWN");
      expect(
        (
          await createHumanShotPlan(
            api,
            port,
            project,
            episode,
            operation,
            humanShotPlanRequest(value.content, null, "人工模板"),
            clean,
          )
        ).kind,
      ).toBe("BLOCKED");
      expect(api.createHumanShotPlanProposal).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("crypto", webcrypto);
    }
  });
});

describe("authoritative preparation variants and failure injection", () => {
  it("preserves adapted authority, exact accepted source spans and declared brief fields", () => {
    const input = preparation();
    input.authority = {
      ...input.authority,
      mode: "ADAPTED",
      source_extraction: { version_id: version(8), content_hash: hash },
      source_proposal_acceptance_id: `pda_${"6".repeat(32)}`,
      source_span_ids: [`spn_${"7".repeat(32)}`],
    };
    input.script_content.source_extraction_version_id = version(8);
    input.script_content.source_proposal_acceptance_id = `pda_${"6".repeat(32)}`;
    input.production_brief_content.creative_entry = {
      kind: "source_adaptation",
      adaptation_statement: "保留人物动机",
      source_document_id: `src_${"8".repeat(32)}`,
      source_manifest_version_id: version(9),
      source_block_ids: [`srcb_${"9".repeat(32)}`],
    };
    input.production_brief_content.budget_intent = {
      state: "declared",
      currency: "CNY",
      amount_micros: 0,
    };
    input.production_brief_content.rights_declaration = {
      state: "user_declared",
      statement: "测试授权声明",
    };
    input.production_brief_content.duration_intent = {
      episode_mode: "unspecified",
      episode_seconds: null,
      work_seconds: 60,
    };
    const built = buildHumanShotPlanTemplate(withProofs(input), 11);
    expect(built.kind).toBe("READY");
    if (built.kind === "READY") expect(built.content.authority).toEqual(input.authority);
    input.authority.source_span_ids = ["bad"];
    expect(buildHumanShotPlanTemplate(input, 11).kind).toBe("BLOCKED");
  });
  it("handles valid references and invalid script/brief/coverage/timing without creating content", () => {
    const input = preparation();
    if (input.production_brief_content.creative_entry.kind === "original_idea")
      input.production_brief_content.creative_entry.references = [
        { reference_kind: "research", description: "公开历史背景" },
      ];
    expect(buildHumanShotPlanTemplate(withProofs(input), 7).kind).toBe("READY");
    input.production_brief_content.duration_intent.episode_seconds = Number.MAX_SAFE_INTEGER;
    expect(buildHumanShotPlanTemplate(withProofs(input), 7).kind).toBe("BLOCKED");
    input.production_brief_content.duration_intent.episode_seconds = 1;
    expect(buildHumanShotPlanTemplate(withProofs(input), 1000).kind).toBe("BLOCKED");
    const invalidBlock = preparation();
    invalidBlock.script_content.scenes[0]!.blocks[0]!.text = " ";
    expect(buildHumanShotPlanTemplate(invalidBlock, 7).kind).toBe("BLOCKED");
    const wrongCoverage = template();
    wrongCoverage.shots[0]!.coverage = ["TRANSITION"];
    expect(validHumanShotPlanContent(wrongCoverage, project, episode, preparation())).toBe(false);
    const wrongDialogue = template();
    wrongDialogue.shots.forEach((shot) => {
      shot.dialogue_block_ids = [];
    });
    expect(validHumanShotPlanContent(wrongDialogue, project, episode, preparation())).toBe(false);
    const badCut = template();
    badCut.shots[0]!.safe_cut_window.end_frame = 0;
    expect(validHumanShotPlanContent(badCut, project, episode)).toBe(false);
    expect(reorderHumanShotPlanShots(template().shots, -1, 1)).toHaveLength(7);
  });
  it("keeps network exceptions unknown and handles read-only empty/rejected responses", async () => {
    const api = gateway();
    const port = storage();
    const payload = humanShotPlanRequest(template(), null, "人工模板");
    expect(await readHumanShotPlanProposal(api, project, episode)).toEqual({ kind: "EMPTY" });
    expect((await readHumanShotPlanPreparation(api, "invalid", episode)).kind).toBe("UNKNOWN");
    expect((await readHumanShotPlanProposal(api, project, "invalid")).kind).toBe("UNKNOWN");
    const denied = {
      kind: "DEFINITE_SERVER_ERROR" as const,
      status: 403,
      code: "ACCESS_DENIED",
      request_id: request,
    };
    vi.mocked(api.prepareHumanShotPlan).mockResolvedValue(denied);
    vi.mocked(api.getShotPlanProposal).mockResolvedValue(denied);
    expect((await readHumanShotPlanPreparation(api, project, episode)).kind).toBe("REJECTED");
    expect((await readHumanShotPlanProposal(api, project, episode)).kind).toBe("REJECTED");
    vi.mocked(api.createHumanShotPlanProposal).mockRejectedValue(new Error("Connection lost"));
    expect(
      (await createHumanShotPlan(api, port, project, episode, operation, payload, clean)).kind,
    ).toBe("UNKNOWN");
    vi.mocked(api.getHumanShotPlanWriteStatus).mockRejectedValue(new Error("Connection lost"));
    expect((await recoverHumanShotPlan(api, port, project, episode)).kind).toBe("UNKNOWN");
    expect(readHumanShotPlanJournal(port, project, episode).kind).toBe("PENDING");
    const noSend = storage();
    expect(
      (
        await createHumanShotPlan(api, noSend, project, episode, operation, payload, () => {
          throw new Error("Guard unavailable");
        })
      ).kind,
    ).toBe("BLOCKED");
    expect(readHumanShotPlanJournal(noSend, "invalid", episode).kind).toBe("BLOCKED");
    noSend.getItem.mockReturnValue(JSON.stringify({ operation_id: "invalid" }));
    expect(readHumanShotPlanJournal(noSend, project, episode).kind).toBe("BLOCKED");
    noSend.getItem.mockReturnValue("x".repeat(2500001));
    expect(readHumanShotPlanJournal(noSend, project, episode).kind).toBe("BLOCKED");
  });
  it("retains ADOPT exceptions and malformed/changed immutable mutation receipts", async () => {
    const value = await proposal();
    const api = gateway(value);
    const port = storage();
    vi.mocked(api.adoptHumanShotPlanProposal).mockRejectedValue(new Error("Timeout"));
    expect(
      (
        await adoptHumanShotPlan(
          api,
          port,
          project,
          episode,
          value,
          operation,
          value.content,
          clean,
        )
      ).kind,
    ).toBe("UNKNOWN");
    const second = storage();
    const changed = adopted(value);
    changed.content.episode_id = `ep_${"6".repeat(32)}`;
    vi.mocked(api.adoptHumanShotPlanProposal).mockResolvedValue({
      kind: "ADOPTED",
      receipt: receipt({ proposal: changed, replayed: false }),
    });
    expect(
      (
        await adoptHumanShotPlan(
          api,
          second,
          project,
          episode,
          value,
          operation,
          value.content,
          clean,
        )
      ).kind,
    ).toBe("UNKNOWN");
    const third = storage();
    vi.mocked(api.adoptHumanShotPlanProposal).mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 422,
      code: "SHOT_PLAN_BLOCKING_ISSUES",
      request_id: request,
    });
    expect(
      (
        await adoptHumanShotPlan(
          api,
          third,
          project,
          episode,
          value,
          operation,
          value.content,
          clean,
        )
      ).kind,
    ).toBe("REJECTED");
    expect(readHumanShotPlanJournal(third, project, episode).kind).toBe("EMPTY");
  });
});

describe("exact immutable preparation proofs", () => {
  it("accepts legacy missing defaults while hashing preserved raw bytes", async () => {
    const input = preparation();
    input.production_brief_content.creative.constraints = [];
    input.script_content.scenes.forEach((scene) =>
      scene.blocks.forEach((block) => {
        block.delivery = null;
      }),
    );
    withProofs(input);
    for (const field of [
      "schema_version",
      "story_bible_version_id",
      "source_extraction_version_id",
      "source_proposal_acceptance_id",
    ])
      delete input.script_stored_content[field];
    const rawScenes = input.script_stored_content.scenes;
    if (!Array.isArray(rawScenes)) throw new Error("Missing scenes fixture");
    rawScenes.forEach((scene) => {
      const blocks = proofRecord(scene).blocks;
      if (!Array.isArray(blocks)) throw new Error("Missing blocks fixture");
      blocks.forEach((block) => {
        const rawBlock = proofRecord(block);
        delete rawBlock.delivery;
        if (rawBlock.kind === "ACTION") delete rawBlock.speaker;
      });
    });
    delete input.production_brief_stored_content.schema_version;
    delete proofRecord(input.production_brief_stored_content.creative_entry).references;
    const creative = proofRecord(input.production_brief_stored_content.creative);
    for (const field of ["audience", "genre", "style", "constraints"]) delete creative[field];
    rehashProofs(input);
    const rawBefore = structuredClone(input.script_stored_content);
    expect(input.authority.script.content_hash).not.toBe(proofHash(input.script_content));
    expect(input.authority.production_brief.content_hash).not.toBe(
      proofHash(input.production_brief_content),
    );
    const api = gateway();
    vi.mocked(api.prepareHumanShotPlan).mockResolvedValue({
      kind: "PREPARED",
      receipt: receipt(input),
    });
    expect(await readHumanShotPlanPreparation(api, project, episode)).toEqual({
      kind: "PREPARED",
      preparation: input,
    });
    const built = buildHumanShotPlanTemplate(input, 11);
    expect(built.kind).toBe("READY");
    if (built.kind === "READY") {
      expect(built.content.authority).toEqual(input.authority);
      expect(built.content).not.toHaveProperty("script_stored_content");
      expect(built.content).not.toHaveProperty("production_brief_stored_content");
    }
    expect(input.script_stored_content).toEqual(rawBefore);
  });
  it("rejects raw/typed disagreement, extra raw fields and wrong immutable hashes", async () => {
    const api = gateway();
    const cases: ShotPlanPreparation[] = [];
    const mismatch = preparation();
    proofRecord(mismatch.production_brief_stored_content.creative).intent = "被改变的意图";
    cases.push(rehashProofs(mismatch));
    const extraScript = preparation();
    extraScript.script_stored_content.unexpected = true;
    cases.push(rehashProofs(extraScript));
    const extraBrief = preparation();
    proofRecord(extraBrief.production_brief_stored_content.delivery).unexpected = true;
    cases.push(rehashProofs(extraBrief));
    const hashMismatch = preparation();
    hashMismatch.authority.script.content_hash = hash;
    cases.push(hashMismatch);
    const briefHashMismatch = preparation();
    briefHashMismatch.authority.production_brief.content_hash = hash;
    cases.push(briefHashMismatch);
    for (const input of cases) {
      vi.mocked(api.prepareHumanShotPlan).mockResolvedValue({
        kind: "PREPARED",
        receipt: receipt(input),
      });
      expect((await readHumanShotPlanPreparation(api, project, episode)).kind).toBe("UNKNOWN");
    }
    expect(api.createHumanShotPlanProposal).not.toHaveBeenCalled();
    expect(api.adoptHumanShotPlanProposal).not.toHaveBeenCalled();
  });
  it("preserves rational typed/raw proofs exactly and rejects equivalent non-reduced raw rationals", async () => {
    const input = preparation();
    input.production_brief_content.delivery.frame_rate = { num: 24000, den: 1001 };
    withProofs(input);
    const rawHash = proofHash(input.production_brief_stored_content);
    const api = gateway();
    vi.mocked(api.prepareHumanShotPlan).mockResolvedValue({
      kind: "PREPARED",
      receipt: receipt(input),
    });
    expect((await readHumanShotPlanPreparation(api, project, episode)).kind).toBe("PREPARED");
    const built = buildHumanShotPlanTemplate(input, 7);
    if (built.kind !== "READY") throw new Error("Rational proof template failed");
    expect(built.content.timebase.frame_rate).toEqual({ num: 24000, den: 1001 });
    expect(input.authority.production_brief.content_hash).toBe(rawHash);
    proofRecord(input.production_brief_stored_content.delivery).frame_rate = {
      num: 48000,
      den: 2002,
    };
    rehashProofs(input);
    expect((await readHumanShotPlanPreparation(api, project, episode)).kind).toBe("UNKNOWN");
    expect(buildHumanShotPlanTemplate(input, 7).kind).toBe("BLOCKED");
  });
  it("rejects oversized exact script proof without trimming or writing", async () => {
    const input = preparation(35);
    input.script_content.scenes.forEach((scene) =>
      scene.blocks.forEach((block) => {
        block.text = "a".repeat(20000);
      }),
    );
    withProofs(input);
    const api = gateway();
    vi.mocked(api.prepareHumanShotPlan).mockResolvedValue({
      kind: "PREPARED",
      receipt: receipt(input),
    });
    expect((await readHumanShotPlanPreparation(api, project, episode)).kind).toBe("UNKNOWN");
    expect(buildHumanShotPlanTemplate(input, 35).kind).toBe("BLOCKED");
    expect(input.script_content.scenes[0]?.blocks[0]?.text).toHaveLength(20000);
  });
});

describe("defensive authoritative reads", () => {
  it("rejects arrays masquerading as enum strings and unknown script fields", () => {
    const content = template();
    const badCoverage = {
      ...content,
      shots: content.shots.map((shot) => ({ ...shot, coverage: [["ACTION"]] })),
    };
    expect(validHumanShotPlanContent(badCoverage, project, episode)).toBe(false);
    const badFraming = {
      ...content,
      shots: content.shots.map((shot) => ({ ...shot, framing: ["MEDIUM"] })),
    };
    expect(validHumanShotPlanContent(badFraming, project, episode)).toBe(false);
    const input = preparation();
    Object.assign(input.script_content, { injected: true });
    expect(buildHumanShotPlanTemplate(input, 7).kind).toBe("BLOCKED");
  });
  it("reads valid preparation and exact hash verified proposal", async () => {
    const value = await proposal();
    const api = gateway(value);
    expect((await readHumanShotPlanPreparation(api, project, episode)).kind).toBe("PREPARED");
    expect(await readHumanShotPlanProposal(api, project, episode)).toEqual({
      kind: "FOUND",
      proposal: value,
    });
    value.content_hash = `sha256:${"b".repeat(64)}`;
    expect((await readHumanShotPlanProposal(api, project, episode)).kind).toBe("UNKNOWN");
  });
  it("rejects malformed arrays, timebase, mismatched identity and unsupported provenance", async () => {
    const api = gateway();
    const input = preparation();
    input.project_id = `prj_${"5".repeat(32)}`;
    vi.mocked(api.prepareHumanShotPlan).mockResolvedValue({
      kind: "PREPARED",
      receipt: receipt(input),
    });
    expect((await readHumanShotPlanPreparation(api, project, episode)).kind).toBe("UNKNOWN");
    const content = {
      ...template(),
      timebase: { frame_rate: { num: 24, den: 2 }, timecode_mode: "NON_DROP_FRAME" },
    };
    expect(validHumanShotPlanContent(content, project, episode)).toBe(false);
    const malformed = { ...template(), visual_constraints: {}, provenance: "AI" };
    expect(validHumanShotPlanContent(malformed, project, episode)).toBe(false);
  });
});
