import {
  mediaCommand,
  mediaHash,
  mediaOperation,
  mediaPage,
  mediaRejection,
  mediaScope,
  mediaVersionId,
  verifiedMediaVersion,
  type MediaPreparationGateway,
  type MediaPreparationOperation,
  type MediaPreparationPage,
  type MediaPreparationVersion,
} from "@aijian/contracts/media-preparation";
import { impactEnvelope } from "@aijian/contracts/script-confirmation-impact";

type Http = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;

export function createMediaPreparationClient(
  http: Http,
  headers: Record<string, string>,
): MediaPreparationGateway {
  const path = (p: string, e: string) => `/api/v1/projects/${p}/episodes/${e}`;
  async function request(url: string, init: RequestInit) {
    try {
      return await http(url, init);
    } catch {
      return null;
    }
  }
  return {
    async listMediaPreparations(p, e, cursor) {
      if (!mediaScope(p, e) || (cursor !== undefined && !mediaVersionId(cursor)))
        throw new Error("Invalid preparation list scope");
      const r = await request(
        `${path(p, e)}/media-preparations${cursor ? `?cursor=${cursor}` : ""}`,
        { method: "GET", headers },
      );
      return r?.status === 200 &&
        impactEnvelope(r.payload, r.requestId) &&
        (await mediaPage(r.payload.data, p, e))
        ? {
            kind: "FOUND",
            receipt: {
              data: r.payload.data as MediaPreparationPage,
              request_id: r.payload.request_id,
            },
          }
        : { kind: "REMOTE_UNKNOWN" };
    },
    async getMediaPreparation(p, e, id) {
      if (!mediaScope(p, e) || !mediaVersionId(id))
        throw new Error("Invalid preparation version scope");
      const r = await request(`${path(p, e)}/media-preparations/${id}`, { method: "GET", headers });
      return r?.status === 200 &&
        impactEnvelope(r.payload, r.requestId) &&
        (await verifiedMediaVersion(r.payload.data, p, e)) &&
        (r.payload.data as MediaPreparationVersion).version_id === id
        ? {
            kind: "FOUND",
            receipt: {
              data: r.payload.data as MediaPreparationVersion,
              request_id: r.payload.request_id,
            },
          }
        : { kind: "REMOTE_UNKNOWN" };
    },
    async saveMediaPreparation(p, e, command) {
      if (!mediaScope(p, e) || !mediaCommand(command, p, e))
        throw new Error("Invalid original preparation command");
      const r = await request(`${path(p, e)}/media-preparations`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": command.operation_id,
        },
        body: JSON.stringify(command.payload),
      });
      if (
        r?.status === 201 &&
        impactEnvelope(r.payload, r.requestId) &&
        (await mediaOperation(r.payload.data, p, e, command))
      )
        return {
          kind: "FOUND",
          receipt: {
            data: r.payload.data as MediaPreparationOperation,
            request_id: r.payload.request_id,
          },
        };
      if (
        r &&
        r.requestId &&
        r.payload &&
        typeof r.payload === "object" &&
        !Array.isArray(r.payload) &&
        "error" in r.payload &&
        "request_id" in r.payload &&
        r.payload.request_id === r.requestId
      ) {
        const error = r.payload.error;
        if (
          error &&
          typeof error === "object" &&
          !Array.isArray(error) &&
          Object.keys(r.payload).length === 2 &&
          Object.keys(error).length === 4 &&
          "retryable" in error &&
          error.retryable === false &&
          "details" in error &&
          error.details &&
          typeof error.details === "object" &&
          !Array.isArray(error.details) &&
          Object.keys(error.details).length === 0 &&
          "code" in error &&
          "message" in error &&
          typeof error.message === "string"
        ) {
          const rejected = {
            kind: "DEFINITE_SERVER_ERROR",
            status: r.status,
            code: error.code,
            request_id: r.requestId,
          };
          if (mediaRejection(rejected)) return rejected;
        }
      }
      return { kind: "REMOTE_UNKNOWN" };
    },
    async getMediaPreparationOperation(p, e, command) {
      if (!mediaScope(p, e) || !mediaCommand(command, p, e))
        throw new Error("Invalid original preparation recovery command");
      const hash = await mediaHash(command.payload);
      if (!hash) return { kind: "REMOTE_UNKNOWN" };
      const r = await request(
        `${path(p, e)}/media-preparation-operations/${command.operation_id}?${new URLSearchParams({ payload_hash: hash })}`,
        { method: "GET", headers },
      );
      return r?.status === 200 &&
        impactEnvelope(r.payload, r.requestId) &&
        (await mediaOperation(r.payload.data, p, e, command))
        ? {
            kind: "FOUND",
            receipt: {
              data: r.payload.data as MediaPreparationOperation,
              request_id: r.payload.request_id,
            },
          }
        : { kind: "REMOTE_UNKNOWN" };
    },
  };
}
