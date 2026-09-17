import { describe, expect, test } from "vitest";

import {
  productionBriefIdempotencyKey,
  isProductionBriefCreateCommand,
  normalizeProductionBriefCreateCommand,
  type ProductionBriefCreateCommand,
  isProductionBriefResponse,
  isProductionBriefLatestResponse,
  productionBriefSafeError,
} from "./production-brief-contract";

const projectId = `prj_${"1".repeat(32)}`;
type RawContent = Record<string, unknown> & {
  creative: Record<string, unknown>;
  creative_entry: Record<string, unknown>;
  delivery: Record<string, unknown>;
  duration_intent: Record<string, unknown>;
  budget_intent: Record<string, unknown>;
  rights_declaration: Record<string, unknown>;
};
type RawCommand = {
  operation_id: string;
  input: Record<string, unknown> & { content: RawContent; change_summary: string };
};
function rawCommand(): RawCommand {
  return structuredClone(command) as unknown as RawCommand;
}
const command: ProductionBriefCreateCommand = {
  operation_id: "80cdb6d5-4633-4ffb-9d68-0c9456452274",
  input: {
    content: {
      schema_version: "1.0.0",
      creative_entry: { kind: "original_idea", origin_statement: "原创故事", references: [] },
      creative: { premise: "一个夜晚", intent: "探索", constraints: [] },
      delivery: {
        language: "zh-CN",
        display_aspect_ratio: { num: 16, den: 9 },
        width_px: 1920,
        height_px: 1080,
        frame_rate: { num: 24, den: 1 },
      },
      duration_intent: { work_seconds: 90, episode_mode: "unspecified", episode_seconds: null },
      budget_intent: { state: "unknown", currency: null, amount_micros: null },
      rights_declaration: { state: "unknown", statement: null },
    },
    parent_version_id: null,
    expected_revision: null,
    change_summary: "创建原创简报",
  },
};

