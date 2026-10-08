import type { ChatGPTModel } from "@aijian/contracts/chatgpt-auth";
import { ChatGPTError, RESOURCE, isRecord, safeString } from "./chatgpt-auth-oauth";
import type { Fetch } from "./chatgpt-auth-http";

/** Only call after the main-process caller obtains explicit approval for this input and one request. */
export async function completeText(
  input: {
    model: string;
    text: string;
    instructions?: string;
    catalog: ChatGPTModel[];
    accessToken: string;
  },
  fetcher: Fetch,
  signal: AbortSignal,
): Promise<string> {
  if (
    !input.catalog.some((model) => model.slug === input.model) ||
    !(
      typeof input.text === "string" &&
      input.text.trim() &&
      input.text.length <= 100_000 &&
      !input.text.includes(String.fromCharCode(0))
    ) ||
    (input.instructions !== undefined &&
      !(
        typeof input.instructions === "string" &&
        input.instructions.trim() &&
        input.instructions.length <= 20_000
      ))
  )
    throw new ChatGPTError("TEXT_REQUEST_INVALID");
  const response = await fetcher(`${RESOURCE}/responses`, {
    method: "POST",
    redirect: "error",
    signal,
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: input.model,
      input: [{ role: "user", content: input.text }],
      ...(input.instructions ? { instructions: input.instructions } : {}),
      store: false,
      stream: true,
    }),
  });
  if (!response.ok)
    throw new ChatGPTError(
      response.status === 401
        ? "REAUTH_REQUIRED"
        : response.status === 429
          ? "USAGE_LIMIT"
          : "OPENAI_REQUEST_FAILED",
    );
  if (!response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body)
    throw new ChatGPTError("STREAM_INVALID");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  let responseId: string | null = null;
  function consume(block: string): string | null {
    const raw = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!raw) return null;
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      throw new ChatGPTError("STREAM_INVALID");
    }
    if (!isRecord(event)) throw new ChatGPTError("STREAM_INVALID");
    if (["error", "response.failed", "response.incomplete"].includes(String(event.type)))
      throw new ChatGPTError("INFERENCE_INCOMPLETE");
    if (
      event.type === "response.created" &&
      isRecord(event.response) &&
      safeString(event.response.id)
    )
      responseId = event.response.id;
    if (event.type !== "response.completed") return null;
    const result = event.response;
    if (
      !isRecord(result) ||
      result.status !== "completed" ||
      !safeString(result.id) ||
      (responseId !== null && result.id !== responseId) ||
      !Array.isArray(result.output)
    )
      throw new ChatGPTError("STREAM_INVALID");
    const text = result.output
      .flatMap((item) =>
        isRecord(item) &&
        item.type === "message" &&
        item.role === "assistant" &&
        Array.isArray(item.content)
          ? item.content
          : [],
      )
      .filter(
        (part): part is Record<string, unknown> =>
          isRecord(part) && part.type === "output_text" && typeof part.text === "string",
      )
      .map((part) => part.text)
      .join("");
    if (!text.trim()) throw new ChatGPTError("INFERENCE_EMPTY");
    if (text.length > 100_000) throw new ChatGPTError("INFERENCE_OUTPUT_TOO_LARGE");
    return text;
  }
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new ChatGPTError("INFERENCE_INCOMPLETE");
      bytes += chunk.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new ChatGPTError("RESPONSE_TOO_LARGE");
      buffer += decoder.decode(chunk.value, { stream: true });
      // Normalize only after joining chunks, preserving CRLF split at a chunk boundary.
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const result = consume(block);
        if (result !== null) return result;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
