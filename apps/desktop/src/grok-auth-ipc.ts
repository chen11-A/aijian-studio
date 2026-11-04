import type { GrokLoginBridge, GrokLoginStatus } from "@aijian/contracts/grok-auth";

/**
 * Unpackaged screenshot stand-in for a SuperGrok catalog that only lists a text model.
 * `process.defaultApp` is set only when Electron is launched as `electron .`.
 * A packaged installer leaves it unset, so this never answers a real login.
 */
function screenshotGrokCatalog(): { status: GrokLoginStatus } | undefined {
  if (process.env.AIVORA_SCREENSHOT_GROK !== "text-only") return undefined;
  if ((process as NodeJS.Process & { defaultApp?: boolean }).defaultApp !== true) return undefined;
  return {
    status: {
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "grok-user@example.com",
      lastError: null,
    },
  };
}

export function registerGrokHandlers<TEvent>(
  handle: (
    channel: string,
    callback: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  authorized: (event: TEvent) => boolean,
  runtimeFor: () => GrokLoginBridge,
): void {
  for (const action of [
    "status",
    "sign-in",
    "cancel",
    "sign-out",
    "models",
    "text",
    "speech",
    "agent-log",
  ] as const) {
    handle(`grok-auth:${action}`, async (event, ...args) => {
      if (!authorized(event)) throw new Error("Grok IPC sender is not authorized");
      const runtime = runtimeFor();
      if (action === "text") {
        const input = args[0];
        if (
          args.length !== 1 ||
          typeof input !== "object" ||
          input === null ||
          typeof (input as { model?: unknown }).model !== "string" ||
          typeof (input as { text?: unknown }).text !== "string"
        ) {
          throw new Error("Invalid Grok text request");
        }
        const body = input as {
          model: string;
          text: string;
          projectId?: unknown;
          idempotencyKey?: unknown;
          deadlineAt?: unknown;
        };
        const keys = Object.keys(body);
        if (
          keys.some(
            (key) =>
              !["model", "text", "projectId", "idempotencyKey", "agent", "deadlineAt"].includes(
                key,
              ),
          ) ||
          (body.projectId !== undefined && typeof body.projectId !== "string") ||
          (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string") ||
          (body.deadlineAt !== undefined &&
            (typeof body.deadlineAt !== "number" ||
              !Number.isSafeInteger(body.deadlineAt) ||
              body.deadlineAt <= 0)) ||
          ((body as { agent?: unknown }).agent !== undefined &&
            typeof (body as { agent?: unknown }).agent !== "string")
        ) {
          throw new Error("Invalid Grok text request");
        }
        if (screenshotGrokCatalog()) {
          return { kind: "ERROR", code: "SCREENSHOT_ONLY", billingAccountKind: "grok_login" };
        }
        const sender = event as { sender?: { send?: (channel: string, payload: unknown) => void } };
        const complete = runtime.completeText as (
          input: Parameters<GrokLoginBridge["completeText"]>[0] & {
            onProgress?: (update: { chars: number; shots: number }) => void;
          },
        ) => ReturnType<GrokLoginBridge["completeText"]>;
        return complete({
          model: body.model,
          text: body.text,
          ...(typeof body.deadlineAt === "number" ? { deadlineAt: body.deadlineAt } : {}),
          ...(typeof body.projectId === "string" ? { projectId: body.projectId } : {}),
          ...(typeof body.idempotencyKey === "string"
            ? { idempotencyKey: body.idempotencyKey }
            : {}),
          ...(typeof (body as { agent?: unknown }).agent === "string"
            ? { agent: String((body as unknown as { agent: string }).agent) }
            : {}),
          onProgress: (update) => sender.sender?.send?.("grok-auth:text-progress", update),
        });
      }
      if (action === "speech") {
        const input = args[0];
        if (
          args.length !== 1 ||
          typeof input !== "object" ||
          input === null ||
          typeof (input as { voiceId?: unknown }).voiceId !== "string" ||
          typeof (input as { text?: unknown }).text !== "string"
        ) {
          throw new Error("Invalid Grok speech request");
        }
        const body = input as {
          voiceId: string;
          text: string;
          projectId?: unknown;
          idempotencyKey?: unknown;
          speed?: unknown;
        };
        const keys = Object.keys(body);
        if (
          keys.some(
            (key) => !["voiceId", "text", "projectId", "idempotencyKey", "speed"].includes(key),
          ) ||
          (body.projectId !== undefined && typeof body.projectId !== "string") ||
          (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string") ||
          (body.speed !== undefined &&
            (typeof body.speed !== "number" || body.speed < 0.7 || body.speed > 1.5))
        ) {
          throw new Error("Invalid Grok speech request");
        }
        if (screenshotGrokCatalog()) {
          return {
            kind: "ERROR",
            code: "SCREENSHOT_ONLY",
            detail: "这一页不能试听。",
            billingAccountKind: "grok_login",
          };
        }
        if (!runtime.speak) {
          return {
            kind: "ERROR",
            code: "TEXT_FAILED",
            detail: "试听还没接到语音接口。",
            billingAccountKind: "grok_login",
          };
        }
        return runtime.speak({
          voiceId: body.voiceId,
          text: body.text,
          ...(typeof body.projectId === "string" ? { projectId: body.projectId } : {}),
          ...(typeof body.idempotencyKey === "string"
            ? { idempotencyKey: body.idempotencyKey }
            : {}),
          ...(typeof body.speed === "number" ? { speed: body.speed } : {}),
        });
      }
      if (action === "agent-log") {
        const input = args[0];
        if (args.length !== 1 || typeof input !== "object" || input === null) {
          throw new Error("Invalid agent log");
        }
        const body = input as Record<string, unknown>;
        const fields = ["agent", "model", "status", "parsed", "detail"] as const;
        if (Object.keys(body).some((key) => !fields.includes(key as (typeof fields)[number]))) {
          throw new Error("Invalid agent log");
        }
        const note = {
          agent: typeof body.agent === "string" ? body.agent.slice(0, 40) : "",
          model: typeof body.model === "string" ? body.model.slice(0, 80) : "",
          status: typeof body.status === "string" ? body.status.slice(0, 20) : "",
          parsed: typeof body.parsed === "string" ? body.parsed.slice(0, 40) : "",
          detail: typeof body.detail === "string" ? body.detail.slice(0, 500) : "",
        };
        runtime.recordAgent?.(note);
        return { kind: "OK" };
      }
      if (args.length !== 0) throw new Error("Unexpected Grok IPC arguments");
      const preview = screenshotGrokCatalog();
      if (preview) {
        if (action === "models")
          return { kind: "OK", models: [{ id: "grok-4.7", label: "grok-4.7" }] };
        return action === "status" ? preview.status : { kind: "OK", status: preview.status };
      }
      if (action === "status") return runtime.status();
      if (action === "sign-in") return runtime.signIn();
      if (action === "cancel") return runtime.cancel();
      if (action === "sign-out") return runtime.signOut();
      return runtime.models();
    });
  }
  handle("grok-auth:cancel-text", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Grok IPC sender is not authorized");
    if (
      args.length > 1 ||
      (args.length === 1 &&
        (typeof args[0] !== "string" || !args[0].length || args[0].length > 200))
    )
      throw new Error("Invalid Grok text cancellation");
    (runtimeFor() as GrokLoginBridge & { cancelWork?: (key?: string) => void }).cancelWork?.(
      args[0] as string | undefined,
    );
    return { kind: "OK" };
  });
  handle("grok-auth:cancel-speech", async (event) => {
    if (!authorized(event)) throw new Error("Grok IPC sender is not authorized");
    (runtimeFor() as GrokLoginBridge & { cancelSpeech?: () => void }).cancelSpeech?.();
    return { kind: "OK" };
  });
}
