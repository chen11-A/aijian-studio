import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { components } from "@aijian/contracts";
import type {
  HumanShotPlanRequest,
  ShotPlanAdoptionRequest,
  ShotPlanContent,
} from "@aijian/contracts/shot-plan";
import { describe, expect, test } from "vitest";
import {
  isHumanShotPlanRequest,
  isShotPlanAdoptedResponse,
  isShotPlanAdoptionRequest,
  isShotPlanAdoptionStatusResponse,
  isShotPlanContent,
  isShotPlanCreatedResponse,
  isShotPlanOperationId,
  isShotPlanPreparationResponse,
  isShotPlanProposalResponse,
  isShotPlanWriteStatusResponse,
} from "./shot-plan-contract";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../packages/contracts/fixtures/shot-plan", `${name}.json`),
      "utf8",
    ),
  ) as T;
}
const scope = fixture<{ project_id: string; episode_id: string; proposal_version_id: string }>(
  "scope",
);
const { project_id: project, episode_id: episode, proposal_version_id: version } = scope;
const human = fixture<HumanShotPlanRequest>("human-request");
const adoptRequest = fixture<ShotPlanAdoptionRequest>("adoption-request");
type ProposalResponse = components["schemas"]["ShotPlanProposalResponse"];
type MutationResponse = components["schemas"]["ShotPlanMutationResponse"];
function hash(value: unknown): string {
  const sorted = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sorted)
      : item !== null && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, entry]) => [key, sorted(entry)]),
          )
        : item;
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(sorted(value)), "utf8")
    .digest("hex")}`;
}
function content(patch: Record<string, unknown>): unknown {
  return { ...structuredClone(human.content), ...patch };
}
function shot(patch: Record<string, unknown>): unknown {
  const copy = structuredClone(human.content);
  return { ...copy, shots: [{ ...copy.shots[0], ...patch }, ...copy.shots.slice(1)] };
}

describe("HUMAN shot plan closed native contract", () => {
  test("decodes actual synthetic persisted Pydantic responses without replacing their hashes", () => {
    expect(isHumanShotPlanRequest(human, project, episode)).toBe(true);
    expect(isShotPlanAdoptionRequest(adoptRequest)).toBe(true);
    const proposal = fixture<ProposalResponse>("proposal");
    expect(
      isShotPlanProposalResponse(proposal, project, episode, proposal.request_id, version),
    ).toBe(true);
    const created = fixture<MutationResponse>("created");
    expect(isShotPlanCreatedResponse(created, project, episode, created.request_id, human)).toBe(
      true,
    );
    const adopted = fixture<MutationResponse>("adopted");
    expect(
      isShotPlanAdoptedResponse(adopted, project, episode, version, adopted.request_id, {
        ...adoptRequest,
        confirm: false,
      } as unknown as ShotPlanAdoptionRequest),
    ).toBe(false);
    expect(
      isShotPlanAdoptedResponse(
        adopted,
        project,
        episode,
        version,
        adopted.request_id,
        adoptRequest,
      ),
    ).toBe(true);
    for (const name of ["write-status", "write-status-empty"]) {
      const receipt = fixture<components["schemas"]["ShotPlanWriteStatusResponse"]>(name);
      expect(isShotPlanWriteStatusResponse(receipt, project, episode, receipt.request_id)).toBe(
        true,
      );
    }
    for (const name of ["adoption-status", "adoption-status-empty"]) {
      const receipt = fixture<components["schemas"]["ShotPlanAdoptionStatusResponse"]>(name);
      expect(isShotPlanAdoptionStatusResponse(receipt, version, receipt.request_id)).toBe(true);
    }
  });
  test("preparation pins bind exact stored JSON while typed contents normalize only known defaults", () => {
    const receipt = fixture<components["schemas"]["ShotPlanPreparationResponse"]>("preparation");
    expect(receipt.data.authority.script.content_hash).toBe(
      hash(receipt.data.script_stored_content),
    );
    expect(receipt.data.authority.production_brief.content_hash).toBe(
      hash(receipt.data.production_brief_stored_content),
    );
    expect(isShotPlanPreparationResponse(receipt, project, episode, receipt.request_id)).toBe(true);
    receipt.data.authority.script.content_hash = `sha256:${"a".repeat(64)}`;
    expect(isShotPlanPreparationResponse(receipt, project, episode, receipt.request_id)).toBe(
      false,
    );
  });
  test("accepts actual legacy default and reduced rational proofs without rewriting immutable hashes", () => {
    for (const name of ["preparation-legacy-defaults", "preparation-rational"]) {
      const receipt = fixture<components["schemas"]["ShotPlanPreparationResponse"]>(name);
      expect(receipt.data.authority.script.content_hash).toBe(
        hash(receipt.data.script_stored_content),
      );
      expect(receipt.data.authority.production_brief.content_hash).toBe(
        hash(receipt.data.production_brief_stored_content),
      );
      expect(
        isShotPlanPreparationResponse(
          receipt,
          receipt.data.project_id,
          receipt.data.episode_id,
          receipt.request_id,
        ),
      ).toBe(true);
    }
  });
  test("raw proofs must keep scope, closed shapes, Unicode and exact typed equivalence", () => {
    const read = () => fixture<components["schemas"]["ShotPlanPreparationResponse"]>("preparation");
    for (const mutate of [
      (receipt: ReturnType<typeof read>) => {
        receipt.data.script_stored_content.project_id = `prj_${"f".repeat(32)}`;
      },
      (receipt: ReturnType<typeof read>) => {
        receipt.data.script_stored_content.provider_response = "ignored?";
      },
      (receipt: ReturnType<typeof read>) => {
        receipt.data.production_brief_stored_content.provider_response = "ignored?";
      },
      (receipt: ReturnType<typeof read>) => {
        receipt.data.script_content.scenes[0]!.heading = "different normalized meaning";
      },
      (receipt: ReturnType<typeof read>) => {
        receipt.data.script_stored_content.schema_version = null;
      },
      (receipt: ReturnType<typeof read>) => {
        receipt.data.script_stored_content.scenes = null;
      },
      (receipt: ReturnType<typeof read>) => {
        receipt.data.script_stored_content.scenes = [{ blocks: null }];
      },
      (receipt: ReturnType<typeof read>) => {
        receipt.data.production_brief_stored_content.creative = { premise: "\\ud800", intent: "a" };
      },
    ]) {
      const receipt = read();
      mutate(receipt);
      receipt.data.authority.script.content_hash = hash(receipt.data.script_stored_content);
      receipt.data.authority.production_brief.content_hash = hash(
        receipt.data.production_brief_stored_content,
      );
      expect(isShotPlanPreparationResponse(receipt, project, episode, receipt.request_id)).toBe(
        false,
      );
    }
    const rational = read();
    const delivery = rational.data.production_brief_stored_content.delivery as Record<
      string,
      unknown
    >;
    delivery.frame_rate = { num: 48, den: 2 };
    rational.data.authority.production_brief.content_hash = hash(
      rational.data.production_brief_stored_content,
    );
    expect(isShotPlanPreparationResponse(rational, project, episode, rational.request_id)).toBe(
      false,
    );
  });
  test("typed preparation rejects malformed nested raw blocks and mismatched prepared scope", () => {
    const receipt = fixture<components["schemas"]["ShotPlanPreparationResponse"]>("preparation");
    expect(
      isShotPlanPreparationResponse(
        { ...receipt, data: { ...receipt.data, generation_status: "COMPLETE" } },
        project,
        episode,
        receipt.request_id,
      ),
    ).toBe(false);
    const rawScenes = receipt.data.script_stored_content.scenes as { blocks: unknown[] }[];
    rawScenes[0]!.blocks[0] = { unknown: "block" };
    receipt.data.authority.script.content_hash = hash(receipt.data.script_stored_content);
    expect(isShotPlanPreparationResponse(receipt, project, episode, receipt.request_id)).toBe(
      false,
    );
  });
  test("closed supplemental adapted preparation checks raw and normalized source pins", () => {
    const receipt = fixture<components["schemas"]["ShotPlanPreparationResponse"]>("preparation");
    const source = {
      version_id: `ver_${"a".repeat(32)}`,
      content_hash: `sha256:${"a".repeat(64)}`,
    };
    const acceptance = `pda_${"a".repeat(32)}`;
    receipt.data.authority = {
      ...receipt.data.authority,
      mode: "ADAPTED",
      source_extraction: source,
      source_proposal_acceptance_id: acceptance,
      source_span_ids: [`spn_${"a".repeat(32)}`],
    };
    const entry = {
      kind: "source_adaptation" as const,
      adaptation_statement: "Authorized synthetic source",
      source_document_id: `src_${"a".repeat(32)}`,
      source_manifest_version_id: source.version_id,
      source_block_ids: [`srcb_${"a".repeat(32)}`],
    };
    receipt.data.production_brief_content.creative_entry = entry;
    receipt.data.production_brief_stored_content.creative_entry = entry;
    receipt.data.script_content.source_extraction_version_id = source.version_id;
    receipt.data.script_content.source_proposal_acceptance_id = acceptance;
    receipt.data.script_stored_content.source_extraction_version_id = source.version_id;
    receipt.data.script_stored_content.source_proposal_acceptance_id = acceptance;
    receipt.data.authority.script.content_hash = hash(receipt.data.script_stored_content);
    receipt.data.authority.production_brief.content_hash = hash(
      receipt.data.production_brief_stored_content,
    );
    expect(isShotPlanPreparationResponse(receipt, project, episode, receipt.request_id)).toBe(true);
    receipt.data.authority.source_extraction.version_id = `ver_${"f".repeat(32)}`;
    expect(isShotPlanPreparationResponse(receipt, project, episode, receipt.request_id)).toBe(
      false,
    );
  });
  test("each content record is closed and every field is explicitly present", () => {
    function records(value: unknown, path: (string | number)[] = []): (string | number)[][] {
      if (Array.isArray(value))
        return value.flatMap((item, index) => records(item, [...path, index]));
      if (value === null || typeof value !== "object") return [];
      return [
        path,
        ...Object.entries(value).flatMap(([key, item]) => records(item, [...path, key])),
      ];
    }
    for (const path of records(human.content)) {
      const get = (copy: ShotPlanContent): Record<string, unknown> =>
        path.reduce<unknown>(
          (obj, key) => (obj as Record<string | number, unknown>)[key],
          copy,
        ) as Record<string, unknown>;
      const extra = structuredClone(human.content);
      get(extra).provider_completion = true;
      expect(isShotPlanContent(extra, project, episode), `extra at ${path.join(".")}`).toBe(false);
      for (const key of Object.keys(get(human.content))) {
        const missing = structuredClone(human.content);
        delete get(missing)[key];
        expect(
          isShotPlanContent(missing, project, episode),
          `missing ${[...path, key].join(".")}`,
        ).toBe(false);
      }
    }
  });
  test.each([
    { provenance: "AI" },
    { provenance: "FAKE" },
    { schema_version: "2.0.0" },
    { project_id: `prj_${"f".repeat(32)}` },
    { episode_id: `ep_${"f".repeat(32)}` },
    { storyboard_base: {} },
    { visual_constraints: [""] },
    { visual_constraints: ["a", "a"] },
    { visual_constraints: Array(33).fill("a") },
    { shots: [] },
    { shots: new Array(1) },
    {
      issues: [
        {
          code: "BLOCK",
          severity: "WARNING",
          shot_id: `shp_${"f".repeat(32)}`,
          message: "unknown shot",
        },
      ],
    },
    { issues: [{ code: "lower", severity: "WARNING", shot_id: null, message: "issue" }] },
    { issues: [{ code: "A", severity: "PASSED", shot_id: null, message: "issue" }] },
    { issues: [{ code: "A", severity: "WARNING", shot_id: null, message: "" }] },
  ])("rejects malformed content %j", (patch) =>
    expect(isShotPlanContent(content(patch), project, episode)).toBe(false),
  );
  test.each([
    { shot_id: "shot_1" },
    { ordinal: 2 },
    { ordinal: true },
    { script_scene_id: "scene" },
    { script_block_ids: [] },
    { script_block_ids: ["wrong"] },
    { script_block_ids: ["sblk_" + "a".repeat(32), "sblk_" + "a".repeat(32)] },
    { dialogue_block_ids: ["sblk_" + "f".repeat(32)] },
    { title: " " },
    { title: "字".repeat(241) },
    { title: "\ud800" },
    { title: "a\0b" },
    { narrative_purpose: "x".repeat(4_001) },
    { coverage: [] },
    { coverage: ["ACTION", "ACTION"] },
    { coverage: ["UNKNOWN"] },
    { coverage: [{ toString: null }] },
    { framing: { toString: null } },
    { framing: "ZOOM" },
    { movement: { subject: "s", environment: "e", camera: "x".repeat(161) } },
    { movement: { subject: " ", environment: "e", camera: "c" } },
    { duration_frames: 0 },
    { duration_frames: 1.5 },
    { duration_frames: true },
    { duration_frames: "72" },
    { duration_frames: 864_001 },
    { handle_in_frames: -1 },
    { handle_out_frames: 0.1 },
    { handle_in_frames: 68 },
    { safe_cut_window: { start_frame: 3, end_frame: 68 } },
    { safe_cut_window: { start_frame: 4, end_frame: 69 } },
    { safe_cut_window: { start_frame: 4, end_frame: 4 } },
    { safe_cut_window: { start_frame: true, end_frame: 68 } },
  ])("rejects malformed intentions and frame boundaries %j", (patch) =>
    expect(isShotPlanContent(shot(patch), project, episode)).toBe(false),
  );
  test("accepts only supported reduced rational timebases and valid independent timecode modes", () => {
    for (const [num, den, mode] of [
      [24, 1, "NON_DROP_FRAME"],
      [25, 1, "NON_DROP_FRAME"],
      [24_000, 1_001, "NON_DROP_FRAME"],
      [30_000, 1_001, "NON_DROP_FRAME"],
      [30_000, 1_001, "DROP_FRAME"],
    ])
      expect(
        isShotPlanContent(
          content({ timebase: { frame_rate: { num, den }, timecode_mode: mode } }),
          project,
          episode,
        ),
      ).toBe(true);
    for (const [num, den, mode] of [
      [48, 2, "NON_DROP_FRAME"],
      [24, 1, "DROP_FRAME"],
      [30_000, 1_001, "drop"],
      [24, 0, "NON_DROP_FRAME"],
      [true, 1, "NON_DROP_FRAME"],
      [24.5, 1, "NON_DROP_FRAME"],
    ])
      expect(
        isShotPlanContent(
          content({ timebase: { frame_rate: { num, den }, timecode_mode: mode } }),
          project,
          episode,
        ),
      ).toBe(false);
  });
  test("validates adapted authority shape, unique spans and storyboard CAS pins", () => {
    const adapted = {
      ...human.content.authority,
      mode: "ADAPTED",
      source_extraction: {
        version_id: `ver_${"a".repeat(32)}`,
        content_hash: `sha256:${"a".repeat(64)}`,
      },
      source_proposal_acceptance_id: `pda_${"a".repeat(32)}`,
      source_span_ids: [`spn_${"a".repeat(32)}`],
    };
    expect(isShotPlanContent(content({ authority: adapted }), project, episode)).toBe(true);
    for (const patch of [
      { source_span_ids: [] },
      { source_span_ids: ["bad"] },
      { source_span_ids: [...adapted.source_span_ids, ...adapted.source_span_ids] },
      {
        source_extraction: {
          version_id: "bad",
          content_hash: adapted.source_extraction.content_hash,
        },
      },
      { source_proposal_acceptance_id: "bad" },
    ])
      expect(
        isShotPlanContent(content({ authority: { ...adapted, ...patch } }), project, episode),
      ).toBe(false);
    const base = { ...human.content.authority.production_brief, head_revision: 1 };
    expect(isShotPlanContent(content({ storyboard_base: base }), project, episode)).toBe(true);
    expect(
      isShotPlanContent(
        content({ storyboard_base: { ...base, head_revision: true } }),
        project,
        episode,
      ),
    ).toBe(false);
  });
  test("bounds bytes, list sizes and unique stable identity; rejects cycles and holes", () => {
    const copy = structuredClone(human.content);
    copy.shots[1]!.shot_id = copy.shots[0]!.shot_id;
    expect(isShotPlanContent(copy, project, episode)).toBe(false);
    const many = Array.from({ length: 101 }, (_, index) => ({
      ...human.content.shots[0]!,
      shot_id: `shp_${index.toString(16).padStart(32, "0")}`,
      ordinal: index + 1,
      narrative_purpose: "字".repeat(4_000),
      composition: "字".repeat(4_000),
    }));
    expect(isShotPlanContent(content({ shots: many }), project, episode)).toBe(false);
    expect(
      isShotPlanContent(
        content({
          shots: Array.from({ length: 1_001 }, (_, index) => ({
            ...human.content.shots[0],
            ordinal: index + 1,
          })),
        }),
        project,
        episode,
      ),
    ).toBe(false);
    expect(isShotPlanContent(content({ visual_constraints: [new Date()] }), project, episode)).toBe(
      false,
    );
    let deep: unknown = null;
    for (let index = 0; index < 25; index++) deep = { nested: deep };
    expect(isShotPlanContent(content({ unknown: deep }), project, episode)).toBe(false);
    const cycle = structuredClone(human.content) as unknown as Record<string, unknown>;
    cycle.loop = cycle;
    expect(isShotPlanContent(cycle, project, episode)).toBe(false);
    expect(isShotPlanContent(content({ issues: new Array(1) }), project, episode)).toBe(false);
    expect(isShotPlanContent(content({ visual_constraints: [undefined] }), project, episode)).toBe(
      false,
    );
  });
  test("requires UUID v4 once, paired revisions, and a literal true adoption decision", () => {
    expect(isShotPlanOperationId("00000000-0000-4000-8000-000000000001")).toBe(true);
    for (const operation of [
      "../escape",
      "00000000-0000-1000-8000-000000000001",
      "00000000-0000-4000-7000-000000000001",
      "F0000000-0000-4000-8000-000000000001",
    ])
      expect(isShotPlanOperationId(operation)).toBe(false);
    for (const patch of [
      { parent_version_id: version },
      { expected_revision: 1 },
      { expected_revision: true },
      { change_summary: " " },
      { generation_status: "COMPLETE" },
    ])
      expect(isHumanShotPlanRequest({ ...human, ...patch }, project, episode)).toBe(false);
    for (const confirm of [false, 1, "true", null, undefined])
      expect(isShotPlanAdoptionRequest({ ...adoptRequest, confirm })).toBe(false);
    expect(isShotPlanAdoptionRequest({ ...adoptRequest, provenance: "HUMAN" })).toBe(false);
  });
  test("an adoption cannot conceal a fractional storyboard timebase or blocking intention", () => {
    for (const mutate of [
      (receipt: MutationResponse) => {
        receipt.data.proposal.content.timebase.frame_rate = { num: 24_000, den: 1_001 };
      },
      (receipt: MutationResponse) => {
        receipt.data.proposal.content.issues = [
          {
            code: "UNRESOLVED",
            severity: "BLOCKING",
            shot_id: null,
            message: "Human review required",
          },
        ];
      },
    ]) {
      const receipt = fixture<MutationResponse>("adopted");
      mutate(receipt);
      receipt.data.proposal.content_hash = hash(receipt.data.proposal.content);
      receipt.data.proposal.adoption!.proposal_content_hash = receipt.data.proposal.content_hash;
      expect(
        isShotPlanAdoptedResponse(receipt, project, episode, version, receipt.request_id, {
          ...adoptRequest,
          proposal_content_hash: receipt.data.proposal.content_hash,
        }),
      ).toBe(false);
    }
  });
  test("does not pass foreign identities, mismatched hashes, unconfirmed adoption or fictional generation across IPC", () => {
    const proposal = fixture<ProposalResponse>("proposal");
    for (const patch of [
      { content_hash: `sha256:${"f".repeat(64)}` },
      { generation_status: "COMPLETE" },
      { head_revision: 0 },
      { version_number: 2 },
      { author_actor_id: "" },
      { created_at: "today" },
      { version_id: `ver_${"f".repeat(32)}` },
    ])
      expect(
        isShotPlanProposalResponse(
          { ...proposal, data: { ...proposal.data, ...patch } },
          project,
          episode,
          proposal.request_id,
          version,
        ),
      ).toBe(false);
    expect(isShotPlanProposalResponse(proposal, project, episode, null)).toBe(false);
    expect(
      isShotPlanProposalResponse(
        { ...proposal, token: "secret" },
        project,
        episode,
        proposal.request_id,
      ),
    ).toBe(false);
    const created = fixture<MutationResponse>("created");
    expect(
      isShotPlanCreatedResponse(created, project, episode, created.request_id, {
        ...human,
        content: { ...human.content, visual_constraints: ["changed"] },
      }),
    ).toBe(false);
    const adopted = fixture<MutationResponse>("adopted");
    expect(
      isShotPlanAdoptedResponse(
        created,
        project,
        episode,
        version,
        created.request_id,
        adoptRequest,
      ),
    ).toBe(false);
    adopted.data.proposal.adoption!.proposal_version_id = `ver_${"f".repeat(32)}`;
    expect(
      isShotPlanAdoptedResponse(
        adopted,
        project,
        episode,
        version,
        adopted.request_id,
        adoptRequest,
      ),
    ).toBe(false);
    const status =
      fixture<components["schemas"]["ShotPlanAdoptionStatusResponse"]>("adoption-status");
    expect(
      isShotPlanAdoptionStatusResponse(status, `ver_${"f".repeat(32)}`, status.request_id),
    ).toBe(false);
    const unknown =
      fixture<components["schemas"]["ShotPlanWriteStatusResponse"]>("write-status-empty");
    expect(
      isShotPlanWriteStatusResponse(
        { ...unknown, data: { proposal: null, did_not_commit: true } },
        project,
        episode,
        unknown.request_id,
      ),
    ).toBe(false);
  });
});
