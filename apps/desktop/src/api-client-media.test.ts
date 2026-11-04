import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createLocalApiClient, type LocalApiClient } from "./api-client";
import type { MediaAsset, MediaAssetVersion } from "./media-asset-contract";

const project = `prj_${"a".repeat(32)}`;
const assetId = `asset_${"b".repeat(32)}`;
const versionId = `asv_${"c".repeat(32)}`;
const episode = `ep_${"d".repeat(32)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
const bytes = Buffer.from("synthetic image bytes");
const hash = createHash("sha256").update(bytes).digest("hex");
const version: MediaAssetVersion = {
  id: versionId,
  ordinal: 1,
  filename: "synthetic.png",
  kind: "image",
  mime_type: "image/png",
  byte_size: bytes.length,
  sha256: hash,
  rights_status: "PENDING_REVIEW",
  source_kind: "LOCAL_IMPORT",
  technical_metadata: {},
  created_at: "2026-09-14T00:00:00Z",
  availability: "VERIFIED",
};
function asset(referenced = false): MediaAsset {
  return {
    id: assetId,
    project_id: project,
    created_at: version.created_at,
    latest_version: version,
    versions: [version],
    episode_references: referenced
      ? [
          {
            episode_id: episode,
            version_id: versionId,
            role: "background",
            created_at: version.created_at,
          },
        ]
      : [],
  };
}
function json(data: unknown, status = 200) {
  return Response.json(
    { request_id: requestId, data },
    { status, headers: { "X-Request-ID": requestId } },
  );
}
const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

const mutations: {
  name: string;
  method: string;
  path: string;
  run: (client: LocalApiClient, projectId: string) => Promise<unknown>;
}[] = [
  {
    name: "add reference",
    method: "POST",
    path: `/assets/${assetId}/episode-references`,
    run: (c, id) =>
      c.addProjectMediaAssetEpisodeReference(id, assetId, {
        episode_id: episode,
        version_id: versionId,
        role: "background",
      }),
  },
  {
    name: "remove reference",
    method: "DELETE",
    path: `/assets/${assetId}/episode-references/${episode}?role=background`,
    run: (c, id) =>
      c.removeProjectMediaAssetEpisodeReference(id, assetId, {
        episode_id: episode,
        role: "background",
      }),
  },
  {
    name: "delete",
    method: "DELETE",
    path: `/assets/${assetId}`,
    run: (c, id) => c.deleteProjectMediaAsset(id, assetId),
  },
];

describe.each(mutations)("media $name boundary", (item) => {
  test("rejects invalid project identity without HTTP", async () => {
    const fetcher = vi.fn();
    await expect(item.run(createLocalApiClient(fetcher, session), "invalid")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  test.each(["network", "invalid JSON", "malformed 200", "untrusted 500", "definite 409"])(
    "does not replay the mutation after %s",
    async (outcome) => {
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
        if (outcome === "network") throw new Error("synthetic disconnect");
        if (outcome === "invalid JSON") return new Response("{");
        if (outcome === "definite 409")
          return Response.json(
            {
              request_id: requestId,
              error: { code: "ASSET_IN_USE", message: "Synthetic", details: {}, retryable: false },
            },
            { status: 409, headers: { "X-Request-ID": requestId } },
          );
        return json({}, outcome === "untrusted 500" ? 500 : 200);
      });
      const result = await item.run(createLocalApiClient(fetcher, session), project);
      expect(result).toMatchObject({
        kind: outcome === "definite 409" ? "DEFINITE_SERVER_ERROR" : "REMOTE_UNKNOWN",
      });
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe(`${session.origin}/api/v1/projects/${project}${item.path}`);
      expect(init?.method).toBe(item.method);
    },
  );
});

describe("media authoritative receipts and owned local import", () => {
  test.each([
    "ready",
    "missing version",
    "bad etag",
    "bad mime",
    "bad length",
    "oversized declaration",
    "changed bytes",
    "empty body",
    "network",
    "bad error body",
  ])("verifies preview identity and bytes before exposing media: %s", async (outcome) => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      if (fetcher.mock.calls.length === 1) return json([asset()]);
      if (outcome === "network") throw new Error("synthetic disconnect");
      if (outcome === "bad error body") return new Response("{", { status: 503 });
      const content =
        outcome === "changed bytes"
          ? Buffer.alloc(bytes.length, 0)
          : outcome === "bad length"
            ? Buffer.from("short")
            : bytes;
      return new Response(outcome === "empty body" ? null : content, {
        headers: {
          ETag: outcome === "bad etag" ? '"wrong"' : `"sha256-${hash}"`,
          "Content-Type": outcome === "bad mime" ? "text/html" : "image/png",
          "Content-Length":
            outcome === "oversized declaration" ? String(33 * 1024 * 1024) : String(content.length),
        },
      });
    });
    const result = await createLocalApiClient(fetcher, session).readProjectMediaAssetPreview(
      project,
      assetId,
      outcome === "missing version" ? `asv_${"f".repeat(32)}` : versionId,
    );
    if (outcome === "ready") {
      expect(result).toEqual({
        kind: "READY",
        mime_type: "image/png",
        sha256: hash,
        bytes: new Uint8Array(bytes),
      });
    } else expect(result).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(outcome === "missing version" ? 1 : 2);
    expect(fetcher.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });

  test("reads an exact project-bound asset list and detail", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json([asset()]))
      .mockResolvedValueOnce(json(asset()));
    const client = createLocalApiClient(fetcher, session);
    expect(await client.listProjectMediaAssets(project)).toMatchObject({
      kind: "LISTED",
      receipt: { data: [asset()] },
    });
    expect(await client.getProjectMediaAsset(project, assetId)).toMatchObject({
      kind: "FOUND",
      receipt: { data: asset() },
    });
  });

  test.each([true, false])(
    "requires a matching reference in the add receipt: %s",
    async (present) => {
      const client = createLocalApiClient(
        vi.fn(async () => json(asset(present))),
        session,
      );
      expect(
        await client.addProjectMediaAssetEpisodeReference(project, assetId, {
          episode_id: episode,
          version_id: versionId,
          role: "background",
        }),
      ).toMatchObject({ kind: present ? "REFERENCED" : "REMOTE_UNKNOWN" });
    },
  );

  test.each([true, false])(
    "requires reference absence in the remove receipt: %s",
    async (present) => {
      const client = createLocalApiClient(
        vi.fn(async () => json(asset(present))),
        session,
      );
      expect(
        await client.removeProjectMediaAssetEpisodeReference(project, assetId, {
          episode_id: episode,
          role: "background",
        }),
      ).toMatchObject({ kind: present ? "REMOTE_UNKNOWN" : "UNREFERENCED" });
    },
  );

  test("accepts a successful deletion only for HTTP 204", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    expect(
      await createLocalApiClient(fetcher, session).deleteProjectMediaAsset(project, assetId),
    ).toEqual({ kind: "DELETED" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each([null, assetId])(
    "streams the explicitly selected local file into asset %s",
    async (existingId) => {
      const root = await mkdtemp(join(tmpdir(), "aivora-media-client-"));
      temporary.push(root);
      const path = join(root, "synthetic.png");
      await writeFile(path, bytes);
      const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
        const chunks: Buffer[] = [];
        for await (const chunk of init?.body as unknown as AsyncIterable<Buffer>)
          chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(bytes);
        expect(init?.headers).toMatchObject({
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.length),
          "X-Aivora-Filename": "synthetic.png",
        });
        return json(asset(), 201);
      });
      expect(
        await createLocalApiClient(fetcher, session).importProjectMediaAssetFile(
          project,
          existingId,
          path,
        ),
      ).toMatchObject({ kind: "IMPORTED", receipt: { data: asset() } });
      expect(fetcher.mock.calls[0]?.[0]).toBe(
        `${session.origin}/api/v1/projects/${project}/assets/${existingId ? existingId + "/versions/" : ""}import`,
      );
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  test("rejects absent, empty and directory inputs without HTTP", async () => {
    const root = await mkdtemp(join(tmpdir(), "aivora-media-client-"));
    temporary.push(root);
    const empty = join(root, "empty.png");
    await writeFile(empty, "");
    const fetcher = vi.fn();
    const client = createLocalApiClient(fetcher, session);
    for (const path of [root, empty, join(root, "missing.png")]) {
      expect(await client.importProjectMediaAssetFile(project, null, path)).toEqual({
        kind: "LOCAL_FILE_REJECTED",
        code: "INVALID_FILE",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
