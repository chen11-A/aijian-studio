import { createHash } from "node:crypto";
import { canonicalLoopbackOrigin } from "./sidecar-origin";

export type SubscriptionAccountKind = "grok_login" | "gpt_login";
export type SubscriptionDispatchReceipt = {
  dispatchId: string;
  recordId: string;
  created: boolean;
  outcome: "RECORDED" | "COMPLETED" | "FAILED";
  accountKind: SubscriptionAccountKind;
};

type Session = { origin: string; token: string };

const projectId = /^prj_[0-9a-f]{32}$/;
const dispatchId = /^dsd_[0-9a-f]{32}$/;

export function subscriptionRequestHash(input: {
  accountKind: SubscriptionAccountKind;
  model: string;
  text: string;
}): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        accountKind: input.accountKind,
        model: input.model,
        text: input.text,
      }),
    )
    .digest("hex")}`;
}

export function createSubscriptionLedger(fetcher: typeof fetch, session: Session) {
  const origin = canonicalLoopbackOrigin(session.origin);
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(session.token)) {
    throw new Error("BILLING_UNAVAILABLE");
  }
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.token}`,
    Origin: "app://aijian",
  };

  async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetcher(`${origin}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json();
    if (response.status !== 200 && response.status !== 201) {
      const code =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "object" &&
        payload.error !== null &&
        "code" in payload.error &&
        typeof payload.error.code === "string"
          ? payload.error.code
          : "BILLING_NOT_RECORDED";
      throw new Error(code);
    }
    return payload;
  }

  function receipt(payload: unknown): SubscriptionDispatchReceipt {
    if (typeof payload !== "object" || payload === null || !("data" in payload)) {
      throw new Error("BILLING_NOT_RECORDED");
    }
    const data = payload.data;
    if (
      typeof data !== "object" ||
      data === null ||
      !("dispatch_id" in data) ||
      !("record_id" in data) ||
      !("created" in data) ||
      !("outcome" in data) ||
      !("account_kind" in data) ||
      typeof data.dispatch_id !== "string" ||
      !dispatchId.test(data.dispatch_id) ||
      typeof data.record_id !== "string" ||
      typeof data.created !== "boolean" ||
      (data.outcome !== "RECORDED" && data.outcome !== "COMPLETED" && data.outcome !== "FAILED") ||
      (data.account_kind !== "grok_login" && data.account_kind !== "gpt_login")
    ) {
      throw new Error("BILLING_NOT_RECORDED");
    }
    return {
      dispatchId: data.dispatch_id,
      recordId: data.record_id,
      created: data.created,
      outcome: data.outcome,
      accountKind: data.account_kind,
    };
  }

  return {
    async record(input: {
      projectId: string;
      accountKind: SubscriptionAccountKind;
      model: string;
      text: string;
      idempotencyKey: string;
      connected: boolean;
    }): Promise<SubscriptionDispatchReceipt> {
      if (!projectId.test(input.projectId)) throw new Error("BILLING_PROJECT_REQUIRED");
      const recorded = await post(
        `/api/v1/projects/${input.projectId}/desktop-subscription-dispatches`,
        {
          account_kind: input.accountKind,
          model_id: input.model,
          request_sha256: subscriptionRequestHash(input),
          idempotency_key: input.idempotencyKey,
          connected: input.connected,
        },
      );
      return receipt(recorded);
    },
    async finish(input: {
      projectId: string;
      dispatchId: string;
      outcome: "COMPLETED" | "FAILED";
      failureCode?: string;
    }): Promise<void> {
      await post(
        `/api/v1/projects/${input.projectId}/desktop-subscription-dispatches/${input.dispatchId}/outcome`,
        {
          outcome: input.outcome,
          ...(input.failureCode ? { failure_code: input.failureCode } : {}),
        },
      );
    },
  };
}
