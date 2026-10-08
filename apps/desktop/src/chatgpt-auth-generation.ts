import { createHash } from "node:crypto";
import type { ChatGPTModel } from "@aijian/contracts/chatgpt-auth";
import { ChatGPTError } from "./chatgpt-auth-oauth";

/** Main-process-only contract. Project context and durable operation ownership stay with the trusted adapter. */
export type ChatGPTTextCommand = {
  operationId: string;
  model: string;
  text: string;
  instructions?: string;
  approvalContext?: string;
};
export type ChatGPTTextReservation = {
  operationId: string;
  profileId: string;
  model: string;
  requestHash: string;
};
export type ChatGPTTextResult =
  | ({ kind: "COMPLETED"; text: string; completedAt: string } & ChatGPTTextReservation)
  | { kind: "NOT_SENT"; operationId: string; code: string }
  | { kind: "REMOTE_UNKNOWN"; operationId: string; code: string };
export type ChatGPTTextOptions = {
  /** Persist pessimistic pending/unknown state before HTTP. Throwing must stop the request. */
  beforeSend(metadata: ChatGPTTextReservation): Promise<void>;
};
export type ChatGPTTextApproval = ChatGPTTextCommand & { profileLabel: string; modelLabel: string };
export function textRequestHash(input: ChatGPTTextCommand): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        model: input.model,
        text: input.text,
        instructions: input.instructions ?? "",
      }),
    )
    .digest("hex")}`;
}
export function validateTextCommand(input: ChatGPTTextCommand, catalog: ChatGPTModel[]): void {
  const prose = (value: unknown, max: number) =>
    typeof value === "string" &&
    value.length <= max &&
    Boolean(value.trim()) &&
    !value.includes(String.fromCharCode(0));
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      input.operationId,
    ) ||
    !catalog.some((model) => model.slug === input.model) ||
    !prose(input.text, 100_000) ||
    (input.instructions !== undefined && !prose(input.instructions, 20_000)) ||
    (input.approvalContext !== undefined && !prose(input.approvalContext, 4000))
  )
    throw new ChatGPTError("TEXT_REQUEST_INVALID");
}
