import {
  assemblyExactCommand,
  assemblyExactOperation,
  assemblyExactRejection,
  type AssemblyExactGateway,
  type AssemblyExactOperation,
} from "@aijian/contracts/assembly-exact";
import { impactEnvelope } from "@aijian/contracts/script-confirmation-impact";
import { mediaHash } from "@aijian/contracts/media-preparation";

type Http = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;
export function createAssemblyExactClient(
  http: Http,
  headers: Record<string, string>,
): AssemblyExactGateway {
  async function request(url: string, init: RequestInit) {
    try {
      return await http(url, init);
    } catch {
      return null;
    }
  }
  return {
    async saveExact(p, e, c) {
      if (!assemblyExactCommand(c, p, e)) throw new Error("Invalid original assembly command");
      const r = await request(`/api/v1/projects/${p}/episodes/${e}/media-assembly/exact-versions`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": c.operation_id,
        },
        body: JSON.stringify(c.payload),
      });
      if (
        r?.status === 201 &&
        impactEnvelope(r.payload, r.requestId) &&
        (await assemblyExactOperation(r.payload.data, p, e, c))
      )
        return {
          kind: "FOUND",
          receipt: {
            data: r.payload.data as AssemblyExactOperation,
            request_id: r.payload.request_id,
          },
        };
      if (
        r &&
        r.requestId &&
        r.payload &&
        typeof r.payload === "object" &&
        !Array.isArray(r.payload) &&
        Object.keys(r.payload).length === 2 &&
        "error" in r.payload &&
        "request_id" in r.payload &&
        r.payload.request_id === r.requestId
      ) {
        const error = r.payload.error;
        if (
          error &&
          typeof error === "object" &&
          !Array.isArray(error) &&
          Object.keys(error).length === 4 &&
          "code" in error &&
          "message" in error &&
          typeof error.message === "string" &&
          "retryable" in error &&
          error.retryable === false &&
          "details" in error &&
          error.details &&
          typeof error.details === "object" &&
          !Array.isArray(error.details) &&
          Object.keys(error.details).length === 0
        ) {
          const rejected = {
            kind: "DEFINITE_SERVER_ERROR",
            status: r.status,
            code: error.code,
            request_id: r.requestId,
          };
          if (assemblyExactRejection(rejected)) return rejected;
        }
      }
      return { kind: "REMOTE_UNKNOWN" };
    },
    async getOriginal(p, e, c) {
      if (!assemblyExactCommand(c, p, e)) throw new Error("Invalid original assembly recovery");
      const hash = await mediaHash(c.payload);
      if (!hash) return { kind: "REMOTE_UNKNOWN" };
      const r = await request(
        `/api/v1/projects/${p}/episodes/${e}/media-assembly-operations/${c.operation_id}?${new URLSearchParams({ payload_hash: hash })}`,
        { method: "GET", headers },
      );
      return r?.status === 200 &&
        impactEnvelope(r.payload, r.requestId) &&
        (await assemblyExactOperation(r.payload.data, p, e, c))
        ? {
            kind: "FOUND",
            receipt: {
              data: r.payload.data as AssemblyExactOperation,
              request_id: r.payload.request_id,
            },
          }
        : { kind: "REMOTE_UNKNOWN" };
    },
  };
}
