import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStoryFilmClient, type StoryFilmCreateInput } from "./story-film-client";

const project = `prj_${"a".repeat(32)}`;
const session = { origin: "http://127.0.0.1:51111", token: "s".repeat(43) };
const account = { accountSha256: "b".repeat(64), bearer: "actual-private-bearer" };
const input: StoryFilmCreateInput = {
  scene_label: "雨夜",
  narration: "你好。",
  provider: "grok_subscription",
  confirmed: false,
  shots: [{ narration: "你好。", prompt: "原始画面", duration_seconds: 3, regenerate: true }],
};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const ok = () =>
  new Response(JSON.stringify({ data: { status: "BLOCKED" }, request_id: "synthetic" }));

describe("private prepared video wire admission", () => {
  it("arms exactly the original serialized body then binds its private arm in the final signature", async () => {
    const fetcher = vi.fn(async () => ok());
    const client = createStoryFilmClient(fetcher, session);
    const arm = vi.fn(async (_body: string) => ({ armId: "c".repeat(32), current: () => true }));
    await client.create(project, input, account.bearer, account, { arm });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(arm).toHaveBeenCalledOnce();
    expect(arm.mock.calls[0]![0]).toBe(init.body);
    expect(JSON.parse(init.body as string).shots[0].regenerate).toBe(true);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Aivora-Prepared-Generation"]).toBe("c".repeat(32));
    const signed = JSON.parse(
      Buffer.from(headers["X-Aivora-Generation-Account"]!, "base64url").toString(),
    );
    const message = [
      "aivora-video-account-v2",
      project,
      headers["Idempotency-Key"],
      digest(init.body as string),
      digest(account.bearer),
      account.accountSha256,
      String(signed.expires),
      "c".repeat(32),
    ].join("\n");
    expect(signed.signature).toBe(
      createHmac("sha256", session.token).update(message).digest("hex"),
    );
  });

  it("rechecks retirement after an actual asynchronous arm and does not dispatch or silently retry", async () => {
    let finish!: (value: { armId: string; current: () => boolean }) => void;
    const held = new Promise<{ armId: string; current: () => boolean }>((resolve) => {
      finish = resolve;
    });
    const fetcher = vi.fn(async () => ok());
    const client = createStoryFilmClient(fetcher, session);
    const arm = vi.fn(() => held);
    let current = true;
    const pending = client.create(project, input, account.bearer, account, { arm });
    expect(arm).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    current = false;
    finish({ armId: "c".repeat(32), current: () => current });
    await expect(pending).rejects.toThrow("EXECUTION_UNAVAILABLE");
    expect(fetcher).not.toHaveBeenCalled();
    expect(arm).toHaveBeenCalledOnce();
  });
});
