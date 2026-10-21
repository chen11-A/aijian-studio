import { expect, test, vi } from "vitest";

import { createLocalApiClient } from "./api-client";
import type { EditSub2APIMetadataCommand } from "./sub2api-connection-mutation-contract";

const connectionId = `pcn_${"6".repeat(32)}`;
const command: EditSub2APIMetadataCommand = {
  expected_revision: 1,
  display_name: "Local connection updated",
  base_url: "http://127.0.0.1:43124",
  origin_mode: "LOCAL_LOOPBACK_HTTP",
  enabled: true,
  models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
};
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };

test("metadata edits are retired before any deadline or HTTP", async () => {
  const fetcher = vi.fn();
  await expect(
    createLocalApiClient(fetcher, session).editSub2APIMetadata(connectionId, command),
  ).resolves.toEqual({
    kind: "DEFINITE_SERVER_ERROR",
    status: 410,
    code: "SUB2API_DISPATCH_RETIRED",
    request_id: "00000000-0000-4000-8000-000000000410",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
