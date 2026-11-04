import { describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createLocalApiClient, type LocalApiClient } from "./api-client";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const version = `ver_${"c".repeat(32)}`;
const asset = `asset_${"d".repeat(32)}`;
const connection = `pcn_${"e".repeat(32)}`;
const proposal = `prp_${"f".repeat(32)}`;
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
type ReadCase = {
  name: string;
  id: string;
  path: string;
  unknown?: string;
  read: (client: LocalApiClient, id: string) => Promise<unknown>;
};
const cases: ReadCase[] = [
  {
    name: "media listing",
    id: project,
    path: `/projects/${project}/assets`,
    read: (c, id) => c.listProjectMediaAssets(id),
  },
  {
    name: "media detail",
    id: project,
    path: `/projects/${project}/assets/${asset}`,
    read: (c, id) => c.getProjectMediaAsset(id, asset),
  },
  {
    name: "script",
    id: project,
    path: `/projects/${project}/episodes/${episode}/script`,
    read: (c, id) => c.getEpisodeScript(id, episode),
  },
  {
    name: "script version",
    id: project,
    path: `/projects/${project}/episodes/${episode}/script/versions/${version}`,
    read: (c, id) => c.getEpisodeScriptVersion(id, episode, version),
  },
  {
    name: "script confirmation",
    id: project,
    path: `/projects/${project}/episodes/${episode}/script/confirmation`,
    read: (c, id) => c.getEpisodeScriptConfirmation(id, episode),
  },
  {
    name: "source extraction",
    id: project,
    path: `/projects/${project}/source-extraction`,
    read: (c, id) => c.getSourceExtraction(id),
  },
  {
    name: "source extraction version",
    id: project,
    path: `/projects/${project}/source-extraction/versions/${version}`,
    read: (c, id) => c.getSourceExtractionVersion(id, version),
  },
  {
    name: "versioned proposal",
    id: project,
    path: `/projects/${project}/proposals/${proposal}`,
    read: (c, id) => c.readVersionedSourceExtractionProposal(id, proposal),
  },
  {
    name: "source acceptance",
    id: project,
    path: `/projects/${project}/source-extraction/versions/${version}/proposal-acceptance`,
    read: (c, id) => c.getSourceProposalAcceptanceForVersion(id, version),
  },
  {
    name: "Sub2API readiness",
    id: connection,
    path: `/provider-connections/${connection}/sub2api-configured-readiness?model_id=text%20model`,
    read: (c, id) => c.readSub2APIConfiguredReadiness(id, "text model"),
    unknown: "READINESS_UNKNOWN",
  },
];

describe.each(cases)("$name read boundary", (item) => {
  test("rejects a cross-boundary or malformed identity before HTTP", async () => {
    const fetcher = vi.fn();
    await expect(item.read(createLocalApiClient(fetcher, session), "../other")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each(["network", "malformed JSON", "malformed receipt", "untrusted 404", "untrusted 500"])(
    "preserves unknown for %s and never retries or mutates",
    async (outcome) => {
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
        if (outcome === "network") throw new Error("synthetic network failure");
        if (outcome === "malformed JSON") return new Response("{");
        return Response.json(
          { unexpected: true },
          {
            status: outcome === "untrusted 404" ? 404 : outcome === "untrusted 500" ? 500 : 200,
          },
        );
      });
      expect(await item.read(createLocalApiClient(fetcher, session), item.id)).toMatchObject({
        kind: item.unknown ?? "REMOTE_UNKNOWN",
      });
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe(`${session.origin}/api/v1${item.path}`);
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    },
  );
});

describe("source text identity and content integrity", () => {
  const source = `src_${"1".repeat(32)}`;
  const text = "合成来源\n第二段";
  const body = {
    request_id: "123e4567-e89b-42d3-a456-426614174000",
    data: {
      id: source,
      project_id: project,
      raw_sha256: "2".repeat(64),
      normalized_text: text,
      normalized_sha256: createHash("sha256").update(text).digest("hex"),
    },
  };
  test("returns normalized text only for the requested source and matching digest", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(body));
    expect(await createLocalApiClient(fetcher, session).getSourceText(project, source)).toEqual(
      body,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe(
      `${session.origin}/api/v1/projects/${project}/sources/${source}/text`,
    );
    expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined();
  });
  test.each([
    { normalized_text: "tampered" },
    { normalized_sha256: "0".repeat(64) },
    { id: `src_${"3".repeat(32)}` },
    { project_id: `prj_${"4".repeat(32)}` },
    { raw_sha256: "invalid" },
    { unexpected: "field" },
  ])("rejects tampered or cross-project response %#", async (change) => {
    const fetcher = vi.fn(async () =>
      Response.json({ ...body, data: { ...body.data, ...change } }),
    );
    await expect(
      createLocalApiClient(fetcher, session).getSourceText(project, source),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  test("rejects invalid identities before fetching", async () => {
    const fetcher = vi.fn();
    const client = createLocalApiClient(fetcher, session);
    await expect(client.getSourceText("../project", source)).rejects.toThrow();
    await expect(client.getSourceText(project, "../source")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
