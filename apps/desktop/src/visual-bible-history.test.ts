import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { VisualRead, VisualHistoryPage } from "@aijian/contracts/visual-bible";
import { createVisualBibleClient } from "./visual-bible-client";
const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "src/visual-bible.testFixtures.json"), "utf8"),
) as { saved: VisualRead; request_id: string };
function page(): VisualHistoryPage {
  const v = fixture.saved.version;
  return {
    project_id: fixture.saved.project_id,
    head: fixture.saved.head,
    cursor: null,
    limit: 20,
    next_cursor: null,
    items: [
      {
        id: v.id,
        artifact_id: v.artifact_id,
        version_number: v.version_number,
        content_hash: v.content_hash,
        parent_version_id: v.parent_version_id,
        creative_library_version_id: v.content.creative_library_version_id,
        creative_library_content_hash: v.content.creative_library_content_hash,
        author_actor_id: v.author_actor_id,
        change_summary: v.change_summary,
        change_reason: v.content.change_reason,
        created_at: v.created_at,
      },
    ],
  };
}
const response = (data: unknown) => ({
  status: 200,
  payload: { data, request_id: fixture.request_id },
  requestId: fixture.request_id,
});
describe("G5 bounded native history contract", () => {
  it("binds the exact project and cursor and never performs a write or original decode", async () => {
    const http = vi.fn().mockResolvedValue(response(page()));
    const client = createVisualBibleClient(http, {});
    expect((await client.listVisualBibleVersions(fixture.saved.project_id, null)).kind).toBe(
      "FOUND",
    );
    expect(http).toHaveBeenCalledWith(
      `/api/v1/projects/${fixture.saved.project_id}/visual-bible/history?limit=20`,
      { headers: {} },
    );
    const cursor = fixture.saved.version.id;
    http.mockResolvedValue(response({ ...page(), cursor, items: [] }));
    expect((await client.listVisualBibleVersions(fixture.saved.project_id, cursor)).kind).toBe(
      "FOUND",
    );
    expect(http.mock.calls[1]?.[0]).toContain(`&cursor=${cursor}`);
    expect(http.mock.calls.every((x) => (x[1] as RequestInit).method === undefined)).toBe(true);
  });
  it.each(["project", "cursor", "limit", "latest", "owner", "duplicate", "extra"])(
    "refuses %s receipts as unknown",
    async (fault) => {
      const data = page();
      if (fault === "project") data.project_id = "prj_" + "0".repeat(32);
      if (fault === "cursor") data.cursor = data.items[0]!.id;
      if (fault === "limit") data.limit = 21;
      if (fault === "latest")
        data.head = { ...data.head, latest_version_id: "ver_" + "0".repeat(32) };
      if (fault === "owner")
        data.items[0] = { ...data.items[0]!, artifact_id: "art_" + "0".repeat(32) };
      if (fault === "duplicate") data.items = [...data.items, ...data.items];
      if (fault === "extra") Object.assign(data, { approved: true });
      const http = vi.fn().mockResolvedValue(response(data));
      expect(
        (
          await createVisualBibleClient(http, {}).listVisualBibleVersions(
            fixture.saved.project_id,
            null,
          )
        ).kind,
      ).toBe("REMOTE_UNKNOWN");
      expect(http).toHaveBeenCalledTimes(1);
    },
  );
});
