import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { generationPreparationClient } from "./generation-preparation-client";

const project = `prj_${"a".repeat(32)}`;
const execution = "b".repeat(32);
const session = { origin: "http://127.0.0.1:51001", token: "s".repeat(43) };
const account = { accountSha256: "c".repeat(64), bearer: "private-current-bearer" };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("private preparation facts client", () => {
  it("attests exact Chinese and empty wire bytes and uses only a fixed local route", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ execution_id: execution })));
    const client = generationPreparationClient({ session: () => session, fetcher });
    const input = { key: "first", targets: [{ text: "雨中等你", empty: "" }], stages: [] };
    expect(await client.register(project, input, account, () => true)).toBe(execution);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${session.origin}/api/v1/projects/${project}/prepared-generation-executions`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(input));
    const headers = init.headers as Record<string, string>;
    const assertion = JSON.parse(
      Buffer.from(headers["X-Aivora-Generation-Account"]!, "base64url").toString(),
    ) as { signature: string; expires: number };
    const message = [
      "aivora-video-account-v1",
      project,
      headers["Idempotency-Key"],
      sha(init.body as string),
      sha(account.bearer),
      account.accountSha256,
      String(assertion.expires),
    ].join("\n");
    expect(assertion.signature).toBe(
      createHmac("sha256", session.token).update(message).digest("hex"),
    );
    expect(headers["X-Aivora-Media-Bearer"]).toBe(account.bearer);
  });

  it("does not send after owner retirement or to an untrusted origin/project", async () => {
    const fetcher = vi.fn();
    const client = generationPreparationClient({ session: () => session, fetcher });
    await expect(client.register(project, {}, account, () => false)).rejects.toThrow(
      "EXECUTION_UNAVAILABLE",
    );
    await expect(client.register("other", {}, account, () => true)).rejects.toThrow();
    const external = generationPreparationClient({
      session: () => ({ ...session, origin: "https://remote.example" }),
      fetcher,
    });
    await expect(external.register(project, {}, account, () => true)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retains uncertain writes and requires exact fact ACKs instead of accepting a shaped false success", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ kind: "RECORDED", extra: true })),
    );
    const client = generationPreparationClient({ session: () => session, fetcher });
    await expect(
      client.beforeImage(project, execution, "stage", "d".repeat(64), account, () => true),
    ).rejects.toThrow("WRITE_UNCONFIRMED");
    fetcher.mockImplementation(async () => {
      throw Error("private transport detail");
    });
    await expect(
      client.observedImage(project, execution, "stage", "d".repeat(64), null, account, () => true),
    ).rejects.toThrow("WRITE_UNCONFIRMED");
    fetcher.mockImplementation(
      async () =>
        new Response(JSON.stringify({ detail: "ATTEMPT_ALREADY_RESERVED" }), { status: 409 }),
    );
    await expect(client.register(project, {}, account, () => true)).rejects.toThrow(
      "CREATION_ATTEMPT_ALREADY_RESERVED",
    );
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ kind: "RECORDED" })));
    await client.retire(project, execution, null, null, account);
    expect(
      JSON.parse((fetcher.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string),
    ).toEqual({ target_key: null, slot_index: null });
  });
});
