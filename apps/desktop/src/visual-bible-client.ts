import { createHash } from "node:crypto";
import {
  visualSaveOperationData,
  visualReviewStateData,
  visualProjectId,
  visualVersionId,
  visualWriteInput,
  visualReviewInput,
  visualEnvelope,
  visualIndexData,
  visualReadData,
  visualReadinessData,
  visualAuthorityData,
  visualOperationData,
  visualActionOutcomeMatches,
  visualLocalReviewActorMatches,
  visualInspectionData,
  visualPreparedData,
  visualHistoryData,
  type VisualHistoryGateway,
  type VisualHistoryPage,
  type VisualGateway,
  type VisualReviewState,
  type VisualSaveOperation,
  type VisualRead,
  type VisualReadiness,
  type VisualAuthority,
  type VisualResult,
  type VisualIdentity,
  type VisualAction,
  type VisualPrepared,
  type VisualOperation,
  type VisualInspection,
} from "@aijian/contracts/visual-bible";
import { isRecord, hasOnlyKeys } from "./api-contract-guards";

type Http = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;
export type VisualHttpClient = Pick<
  VisualGateway,
  | "getVisualBible"
  | "getVisualBibleVersion"
  | "getVisualBibleReadiness"
  | "getVisualBibleAuthority"
  | "saveVisualBible"
  | "readVisualReviewOperation"
  | "getVisualInspectionOperation"
  | "getVisualSaveOperation"
  | "getVisualReviewState"
> &
  VisualHistoryGateway & {
    prepareVisualAction(
      identity: VisualIdentity,
      input: VisualAction,
    ): Promise<VisualResult<VisualPrepared>>;
    confirmVisualAction(
      identity: VisualIdentity,
      input: VisualAction,
      prepared: VisualPrepared,
    ): Promise<VisualResult<VisualOperation>>;
    persistVisualInspection(
      p: string,
      assetId: string,
      versionId: string,
      evidence: VisualInspection["evidence"],
    ): Promise<VisualResult<VisualInspection>>;
  };
