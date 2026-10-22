import { describe, expect, it } from "vitest";
import { listGrokModels } from "./grok-auth-http";

const endpoints = {
  token: "https://auth.example.test/token",
  revoke: "https://auth.example.test/revoke",
  userinfo: "https://auth.example.test/userinfo",
  api: "https://api.example.test/v1",
};

describe("Grok model catalog", () => {
  it("keeps output modalities from the live list and skips entries without an id", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "grok-4.7", name: "Grok 4.7" },
            {
              id: "grok-imagine-image-2.0",
              name: "Grok Imagine Image 2.0",
              output_modalities: ["image"],
            },
            { name: "missing id" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    await expect(listGrokModels(fetch, "token", endpoints)).resolves.toEqual([
      { id: "grok-4.7", label: "Grok 4.7" },
      {
        id: "grok-imagine-image-2.0",
        label: "Grok Imagine Image 2.0",
        outputModalities: ["image"],
      },
    ]);
  });
});
