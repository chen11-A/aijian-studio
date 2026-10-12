import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import {
  isCreateProjectCreativeLibraryVersionRequest,
  isProjectCreativeLibraryVersionResponse,
} from "./project-creative-library-contract";
import type {
  CreateProjectCreativeLibraryVersionRequest,
  ProjectCreativeLibraryVersion,
} from "./project-creative-library-contract";

const project = `prj_${"a".repeat(32)}`;
const charA = `chr_${"b".repeat(32)}`;
const charB = `chr_${"c".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";
function request(): CreateProjectCreativeLibraryVersionRequest {
  return {
    content: {
      schema_version: "1.1.0",
      project_id: project,
      episode_id: null,
      characters: [charA, charB].map((id, i) => ({
        character_id: id,
        ordinal: i + 1,
        name: `角色${i + 1}`,
        role: "",
        description: "",
        appearance: "",
        personality: "",
      })),
      world: { premise: "", rules: "", era: "", visual_style: "", palette: "", materials: "" },
      scenes: [],
      relationships: [
        {
          relationship_id: `rel_${"d".repeat(32)}`,
          ordinal: 1,
          from_character_id: charA,
          to_character_id: charB,
          label: "同事",
          description: "",
        },
      ],
      costumes: [
        {
          costume_id: `cst_${"e".repeat(32)}`,
          ordinal: 1,
          character_id: charA,
          name: "雨衣",
          description: "深蓝色",
        },
      ],
    },
    parent_version_id: null,
    expected_revision: null,
    change_summary: "保存关系与服装",
  };
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, sorted(child)]),
  );
}
function version(content = request().content): ProjectCreativeLibraryVersion {
  return {
    version_id: `ver_${"f".repeat(32)}`,
    project_id: project,
    episode_id: null,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content,
    content_hash: `sha256:${createHash("sha256")
      .update(JSON.stringify(sorted(content)), "utf8")
      .digest("hex")}`,
    author_actor_id: "human",
    change_summary: "保存关系与服装",
    created_at: "2026-10-11T00:00:00Z",
  };
}
test("native contract accepts versioned details and rejects orphan/self/duplicate/unknown fields", () => {
  const valid = request();
  expect(isCreateProjectCreativeLibraryVersionRequest(valid, project)).toBe(true);
  const content = valid.content;
  if (content.schema_version !== "1.1.0") throw new Error("Expected detail schema");
  for (const change of [
    { from_character_id: `chr_${"1".repeat(32)}` },
    { to_character_id: charA },
    { ordinal: 2 },
    { label: " " },
    { description: "\ud800" },
    { approved: true },
  ])
    expect(
      isCreateProjectCreativeLibraryVersionRequest(
        {
          ...valid,
          content: { ...content, relationships: [{ ...content.relationships[0], ...change }] },
        },
        project,
      ),
    ).toBe(false);
  for (const change of [
    { character_id: `chr_${"1".repeat(32)}` },
    { name: " " },
    { ordinal: 0 },
    { reference_asset_id: "fabricated" },
  ])
    expect(
      isCreateProjectCreativeLibraryVersionRequest(
        { ...valid, content: { ...content, costumes: [{ ...content.costumes[0], ...change }] } },
        project,
      ),
    ).toBe(false);
  expect(
    isCreateProjectCreativeLibraryVersionRequest(
      { ...valid, content: { ...content, schema_version: "1.0.0" } },
      project,
    ),
  ).toBe(false);
  expect(
    isCreateProjectCreativeLibraryVersionRequest(
      {
        ...valid,
        content: {
          ...content,
          relationships: [...content.relationships, { ...content.relationships[0], ordinal: 2 }],
        },
      },
      project,
    ),
  ).toBe(false);
  expect(
    isCreateProjectCreativeLibraryVersionRequest(
      {
        ...valid,
        content: {
          ...content,
          costumes: [...content.costumes, { ...content.costumes[0], ordinal: 2 }],
        },
      },
      project,
    ),
  ).toBe(false);
});
test("exact native receipts verify detail hash, scope, version and canonical request content", async () => {
  const candidate = request();
  const saved = version(candidate.content);
  expect(
    isProjectCreativeLibraryVersionResponse(
      { data: saved, request_id: requestId },
      project,
      requestId,
      saved.version_id,
    ),
  ).toBe(true);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ data: { version: saved, replayed: false }, request_id: requestId }),
          { status: 201, headers: { "X-Request-ID": requestId } },
        ),
    );
  const client = createLocalApiClient(fetcher, {
    origin: "http://127.0.0.1:43124",
    token: "t".repeat(43),
  });
  expect(
    (await client.createProjectCreativeLibraryVersion(project, "details", candidate)).kind,
  ).toBe("CREATED");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const altered = structuredClone(candidate.content);
  if (altered.schema_version !== "1.1.0") throw new Error("Expected detail schema");
  altered.costumes[0]!.description = "回执被替换";
  saved.content = altered;
  expect(
    isProjectCreativeLibraryVersionResponse(
      { data: saved, request_id: requestId },
      project,
      requestId,
    ),
  ).toBe(false);
  expect(
    (await client.createProjectCreativeLibraryVersion(project, "details", candidate)).kind,
  ).toBe("REMOTE_UNKNOWN");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const validDifferent = version(altered);
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ data: { version: validDifferent, replayed: false }, request_id: requestId }),
      { status: 201, headers: { "X-Request-ID": requestId } },
    ),
  );
  expect(
    (await client.createProjectCreativeLibraryVersion(project, "details", candidate)).kind,
  ).toBe("REMOTE_UNKNOWN");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

function referenceRequest(): CreateProjectCreativeLibraryVersionRequest {
  const base = request();
  if (base.content.schema_version !== "1.1.0") throw new Error("Missing detail schema");
  return {
    ...base,
    content: {
      ...base.content,
      schema_version: "1.2.0",
      references: [
        {
          reference_id: `crf_${"1".repeat(32)}`,
          ordinal: 1,
          character_id: charA,
          costume_id: `cst_${"e".repeat(32)}`,
          asset_id: `asset_${"2".repeat(32)}`,
          asset_version_id: `asv_${"3".repeat(32)}`,
          asset_sha256: "4".repeat(64),
          label: "正面参考",
        },
      ],
    },
  };
}
test("native V3 guards preserve exact reference identity and reject ownership, Unicode and schema faults", () => {
  const valid = referenceRequest();
  expect(isCreateProjectCreativeLibraryVersionRequest(valid, project)).toBe(true);
  if (valid.content.schema_version !== "1.2.0") throw new Error("Missing reference schema");
  for (const change of [
    { character_id: charB },
    { costume_id: `cst_${"0".repeat(32)}` },
    { ordinal: true },
    { asset_id: "wrong" },
    { asset_version_id: "wrong" },
    { asset_sha256: "sha256:" + "4".repeat(64) },
    { label: " " },
    { label: "\ud800" },
    { approved: true },
  ]) {
    const content = {
      ...valid.content,
      references: [{ ...valid.content.references[0], ...change }],
    };
    expect(isCreateProjectCreativeLibraryVersionRequest({ ...valid, content }, project)).toBe(
      false,
    );
    const saved = version(content as typeof valid.content);
    expect(
      isProjectCreativeLibraryVersionResponse(
        { data: saved, request_id: requestId },
        project,
        requestId,
      ),
    ).toBe(false);
  }
  expect(
    isCreateProjectCreativeLibraryVersionRequest(
      { ...valid, content: { ...valid.content, schema_version: "1.1.0" } },
      project,
    ),
  ).toBe(false);
  expect(isCreateProjectCreativeLibraryVersionRequest(valid, `prj_${"0".repeat(32)}`)).toBe(false);
});
test("native V3 create accepts exact receipts and treats a different valid reference version as UNKNOWN without retry", async () => {
  const payload = referenceRequest();
  const exact = version(payload.content);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ data: { version: exact, replayed: false }, request_id: requestId }),
        { status: 201, headers: { "X-Request-ID": requestId } },
      ),
    );
  const client = createLocalApiClient(fetcher, {
    origin: "http://127.0.0.1:43124",
    token: "t".repeat(43),
  });
  expect(
    (await client.createProjectCreativeLibraryVersion(project, "reference", payload)).kind,
  ).toBe("CREATED");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const headers = new Headers(fetcher.mock.calls[0]![1]?.headers);
  expect(headers.get("Authorization")).toBe(`Bearer ${"t".repeat(43)}`);
  expect(headers.get("Idempotency-Key")).toBe("reference");
  const other = structuredClone(payload.content);
  if (other.schema_version !== "1.2.0") throw new Error("Missing reference schema");
  other.references[0]!.asset_version_id = `asv_${"0".repeat(32)}`;
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ data: { version: version(other), replayed: false }, request_id: requestId }),
      { status: 201, headers: { "X-Request-ID": requestId } },
    ),
  );
  expect(
    (await client.createProjectCreativeLibraryVersion(project, "reference", payload)).kind,
  ).toBe("REMOTE_UNKNOWN");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
