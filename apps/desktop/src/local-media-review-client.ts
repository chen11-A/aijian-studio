import { createHash } from "node:crypto";
import {
  localReviewCommand,
  localReviewOperation,
  localReviewPage,
  localReviewRejection,
  localReviewStatus,
  localReviewStatusQuery,
  localReviewTarget,
  localReviewTargetQuery,
  localReviewVersion,
  type LocalMediaReviewCommand,
  type LocalMediaReviewGateway,
  type LocalMediaReviewOperation,
  type LocalMediaReviewPage,
  type LocalMediaReviewStatus,
  type LocalMediaReviewTarget,
  type LocalMediaReviewVersion,
} from "@aijian/contracts/local-media-review";
import {
  mediaScope,
  mediaVersionId,
  sameMediaInput,
  type MediaRead,
} from "@aijian/contracts/media-preparation";
import { impactCanonical, impactEnvelope } from "@aijian/contracts/script-confirmation-impact";

type Http = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;
const unknown = { kind: "REMOTE_UNKNOWN" } as const;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));

export function createLocalMediaReviewClient(
  http: Http,
  headers: Record<string, string>,
): LocalMediaReviewGateway {
  const base = (p: string, e: string) => {
    if (!mediaScope(p, e)) throw new Error("Local media review requires exact scope");
    return `/api/v1/projects/${p}/episodes/${e}`;
  };
  async function request(path: string, init: RequestInit) {
    try {
      return await http(path, init);
    } catch {
      return null;
    }
  }
  async function read<T>(
    path: string,
    valid: (v: unknown) => Promise<boolean> | boolean,
  ): Promise<MediaRead<T>> {
    const r = await request(path, { method: "GET", headers });
    if (
      r?.status !== 200 ||
      !impactEnvelope(r.payload, r.requestId) ||
      !(await valid(r.payload.data))
    )
      return unknown;
    return {
      kind: "FOUND",
      receipt: { data: r.payload.data as T, request_id: r.payload.request_id },
    };
  }
  function ownedCommand(c: LocalMediaReviewCommand, p: string, e: string): LocalMediaReviewCommand {
    if (!localReviewCommand(c, p, e))
      throw new Error("Invalid original local media review command");
    // Capture the complete original bytes before the first asynchronous boundary.
    return JSON.parse(impactCanonical(c)) as LocalMediaReviewCommand;
  }
  function original(p: string, e: string, c: LocalMediaReviewCommand) {
    const digest = `sha256:${createHash("sha256").update(impactCanonical(c.payload)).digest("hex")}`;
    return read<LocalMediaReviewOperation>(
      `${base(p, e)}/local-media-review-operations/${c.operation_id}?${new URLSearchParams({ payload_hash: digest })}`,
      (v) => localReviewOperation(v, p, e, c),
    );
  }
  return {
    getLocalMediaReviewTarget(p, e, q) {
      const scope = base(p, e);
      if (!localReviewTargetQuery(q)) throw new Error("Invalid exact local media review target");
      const target = { ...q };
      return read<LocalMediaReviewTarget>(
        `${scope}/media-assembly/versions/${target.assembly_version_id}/local-review-target?${new URLSearchParams({ expected_content_hash: target.assembly_content_hash, segment_kind: target.segment_kind, segment_id: target.segment_id })}`,
        (v) => localReviewTarget(v, p, e, target),
      );
    },
    listLocalMediaReviews(p, e, cursor) {
      const scope = base(p, e);
      if (cursor !== undefined && !mediaVersionId(cursor))
        throw new Error("Invalid local media review cursor");
      return read<LocalMediaReviewPage>(
        `${scope}/local-media-reviews?${new URLSearchParams({ limit: "20", ...(cursor === undefined ? {} : { cursor }) })}`,
        (v) => localReviewPage(v, p, e, cursor),
      );
    },
    getLocalMediaReview(p, e, id) {
      const scope = base(p, e);
      if (!mediaVersionId(id)) throw new Error("Invalid local media review version");
      return read<LocalMediaReviewVersion>(`${scope}/local-media-reviews/versions/${id}`, (v) =>
        localReviewVersion(v, p, e, id),
      );
    },
    getLocalMediaReviewStatus(p, e, q) {
      const scope = base(p, e);
      if (!localReviewStatusQuery(q)) throw new Error("Invalid exact local media review status");
      const target = { ...q };
      return read<LocalMediaReviewStatus>(
        `${scope}/local-media-reviews/versions/${target.version_id}/status?${new URLSearchParams({ expected_content_hash: target.content_hash })}`,
        (v) => localReviewStatus(v, target),
      );
    },
    async saveLocalMediaReview(p, e, c) {
      const command = ownedCommand(c, p, e);
      const r = await request(`${base(p, e)}/local-media-reviews`, {
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
        (await localReviewOperation(r.payload.data, p, e, command))
      ) {
        // Only a valid POST response earns this one read. Bad or lost responses
        // stay UNKNOWN until the user explicitly reads the original operation.
        const recovered = await original(p, e, command);
        return recovered.kind === "FOUND" && sameMediaInput(recovered.receipt.data, r.payload.data)
          ? recovered
          : unknown;
      }
      if (r && impactEnvelope(r.payload, r.requestId)) return unknown;
      if (
        r &&
        record(r.payload) &&
        exact(r.payload, ["error", "request_id"]) &&
        r.payload.request_id === r.requestId &&
        record(r.payload.error) &&
        exact(r.payload.error, ["code", "message", "retryable", "details"]) &&
        typeof r.payload.error.message === "string" &&
        r.payload.error.retryable === false &&
        record(r.payload.error.details) &&
        exact(r.payload.error.details, [])
      ) {
        const rejected = {
          kind: "DEFINITE_SERVER_ERROR",
          status: r.status,
          code: r.payload.error.code,
          request_id: r.requestId,
        };
        if (localReviewRejection(rejected)) return rejected;
      }
      return unknown;
    },
    getLocalMediaReviewOperation(p, e, c) {
      return original(p, e, ownedCommand(c, p, e));
    },
  };
}
