import type { components } from "@aijian/contracts";
import { describe, expect, test, vi } from "vitest";

import { createLocalApiClient } from "./api-client";

type HealthResponse = components["schemas"]["HealthResponse"];
type ProjectData = components["schemas"]["ProjectData"];
type ProjectListResponse = components["schemas"]["ProjectListResponse"];
type ProjectResponse = components["schemas"]["ProjectResponse"];
type SourceDocumentResponse = components["schemas"]["SourceDocumentResponse"];
type SourceDocumentListResponse = components["schemas"]["SourceDocumentListResponse"];

const healthyResponse: HealthResponse = {
  data: { status: "ok", service: "aijian-api", version: "0.1.0" },
  request_id: "88ed7974-adc3-4e35-a5c8-38b9674fc45c",
};

const session = {
  origin: "http://127.0.0.1:43123",
  token: "s".repeat(43),
};
const project: ProjectData = {
  id: `prj_${"a".repeat(32)}`,
  name: "雾城来信",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 1,
  created_at: "2026-08-03T03:00:00Z",
  updated_at: "2026-08-03T03:00:00Z",
};
const projectResponse: ProjectResponse = { data: project, request_id: healthyResponse.request_id };
const projectListResponse: ProjectListResponse = {
  data: [project],
  request_id: healthyResponse.request_id,
};
const sourceResponse: SourceDocumentResponse = {
  data: {
    id: `src_${"b".repeat(32)}`,
    project_id: project.id,
    filename: "雾城来信.txt",
    media_type: "text/plain",
    encoding: "utf-8",
    byte_size: 12,
    raw_sha256: "c".repeat(64),
    imported_at: "2026-08-03T03:10:00Z",
    chapter_count: 1,
    block_count: 1,
    blocks: [
      {
        id: `srcb_${"d".repeat(32)}`,
        ordinal: 0,
        kind: "chapter_heading",
        chapter_index: 1,
        text: "第一章",
        normalized_start_byte: 0,
        normalized_end_byte: 9,
        content_sha256: "e".repeat(64),
      },
    ],
  },
  request_id: healthyResponse.request_id,
};
const sourceSummary: SourceDocumentListResponse["data"][number] = {
  id: sourceResponse.data.id,
  project_id: sourceResponse.data.project_id,
  filename: sourceResponse.data.filename,
  media_type: sourceResponse.data.media_type,
  encoding: sourceResponse.data.encoding,
  byte_size: sourceResponse.data.byte_size,
  raw_sha256: sourceResponse.data.raw_sha256,
  imported_at: sourceResponse.data.imported_at,
  chapter_count: sourceResponse.data.chapter_count,
  block_count: sourceResponse.data.block_count,
};
const sourceListResponse: SourceDocumentListResponse = {
  data: [sourceSummary],
  request_id: healthyResponse.request_id,
};

describe("local API client", () => {
  test("requests health only from the configured loopback origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(healthyResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getHealth()).resolves.toEqual(healthyResponse);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:43123/api/v1/health", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        Origin: "app://aijian",
      },
    });
  });

  test.each([
    "not-a-url",
    "https://127.0.0.1:43123",
    "http://127.0.0.1",
    "http://localhost:43123",
    "http://0.0.0.0:43123",
    "http://example.com:43123",
    "http://user:password@127.0.0.1:43123",
  ])("rejects a non-canonical local API URL: %s", (origin) => {
    expect(() => createLocalApiClient(vi.fn(), { ...session, origin })).toThrow(
      "canonical loopback",
    );
  });

  test("rejects a weak sidecar token", () => {
    expect(() => createLocalApiClient(vi.fn(), { ...session, token: "short" })).toThrow(
      "valid sidecar session",
    );
  });

  test("rejects HTTP failures and malformed health payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "ok" } })));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getHealth()).rejects.toThrow("status 502");
    await expect(client.getHealth()).rejects.toThrow("published contract");
  });

  test("lists, creates, and fetches projects through authenticated requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(projectListResponse))
      .mockResolvedValueOnce(Response.json(projectResponse, { status: 201 }))
      .mockResolvedValueOnce(Response.json(projectResponse));
    const client = createLocalApiClient(fetchMock, session);
    const input = {
      name: "雾城来信",
      aspect_ratio: "9:16" as const,
      target_duration_seconds: 90,
      source_language: "zh-CN" as const,
    };

    await expect(client.listProjects()).resolves.toEqual(projectListResponse);
    await expect(client.createProject(input)).resolves.toEqual(projectResponse);
    await expect(client.getProject(project.id)).resolves.toEqual(projectResponse);
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${session.origin}/api/v1/projects`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        Origin: "app://aijian",
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${session.origin}/api/v1/projects`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
        Origin: "app://aijian",
      },
      body: JSON.stringify(input),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${session.origin}/api/v1/projects/${project.id}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
        },
      },
    );
  });

  test("imports one base64 text source without exposing a file path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(sourceResponse, { status: 201 }));
    const client = createLocalApiClient(fetchMock, session);
    const input = {
      filename: "雾城来信.txt",
      media_type: "text/plain" as const,
      content_base64: "5qyn5ZOl5p2l5L+hCg==",
    };

    await expect(client.importTextSource(project.id, input)).resolves.toEqual(sourceResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      `${session.origin}/api/v1/projects/${project.id}/sources`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
          Origin: "app://aijian",
        },
        body: JSON.stringify(input),
      },
    );
  });

  test("lists and restores a persisted source through constrained ids", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(sourceListResponse))
      .mockResolvedValueOnce(Response.json(sourceResponse));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.listSources(project.id)).resolves.toEqual(sourceListResponse);
    await expect(client.getSource(project.id, sourceResponse.data.id)).resolves.toEqual(
      sourceResponse,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${session.origin}/api/v1/projects/${project.id}/sources`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${session.origin}/api/v1/projects/${project.id}/sources/${sourceResponse.data.id}`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );

    await expect(client.getSource(project.id, "src_unsafe/path")).rejects.toThrow(
      "valid source id",
    );
  });

  test("rejects malformed renderer inputs before making a local request", async () => {
    const fetchMock = vi.fn();
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getProject("../workspace.sqlite3")).rejects.toThrow("valid project id");
    await expect(
      client.createProject({
        name: " ",
        aspect_ratio: "9:16",
        target_duration_seconds: 90,
        source_language: "zh-CN",
      }),
    ).rejects.toThrow("valid project input");
    await expect(
      client.importTextSource(project.id, {
        filename: "story.txt",
        media_type: "text/plain",
        content_base64: "not base64",
      }),
    ).rejects.toThrow("valid text source input");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects malformed project and source responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [{ name: "missing id" }] }))
      .mockResolvedValueOnce(Response.json({ data: { ...sourceResponse.data, blocks: [] } }));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.listProjects()).rejects.toThrow("published contract");
    await expect(
      client.importTextSource(project.id, {
        filename: "story.txt",
        media_type: "text/plain",
        content_base64: "5p2l5L+hCg==",
      }),
    ).rejects.toThrow("published contract");
  });
});
