import { afterEach, describe, expect, test, vi } from "vitest";

import { createStudioTransport, type HealthResponse, type ProjectData } from "./studio";

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const health: HealthResponse = {
  data: { status: "ok", service: "aijian-api", version: "0.1.0" },
  request_id: requestId,
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

afterEach(() => {
  delete window.aijian;
  vi.unstubAllGlobals();
});

describe("studio transport", () => {
  test("uses the narrow Electron preload bridge when it is available", async () => {
    const bridge = {
      health: vi.fn().mockResolvedValue(health),
      listProjects: vi.fn().mockResolvedValue({ data: [project], request_id: requestId }),
      createProject: vi.fn().mockResolvedValue({ data: project, request_id: requestId }),
      getProject: vi.fn().mockResolvedValue({ data: project, request_id: requestId }),
      listSources: vi.fn(),
      getSource: vi.fn(),
      importTextSource: vi.fn(),
    };
    window.aijian = bridge;
    const transport = createStudioTransport();

    await transport.getHealth();
    await transport.listProjects();
    await transport.createProject({
      name: project.name,
      aspect_ratio: "9:16",
      target_duration_seconds: 90,
      source_language: "zh-CN",
    });
    await transport.getProject(project.id);
    await transport.listSources(project.id);
    await transport.getSource(project.id, `src_${"b".repeat(32)}`);
    await transport.importTextSource(project.id, {
      filename: "story.txt",
      media_type: "text/plain",
      content_base64: "5p2l5L+hCg==",
    });

    expect(bridge.health).toHaveBeenCalledOnce();
    expect(bridge.listProjects).toHaveBeenCalledOnce();
    expect(bridge.createProject).toHaveBeenCalledOnce();
    expect(bridge.getProject).toHaveBeenCalledWith(project.id);
    expect(bridge.listSources).toHaveBeenCalledWith(project.id);
    expect(bridge.getSource).toHaveBeenCalledWith(project.id, `src_${"b".repeat(32)}`);
    expect(bridge.importTextSource).toHaveBeenCalledOnce();
  });

  test("uses versioned same-origin routes in a browser", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(health))
      .mockResolvedValueOnce(Response.json({ data: [project], request_id: requestId }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.getHealth()).resolves.toEqual(health);
    await expect(transport.listProjects()).resolves.toEqual({
      data: [project],
      request_id: requestId,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/health", {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/projects", {
      headers: { Accept: "application/json" },
    });
  });

  test("posts project and source inputs without adding local paths", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: project, request_id: requestId }, { status: 201 }),
      )
      .mockResolvedValueOnce(Response.json({ data: project, request_id: requestId }))
      .mockResolvedValueOnce(
        Response.json({ data: { id: "source" }, request_id: requestId }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();
    const projectInput = {
      name: project.name,
      aspect_ratio: "9:16" as const,
      target_duration_seconds: 90,
      source_language: "zh-CN" as const,
    };
    const sourceInput = {
      filename: "story.txt",
      media_type: "text/plain" as const,
      content_base64: "5p2l5L+hCg==",
    };

    await transport.createProject(projectInput);
    await transport.getProject(project.id);
    await transport.importTextSource(project.id, sourceInput);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/projects", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(projectInput),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/projects/${project.id}`, {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/v1/projects/${project.id}/sources`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(sourceInput),
    });
  });

  test("restores source summaries and details through versioned browser routes", async () => {
    const sourceId = `src_${"b".repeat(32)}`;
    const listResponse = { data: [], request_id: requestId };
    const detailResponse = { data: { id: sourceId }, request_id: requestId };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(listResponse))
      .mockResolvedValueOnce(Response.json(detailResponse));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.listSources(project.id)).resolves.toEqual(listResponse);
    await expect(transport.getSource(project.id, sourceId)).resolves.toEqual(detailResponse);
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/v1/projects/${project.id}/sources`, {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/projects/${project.id}/sources/${sourceId}`,
      { headers: { Accept: "application/json" } },
    );
  });

  test("rejects HTTP failures and malformed health payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.getHealth()).rejects.toThrow("status 503");
    await expect(transport.getHealth()).rejects.toThrow("published contract");
  });
});
