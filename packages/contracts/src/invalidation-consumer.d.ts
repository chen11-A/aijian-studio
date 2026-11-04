import type { components } from "./generated.js";
export type InvalidationConsumerData = components["schemas"]["InvalidationConsumerData"];
export type InvalidationConsumerResponse = components["schemas"]["InvalidationConsumerResponse"];
export type InvalidationConsumerIdentity = Pick<
  InvalidationConsumerData,
  "project_id" | "operation_id" | "path_id" | "assessment_hash" | "artifact_id" | "version_id"
>;
export type InvalidationConsumerGateway = {
  inspectInvalidationConsumer(
    identity: InvalidationConsumerIdentity,
  ): Promise<InvalidationConsumerResponse>;
};
export function invalidationConsumerIdentity(v: unknown): v is InvalidationConsumerIdentity;
export function invalidationConsumerData(
  v: unknown,
  expected: InvalidationConsumerIdentity,
): v is InvalidationConsumerData;
export function invalidationConsumerResponse(
  v: unknown,
  expected: InvalidationConsumerIdentity,
  requestId?: string,
): v is InvalidationConsumerResponse;