export function visualCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(visualCanonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${visualCanonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
export const visualHash = (value: unknown) =>
  `sha256:${createHash("sha256").update(visualCanonical(value), "utf8").digest("hex")}`;
export function validVisualIdentity(v: unknown): v is VisualIdentity {
  return (
    isRecord(v) &&
    hasOnlyKeys(v, ["project_id", "version_id", "content_hash", "expected_revision"]) &&
    Object.keys(v).length === 4 &&
    visualProjectId(v.project_id) &&
    visualVersionId(v.version_id) &&
    typeof v.content_hash === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(v.content_hash) &&
    typeof v.expected_revision === "number" &&
    Number.isSafeInteger(v.expected_revision) &&
    v.expected_revision >= 1 &&
    v.expected_revision < Number.MAX_SAFE_INTEGER
  );
}
export function createVisualBibleClient(
  http: Http,
  headers: Record<string, string>,
): VisualHttpClient {
  async function request<T>(
    path: string,
    guard: (v: unknown) => v is T,
    init: RequestInit = {},
    empty = false,
  ): Promise<VisualResult<T>> {
    let r;
    try {
      r = await http(path, { ...init, headers: { ...headers, ...init.headers } });
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    if (!r || !r.requestId) return { kind: "REMOTE_UNKNOWN" };
    if ([200, 201].includes(r.status))
      return visualEnvelope(r.payload, r.requestId) && guard(r.payload.data)
        ? { kind: "FOUND", data: r.payload.data, request_id: r.payload.request_id }
        : { kind: "REMOTE_UNKNOWN" };
    const p = r.payload;
    if (
      ![401, 403, 404, 409, 412, 422, 428].includes(r.status) ||
      !isRecord(p) ||
      !hasOnlyKeys(p, ["error", "request_id"]) ||
      p.request_id !== r.requestId ||
      !isRecord(p.error) ||
      !hasOnlyKeys(p.error, ["code", "message", "details", "retryable"]) ||
      typeof p.error.code !== "string" ||
      p.error.retryable !== false
    )
      return { kind: "REMOTE_UNKNOWN" };
    return empty && r.status === 404 && p.error.code === "VISUAL_NOT_FOUND"
      ? { kind: "EMPTY" }
      : {
          kind: "DEFINITE_SERVER_ERROR",
          status: r.status,
          code: p.error.code,
          request_id: r.requestId,
        };
  }
  const scope = (p: string, v?: string) => {
    if (!visualProjectId(p) || (v !== undefined && !visualVersionId(v)))
      throw new Error("Visual version requires canonical scoped ids");
  };
  const base = (p: string) => `/api/v1/projects/${p}/visual-bible`;
  const version = (p: string, v: string) => `${base(p)}/versions/${v}`;
  const verifiedRead = (data: unknown, p: string) =>
    visualReadData(data, p) && data.version.content_hash === visualHash(data.version.content);
  const verifiedOperation = (data: unknown, p: string, v: string) =>
    visualOperationData(data, p, v) &&
    visualLocalReviewActorMatches(data) &&
    data.report.report_hash === visualHash(data.report.report);
  const verifiedInspection = (data: unknown, p: string) => {
    if (!visualInspectionData(data, p)) return false;
    const { evidence_hash, ...plain } = data;
    return evidence_hash === visualHash(plain);
  };
  return {
    listVisualBibleVersions(p, cursor) {
      scope(p);
      if (cursor !== null && !visualVersionId(cursor))
        throw new Error("Visual history requires a canonical cursor");
      return request(
        `${base(p)}/history?limit=20${cursor === null ? "" : `&cursor=${cursor}`}`,
        (d): d is VisualHistoryPage => visualHistoryData(d, p, cursor),
        {},
        cursor === null,
      );
    },
    getVisualReviewState(p, v) {
      scope(p, v);
      return request(
        `${version(p, v)}/review-state`,
        (d): d is VisualReviewState =>
          visualReviewStateData(d, p, v) &&
          d.reports.every((r) => r.report_hash === visualHash(r.report)),
      );
    },
    getVisualSaveOperation(p, key, payload) {
      scope(p);
      if (!/^vbsave_[0-9a-f]{32}$/.test(key) || !visualWriteInput(payload, p))
        throw new Error("Invalid visual save recovery input");
      return request(
        `${base(p)}/save-operations/${key}`,
        (d): d is VisualSaveOperation =>
          visualSaveOperationData(d, p) &&
          d.idempotency_key_hash === visualHash({ value: key }) &&
          d.request_hash === visualHash({ project_id: p, actor_id: "local-user", payload }) &&
          verifiedRead(d.result, p) &&
          visualCanonical(d.result.version.content) === visualCanonical(payload.content) &&
          d.result.version.parent_version_id === payload.parent_version_id &&
          d.result.version.change_summary === payload.change_summary,
        {},
        true,
      );
    },
    getVisualBible(p) {
      scope(p);
      return request(
        base(p),
        (
          d,
        ): d is NonNullable<
          Awaited<ReturnType<VisualGateway["getVisualBible"]>> & { kind: "FOUND" }
        >["data"] =>
          visualIndexData(d, p) &&
          [d.latest_version, d.review_version, d.accepted_version].every(
            (x) => x === null || x.content_hash === visualHash(x.content),
          ),
        {},
        true,
      );
    },
    getVisualBibleVersion(p, v) {
      scope(p, v);
      return request(
        version(p, v),
        (d): d is VisualRead => verifiedRead(d, p) && visualReadData(d, p) && d.version.id === v,
      );
    },
    getVisualBibleReadiness(p, v) {
      scope(p, v);
      return request(
        `${version(p, v)}/readiness`,
        (d): d is VisualReadiness =>
          visualReadinessData(d, p, v) && d.report_hash === visualHash(d.report),
      );
    },
    getVisualBibleAuthority(p, v) {
      scope(p, v);
      return request(`${version(p, v)}/authority`, (d): d is VisualAuthority =>
        visualAuthorityData(d, p, v),
      );
    },
    saveVisualBible(p, key, payload) {
      scope(p);
      if (!/^vbsave_[0-9a-f]{32}$/.test(key) || !visualWriteInput(payload, p))
        throw new Error("Visual write requires a closed exact request");
      return request(
        `${base(p)}/versions`,
        (d): d is VisualRead =>
          verifiedRead(d, p) &&
          visualReadData(d, p) &&
          visualCanonical(d.version.content) === visualCanonical(payload.content) &&
          d.version.parent_version_id === payload.parent_version_id &&
          d.version.change_summary === payload.change_summary,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify(payload),
        },
      );
    },
    readVisualReviewOperation(p, v, c) {
      scope(p, v);
      if (!/^chg_[0-9a-f]{32}$/.test(c)) throw new Error("Visual review requires exact challenge");
      return request(
        `${version(p, v)}/review-operations/${c}`,
        (d): d is VisualOperation =>
          verifiedOperation(d, p, v) && visualOperationData(d, p, v) && d.challenge.id === c,
      );
    },
    getVisualInspectionOperation(p, op) {
      scope(p);
      if (!/^vinop_[0-9a-f]{32}$/.test(op))
        throw new Error("Visual inspection requires exact operation");
      return request(
        `/api/v1/projects/${p}/visual-inspections/operations/${op}`,
        (d): d is VisualInspection =>
          verifiedInspection(d, p) && visualInspectionData(d, p) && d.evidence.operation_id === op,
      );
    },
    prepareVisualAction(identity, input) {
      if (!validVisualIdentity(identity) || !visualReviewInput(input))
        throw new Error("Visual review requires exact identity and action");
      return request(
        `/api/v1/internal/projects/${identity.project_id}/visual-bible/versions/${identity.version_id}/review:prepare`,
        (d): d is VisualPrepared =>
          visualPreparedData(d) &&
          d.challenge.version_id === identity.version_id &&
          d.challenge.action === input.action &&
          d.challenge.head_revision === identity.expected_revision &&
          d.report.report_hash === visualHash(d.report.report) &&
          d.report.report.content_hash === identity.content_hash,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "If-Match": `"revision-${identity.expected_revision}"`,
          },
          body: JSON.stringify(input),
        },
      );
    },
    confirmVisualAction(identity, input, prepared) {
      if (
        !validVisualIdentity(identity) ||
        !visualReviewInput(input) ||
        !visualPreparedData(prepared)
      )
        throw new Error("Visual confirmation requires exact prepared challenge");
      return request(
        `/api/v1/internal/projects/${identity.project_id}/visual-bible/versions/${identity.version_id}/review:confirm`,
        (d): d is VisualOperation =>
          verifiedOperation(d, identity.project_id, identity.version_id) &&
          visualOperationData(d, identity.project_id, identity.version_id) &&
          d.challenge.id === prepared.challenge.id &&
          d.content_hash === identity.content_hash &&
          d.challenge.action === input.action &&
          d.state === "COMPLETED" &&
          d.result_revision === identity.expected_revision + 1 &&
          d.report.report_hash === prepared.report.report_hash &&
          visualActionOutcomeMatches(input, d),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "If-Match": `"revision-${identity.expected_revision}"`,
          },
          body: JSON.stringify({
            ...input,
            challenge_id: prepared.challenge.id,
            confirmation_token: prepared.confirmation_token,
          }),
        },
      );
    },
    persistVisualInspection(p, a, v, e) {
      scope(p);
      if (!/^asset_[0-9a-f]{32}$/.test(a) || !/^asv_[0-9a-f]{32}$/.test(v))
        throw new Error("Visual inspection requires exact media ids");
      return request(
        `/api/v1/internal/projects/${p}/assets/${a}/versions/${v}/visual-inspections`,
        (d): d is VisualInspection =>
          verifiedInspection(d, p) &&
          visualInspectionData(d, p) &&
          d.asset_id === a &&
          d.asset_version_id === v &&
          visualCanonical(d.evidence) === visualCanonical(e),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(e),
        },
      );
    },
  };
}
