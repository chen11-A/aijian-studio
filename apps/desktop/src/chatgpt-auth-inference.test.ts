import { describe, expect, it, vi } from "vitest";
import { completeText } from "./chatgpt-auth-inference";
const input = {
  model: "fixture-text",
  text: "Line one\nLine two",
  catalog: [{ slug: "fixture-text", displayName: "Fixture text" }],
  accessToken: "fixture-access",
};
const completed = {
  type: "response.completed",
  response: {
    id: "resp_fixture",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Fixture completion" }],
      },
    ],
  },
};
const stream = (events: unknown[]) =>
  new Response(events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
describe("official text Responses transport using SSE fixtures", () => {
  it("uses only supported public fields and returns a completed response", async () => {
    const fetcher = vi.fn(async () => stream([completed]));
    expect(await completeText(input, fetcher, AbortSignal.timeout(1000))).toBe(
      "Fixture completion",
    );
    expect(fetcher.mock.calls[0]).toBeDefined();
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(call[1].body))).toEqual({
      model: "fixture-text",
      input: [{ role: "user", content: "Line one\nLine two" }],
      store: false,
      stream: true,
    });
  });
  it.each(
    [
      [{ type: "response.output_text.delta", delta: "partial" }],
      [{ type: "response.failed" }],
      [{ type: "response.incomplete" }],
      [],
    ].map((events) => ({ events })),
  )("never treats partial or failed streams as completed", async ({ events }) => {
    await expect(
      completeText(
        input,
        vi.fn(async () => stream(events)),
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("INFERENCE_INCOMPLETE");
  });
  it("rejects models absent from the selected account without sending", async () => {
    const fetcher = vi.fn();
    await expect(
      completeText({ ...input, model: "not-authorized" }, fetcher, AbortSignal.timeout(1000)),
    ).rejects.toThrow("TEXT_REQUEST_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects mismatched response identity and empty completion", async () => {
    await expect(
      completeText(
        input,
        vi.fn(async () =>
          stream([{ type: "response.created", response: { id: "other" } }, completed]),
        ),
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("STREAM_INVALID");
    await expect(
      completeText(
        input,
        vi.fn(async () =>
          stream([{ ...completed, response: { ...completed.response, output: [] } }]),
        ),
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("INFERENCE_EMPTY");
  });
});
