import { describe, expect, it, vi } from "vitest";
import { completeText, completeTextWithResponseId } from "./chatgpt-auth-inference";
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

describe("main-only completed response provenance", () => {
  it("returns exact raw JSON with trustworthy provider response ID without changing text-only API", async () => {
    const text = '{"provenance":"AI","fixture":"no remote use"}';
    const event = {
      ...completed,
      response: {
        ...completed.response,
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
      },
    };
    expect(
      await completeTextWithResponseId(
        input,
        vi.fn(async () =>
          stream([{ type: "response.created", response: { id: "resp_fixture" } }, event]),
        ),
        AbortSignal.timeout(1000),
      ),
    ).toEqual({ text, responseId: "resp_fixture" });
  });
  it.each(
    [
      [
        { type: "response.created", response: { id: "resp_other" } },
        { type: "response.created", response: { id: "resp_fixture" } },
        completed,
      ],
      [{ type: "response.created", response: {} }, completed],
      [{ ...completed, response: { ...completed.response, id: "resp_\nforged" } }],
      [{ ...completed, response: { ...completed.response, id: "x".repeat(241) } }],
    ].map((events) => ({ events })),
  )("rejects inconsistent or malformed provider provenance", async ({ events }) => {
    await expect(
      completeTextWithResponseId(
        input,
        vi.fn(async () => stream(events)),
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("STREAM_INVALID");
  });
});

it("main-only raw completion retains an empty completed result ID for strict backend rejection", async () => {
  const event = { ...completed, response: { ...completed.response, output: [] } };
  expect(
    await completeTextWithResponseId(
      input,
      vi.fn(async () => stream([event])),
      AbortSignal.timeout(1000),
    ),
  ).toEqual({ text: "", responseId: "resp_fixture" });
});

it("director raw mode retains exact bounded oversized completed text and ID, while text-only callers reject it", async () => {
  const text = "x".repeat(100_001);
  const event = {
    ...completed,
    response: {
      ...completed.response,
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
    },
  };
  expect(
    await completeTextWithResponseId(
      input,
      vi.fn(async () => stream([event])),
      AbortSignal.timeout(1000),
      { allowOversizedOutput: true },
    ),
  ).toEqual({ text, responseId: "resp_fixture" });
  await expect(
    completeText(
      input,
      vi.fn(async () => stream([event])),
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow("INFERENCE_OUTPUT_TOO_LARGE");
});

describe("official SSE bounded failure and identity fixtures", () => {
  it.each([
    [401, "REAUTH_REQUIRED"],
    [429, "USAGE_LIMIT"],
    [503, "OPENAI_REQUEST_FAILED"],
  ] as const)("keeps HTTP %s remote failure explicit", async (status, code) => {
    await expect(
      completeTextWithResponseId(
        input,
        vi.fn(async () => new Response(null, { status })),
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow(code);
  });
  it.each([
    new Response("{}", { headers: { "Content-Type": "application/json" } }),
    new Response(null, { headers: { "Content-Type": "text/event-stream" } }),
    new Response("data: {broken\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    stream([null]),
    stream([
      { type: "response.created", response: { id: "resp_fixture" } },
      { type: "response.in_progress", response: { id: "other" } },
      completed,
    ]),
  ])("rejects malformed bounded stream without a provider result", async (response) => {
    await expect(
      completeTextWithResponseId(
        input,
        vi.fn(async () => response),
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("STREAM_INVALID");
  });
  it("enforces4MiB complete wire cap even in director raw mode", async () => {
    const response = new Response("x".repeat(4 * 1024 * 1024 + 1), {
      headers: { "Content-Type": "text/event-stream" },
    });
    await expect(
      completeTextWithResponseId(
        input,
        vi.fn(async () => response),
        AbortSignal.timeout(1000),
        { allowOversizedOutput: true },
      ),
    ).rejects.toThrow("RESPONSE_TOO_LARGE");
  });
  it("rejects invalid caller input or instructions before provider transport", async () => {
    const fetcher = vi.fn();
    for (const patch of [
      { text: "" },
      { text: "bad\0input" },
      { instructions: "" },
      { instructions: "x".repeat(20_001) },
    ])
      await expect(
        completeTextWithResponseId({ ...input, ...patch }, fetcher, AbortSignal.timeout(1000)),
      ).rejects.toThrow("TEXT_REQUEST_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("joins CRLF chunks without replacing exact provider completion text", async () => {
    const content = "data: " + JSON.stringify(completed) + "\r\n\r\n";
    const chunks = [content.slice(0, -3), content.slice(-3, -1), content.slice(-1)];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    expect(
      await completeTextWithResponseId(
        input,
        vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })),
        AbortSignal.timeout(1000),
      ),
    ).toEqual({ text: "Fixture completion", responseId: "resp_fixture" });
  });
});

it("ignores SSE heartbeat and unrelated output entries, sends exact instructions, and tolerates cleanup failure", async () => {
  const event = {
    ...completed,
    response: {
      ...completed.response,
      output: [
        { type: "message", role: "user", content: [] },
        { type: "tool_call" },
        {
          type: "message",
          role: "assistant",
          content: [
            null,
            { type: "reasoning", text: "ignore" },
            { type: "output_text", text: "Fixture completion" },
          ],
        },
      ],
    },
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`:heartbeat\n\ndata: ${JSON.stringify(event)}\n\n`),
      );
    },
    cancel() {
      throw new Error("Synthetic cleanup interruption");
    },
  });
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
  );
  expect(
    await completeTextWithResponseId(
      { ...input, instructions: "Exact synthetic instructions" },
      fetcher,
      AbortSignal.timeout(1000),
    ),
  ).toEqual({ text: "Fixture completion", responseId: "resp_fixture" });
  expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body)).instructions).toBe(
    "Exact synthetic instructions",
  );
});
