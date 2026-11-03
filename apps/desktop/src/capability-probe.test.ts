import { describe, expect, it, vi } from "vitest";
import type { AgentLog } from "./agent-log";
import { runCapabilityProbe } from "./capability-probe";

describe("capability probe", () => {
  it("logs one membership call for each documented capability", async () => {
    const lines: { endpoint: string; httpStatus: number; parsed?: string }[] = [];
    const log: AgentLog = {
      write(line) {
        lines.push({ endpoint: line.endpoint, httpStatus: line.httpStatus, parsed: line.parsed });
      },
    };
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ request_id: "req" }), { status: 200 }),
    );
    await runCapabilityProbe({
      fetch: fetch as unknown as typeof globalThis.fetch,
      token: "membership-token",
      log,
      api: "https://api.x.ai/v1",
    });
    expect(lines.map((line) => line.endpoint)).toEqual([
      "reference-images",
      "first-last-frame",
      "keyframes",
      "video-voice",
      "vision",
      "tts-timestamps",
      "image-edit",
      "quality-medium",
    ]);
    expect(lines.every((line) => line.httpStatus === 200 && line.parsed === "accepted")).toBe(true);
    const bodies = fetch.mock.calls.map((call) => {
      const init = (call as unknown as [string, RequestInit])[1];
      return typeof init?.body === "string" ? init.body : "";
    });
    expect(bodies.join("\n")).not.toContain("membership-token");
    expect(bodies.some((body) => body.includes("reference_images"))).toBe(true);
    expect(bodies.some((body) => body.includes("last_frame"))).toBe(true);
    expect(bodies.some((body) => body.includes("keyframes"))).toBe(true);
    expect(bodies.some((body) => body.includes("reference_audios"))).toBe(true);
    expect(bodies.some((body) => body.includes("with_timestamps"))).toBe(true);
    expect(bodies.some((body) => body.includes('"quality":"medium"'))).toBe(true);
  });
});
