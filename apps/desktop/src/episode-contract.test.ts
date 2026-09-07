import { describe, expect, test } from "vitest";

import {
  isEpisodeCreateErrorResponse,
  isEpisodeId,
  isEpisodeListResponse,
  isEpisodeProjectId,
  isEpisodeResponse,
  normalizeEpisodeCreateInput,
  validateEpisodeListQuery,
} from "./episode-contract";

const projectId = `prj_${"a".repeat(32)}`;
const episodeId = `ep_${"b".repeat(32)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";

function episode(position = "1") {
  return {
    id: episodeId,
    project_id: projectId,
    position,
    title: "第一集",
    is_default: position === "1",
    target_duration_seconds: null,
    revision: "1",
    created_at: "2026-09-07T01:02:03Z",
    updated_at: "2026-09-07T01:02:03Z",
  };
}

describe("Episode desktop contract boundary", () => {
  test("normalizes a trimmed Unicode title and preserves null separately from omission", () => {
    expect(normalizeEpisodeCreateInput({ title: "  第 一 集  " })).toEqual({ title: "第 一 集" });
    expect(normalizeEpisodeCreateInput({ title: "第一集", target_duration_seconds: null })).toEqual(
      {
        title: "第一集",
        target_duration_seconds: null,
      },
    );
    expect(
      normalizeEpisodeCreateInput({ title: "第一集", target_duration_seconds: "3600" }),
    ).toEqual({
      title: "第一集",
      target_duration_seconds: "3600",
    });
  });

  test("matches Python strip edge handling rather than JavaScript trim", () => {
    expect(normalizeEpisodeCreateInput({ title: "\u0085第一集\u001c" })).toEqual({
      title: "第一集",
    });
    expect(normalizeEpisodeCreateInput({ title: "\ufeff第一集\ufeff" })).toEqual({
      title: "\ufeff第一集\ufeff",
    });
  });

  test("counts Unicode title limits by code point and keeps duration boundaries exact", () => {
    expect(
      normalizeEpisodeCreateInput({ title: "😀".repeat(80), target_duration_seconds: "1" }),
    ).toEqual({
      title: "😀".repeat(80),
      target_duration_seconds: "1",
    });
    expect(
      normalizeEpisodeCreateInput({
        title: "😀".repeat(81),
        target_duration_seconds: "9223372036854775807",
      }),
    ).toBeNull();
    for (const duration of [true, " 1", "1e1", "9223372036854775808"]) {
      expect(
        normalizeEpisodeCreateInput({ title: "ok", target_duration_seconds: duration }),
      ).toBeNull();
    }
  });

  test.each([
    { title: " " },
    { title: "a".repeat(81) },
    { title: "bad\nname" },
    { title: "ok", target_duration_seconds: 1 },
    { title: "ok", target_duration_seconds: "01" },
    { title: "ok", extra: true },
  ])("rejects malformed create input %#", (input) => {
    expect(normalizeEpisodeCreateInput(input)).toBeNull();
  });

  test("keeps query decimal strings exact without Number conversion", () => {
    expect(validateEpisodeListQuery()).toEqual({});
    expect(validateEpisodeListQuery({ limit: 100, offset: "9007199254740993" })).toEqual({
      limit: 100,
      offset: "9007199254740993",
    });
    expect(validateEpisodeListQuery({ offset: "9223372036854775807" })).toEqual({
      offset: "9223372036854775807",
    });
  });

  test.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { offset: 0 },
    { offset: "00" },
    { offset: "+1" },
    { offset: "9223372036854775808" },
    { unknown: "value" },
  ])("rejects malformed list queries %#", (query) => {
    expect(validateEpisodeListQuery(query)).toBeNull();
  });

  test("rejects trailing newlines in canonical decimals and identifiers", () => {
    expect(normalizeEpisodeCreateInput({ title: "ok", target_duration_seconds: "1\n" })).toBeNull();
    expect(validateEpisodeListQuery({ offset: "0\n" })).toBeNull();
    expect(isEpisodeId(`${episodeId}\n`)).toBe(false);
    expect(isEpisodeProjectId(`${projectId}\n`)).toBe(false);
    expect(
      isEpisodeResponse(
        { data: { ...episode(), revision: "1\n" }, request_id: requestId },
        projectId,
      ),
    ).toBe(false);
  });

  test("accepts only an exact identity-bound Episode envelope", () => {
    const response = { data: episode(), request_id: requestId };
    expect(isEpisodeResponse(response, projectId, episodeId)).toBe(true);
    expect(isEpisodeListResponse({ data: [episode()], request_id: requestId }, projectId, 50)).toBe(
      true,
    );
  });

  test.each([
    { data: { ...episode(), project_id: `prj_${"c".repeat(32)}` }, request_id: requestId },
    { data: { ...episode(), position: "9007199254740992.0" }, request_id: requestId },
    { data: { ...episode(), created_at: "not-a-date" }, request_id: requestId },
    { data: { ...episode(), unexpected: true }, request_id: requestId },
    { data: episode(), request_id: "not-a-uuid" },
  ])("rejects malformed single responses %#", (response) => {
    expect(isEpisodeResponse(response, projectId, episodeId)).toBe(false);
  });

  test("rejects duplicate, unordered, oversized, and foreign list rows", () => {
    const second = { ...episode("2"), id: `ep_${"d".repeat(32)}`, is_default: false };
    expect(
      isEpisodeListResponse({ data: [second, episode()], request_id: requestId }, projectId, 50),
    ).toBe(false);
    expect(
      isEpisodeListResponse({ data: [episode(), episode()], request_id: requestId }, projectId, 50),
    ).toBe(false);
    expect(
      isEpisodeListResponse({ data: [episode(), second], request_id: requestId }, projectId, 1),
    ).toBe(false);
    expect(
      isEpisodeListResponse(
        { data: [{ ...episode(), project_id: `prj_${"e".repeat(32)}` }], request_id: requestId },
        projectId,
        50,
      ),
    ).toBe(false);
  });

  test("allows only the contract-valid definite create errors", () => {
    const payload = {
      error: { code: "EPISODE_CREATE_CONFLICT", message: "safe", retryable: false, details: {} },
      request_id: requestId,
    };
    expect(isEpisodeCreateErrorResponse(payload, 409)).toBe(true);
    expect(
      isEpisodeCreateErrorResponse(
        { ...payload, error: { ...payload.error, code: "VALIDATION_ERROR" } },
        409,
      ),
    ).toBe(false);
    for (const [status, code] of [
      [401, "SIDECAR_AUTH_REQUIRED"],
      [403, "SIDECAR_REQUEST_REJECTED"],
      [404, "PROJECT_NOT_FOUND"],
      [422, "VALIDATION_ERROR"],
    ] as const) {
      expect(
        isEpisodeCreateErrorResponse({ ...payload, error: { ...payload.error, code } }, status),
      ).toBe(true);
    }
    expect(isEpisodeCreateErrorResponse({ ...payload, extra: true }, 409)).toBe(false);
    expect(
      isEpisodeCreateErrorResponse(
        { ...payload, error: { ...payload.error, code: "RAW_SQL" } },
        409,
      ),
    ).toBe(false);
    expect(isEpisodeCreateErrorResponse(payload, 500)).toBe(false);
  });
});