describe("ProductionBrief bridge contract", () => {
  test("rejects an incomplete response envelope instead of accepting a cast", () => {
    expect(isProductionBriefResponse({ data: null, request_id: "bad" }, projectId)).toBe(false);
  });
  test("accepts an exact original command and derives a restart-stable scoped key", () => {
    expect(isProductionBriefCreateCommand(command)).toBe(true);
    expect(productionBriefIdempotencyKey(projectId, command)).toBe(
      productionBriefIdempotencyKey(projectId, command),
    );
    expect(productionBriefIdempotencyKey(projectId, command)).not.toBe(
      productionBriefIdempotencyKey(`prj_${"2".repeat(32)}`, command),
    );
    const changedPayload = rawCommand();
    changedPayload.input.change_summary = "同一操作的变更载荷";
    expect(productionBriefIdempotencyKey(projectId, changedPayload)).toBe(
      productionBriefIdempotencyKey(projectId, command),
    );
  });
  test("accepts omitted Pydantic-default revision fields", () => {
    const value = structuredClone(command) as {
      operation_id: string;
      input: Record<string, unknown>;
    };
    delete value.input.parent_version_id;
    delete value.input.expected_revision;
    expect(isProductionBriefCreateCommand(value)).toBe(true);
  });
  test("accepts Python-default content fields without accepting explicit invalid values", () => {
    const value = rawCommand();
    delete value.input.content.schema_version;
    delete value.input.content.creative_entry.references;
    delete value.input.content.creative.audience;
    delete value.input.content.creative.genre;
    delete value.input.content.creative.style;
    delete value.input.content.creative.constraints;
    expect(isProductionBriefCreateCommand(value)).toBe(true);
    value.input.content.schema_version = null;
    expect(isProductionBriefCreateCommand(value)).toBe(false);
  });
  test("normalizes Python defaults before the sidecar boundary", () => {
    const value = rawCommand();
    delete value.input.content.schema_version;
    delete value.input.content.creative_entry.references;
    delete value.input.content.creative.audience;
    delete value.input.content.creative.genre;
    delete value.input.content.creative.style;
    delete value.input.content.creative.constraints;
    delete value.input.parent_version_id;
    delete value.input.expected_revision;
    expect(normalizeProductionBriefCreateCommand(value)?.input).toMatchObject({
      parent_version_id: null,
      expected_revision: null,
      content: {
        schema_version: "1.0.0",
        creative_entry: { references: [] },
        creative: { audience: null, genre: null, style: null, constraints: [] },
      },
    });
  });
  test("accepts valid adaptation and declared intent combinations", () => {
    const value = rawCommand();
    value.input.content.creative_entry = {
      kind: "source_adaptation",
      adaptation_statement: "改编",
      source_document_id: `src_${"a".repeat(32)}`,
      source_manifest_version_id: `ver_${"b".repeat(32)}`,
      source_block_ids: [`srcb_${"c".repeat(32)}`],
    };
    value.input.content.duration_intent = {
      work_seconds: null,
      episode_mode: "per_episode",
      episode_seconds: 60,
    };
    value.input.content.budget_intent = { state: "declared", currency: "USD", amount_micros: 1 };
    value.input.content.rights_declaration = {
      state: "user_declared",
      statement: "我拥有必要权利",
    };
    expect(isProductionBriefCreateCommand(value)).toBe(true);
  });
  test("rejects nested extras, non-string enums, and duplicate source identities", () => {
    const cases: ((value: RawCommand) => void)[] = [
      (value) => (value.input.content.creative.extra = true),
      (value) => (value.input.content.duration_intent.episode_mode = ["unspecified"]),
      (value) =>
        (value.input.content.creative_entry = {
          kind: "source_adaptation",
          adaptation_statement: "改编",
          source_document_id: `src_${"a".repeat(32)}`,
          source_manifest_version_id: `ver_${"b".repeat(32)}`,
          source_block_ids: [`srcb_${"c".repeat(32)}`, `srcb_${"c".repeat(32)}`],
        }),
    ];
    for (const mutate of cases) {
      const value = rawCommand();
      mutate(value);
      expect(isProductionBriefCreateCommand(value)).toBe(false);
    }
  });

  test("rejects a command with renderer-supplied credentials or unknown fields", () => {
    expect(isProductionBriefCreateCommand({ ...command, token: "secret" })).toBe(false);
    expect(
      isProductionBriefCreateCommand({ ...command, input: { ...command.input, key: "x" } }),
    ).toBe(false);
  });
  test("rejects non-minimal rationals and invalid source adaptation focus", () => {
    const altered = rawCommand();
    altered.input.content.delivery.display_aspect_ratio = { num: 32, den: 18 };
    expect(isProductionBriefCreateCommand(altered)).toBe(false);
    const adaptation = rawCommand();
    adaptation.input.content.creative_entry = {
      kind: "source_adaptation",
      adaptation_statement: "改编",
      source_document_id: `src_${"a".repeat(32)}`,
      source_manifest_version_id: `ver_${"b".repeat(32)}`,
      source_block_ids: [],
    };
    expect(isProductionBriefCreateCommand(adaptation)).toBe(false);
  });
  test("maps only frozen status and code pairs", () => {
    const error = {
      error: { code: "VALIDATION_ERROR", message: "bad", retryable: false, details: {} },
      request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
    };
    expect(productionBriefSafeError(error, 422)?.kind).toBe("DEFINITE_SERVER_ERROR");
    expect(
      productionBriefSafeError({ ...error, error: { ...error.error, code: "ARBITRARY" } }, 422),
    ).toBeNull();
    expect(productionBriefSafeError(error, 500)).toBeNull();
    for (const details of [null, [], { bad: 1 }]) {
      expect(
        productionBriefSafeError({ ...error, error: { ...error.error, details } }, 422),
      ).toBeNull();
    }
  });
  test("enforces duration, budget, and rights nullable relations", () => {
    for (const mutate of [
      (value: RawCommand) => {
        value.input.content.duration_intent.episode_seconds = 1;
      },
      (value: RawCommand) => {
        value.input.content.budget_intent.currency = "USD";
      },
      (value: RawCommand) => {
        value.input.content.rights_declaration.state = "user_declared";
      },
    ]) {
      const value = rawCommand();
      mutate(value);
      expect(isProductionBriefCreateCommand(value)).toBe(false);
    }
    const declared = rawCommand();
    declared.input.content.budget_intent.state = "declared";
    declared.input.content.budget_intent.currency = "USD";
    expect(isProductionBriefCreateCommand(declared)).toBe(false);
  });
  test("uses Python-compatible Unicode code-point text limits", () => {
    const value = rawCommand();
    value.input.change_summary = "😀".repeat(1000);
    expect(isProductionBriefCreateCommand(value)).toBe(true);
    value.input.change_summary += "😀";
    expect(isProductionBriefCreateCommand(value)).toBe(false);
  });
  test("uses exact integer aspect multiplication near safe bounds", () => {
    const value = rawCommand();
    value.input.content.delivery = {
      language: "zh",
      display_aspect_ratio: { num: 1, den: 1 },
      width_px: 9_007_199_254_740_991,
      height_px: 9_007_199_254_740_991,
      frame_rate: { num: 24, den: 1 },
    };
    expect(isProductionBriefCreateCommand(value)).toBe(true);
    const large = rawCommand();
    large.input.content.delivery = {
      language: "zh",
      display_aspect_ratio: { num: 2_147_483_649, den: 1 },
      width_px: 2_147_483_649,
      height_px: 1,
      frame_rate: { num: 24, den: 1 },
    };
    expect(isProductionBriefCreateCommand(large)).toBe(true);
    large.input.content.delivery.height_px = 2;
    expect(isProductionBriefCreateCommand(large)).toBe(false);
  });
  test("accepts an exact old version under a newer current head and rejects identity drift", () => {
    const versionId = `ver_${"a".repeat(32)}`;
    const artifactId = `art_${"b".repeat(32)}`;
    const wireContent = rawCommand().input.content;
    wireContent.creative = { ...wireContent.creative, audience: null, genre: null, style: null };
    const response = {
      request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
      data: {
        project_id: projectId,
        head: {
          accepted_version_id: null,
          artifact_id: artifactId,
          latest_version_id: `ver_${"c".repeat(32)}`,
          review_evidence_revision: 0,
          review_submission_id: null,
          review_version_id: null,
          revision: 2,
          updated_at: "2026-01-01T00:00:00Z",
        },
        version: {
          id: versionId,
          artifact_id: artifactId,
          version_number: 1,
          schema_version: "1.0.0",
          content: wireContent,
          content_hash: `sha256:${"d".repeat(64)}`,
          parent_version_id: null,
          change_summary: "first",
          created_at: "2026-01-01T00:00:00Z",
        },
      },
    };
    expect(isProductionBriefResponse(response, projectId, versionId)).toBe(true);
    expect(isProductionBriefLatestResponse(response, projectId)).toBe(false);
    expect(
      isProductionBriefResponse(
        {
          ...response,
          data: {
            ...response.data,
            version: { ...response.data.version, artifact_id: `art_${"e".repeat(32)}` },
          },
        },
        projectId,
        versionId,
      ),
    ).toBe(false);
    const invalid = [
      { ...response, data: { ...response.data, head: { ...response.data.head, revision: 0 } } },
      {
        ...response,
        data: { ...response.data, version: { ...response.data.version, content_hash: "bad" } },
      },
      {
        ...response,
        data: { ...response.data, version: { ...response.data.version, created_at: "not-a-date" } },
      },
    ];
    for (const item of invalid)
      expect(isProductionBriefResponse(item, projectId, versionId)).toBe(false);
    const truncated = structuredClone(response) as unknown as {
      data: { version: { content: { creative: Record<string, unknown> } } };
    };
    delete truncated.data.version.content.creative.constraints;
    expect(isProductionBriefResponse(truncated, projectId, versionId)).toBe(false);
  });
});
