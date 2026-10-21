import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";

export function registerGrokHandlers<TEvent>(
  handle: (channel: string, callback: (event: TEvent, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: TEvent) => boolean,
  runtimeFor: () => GrokLoginBridge,
): void {
  for (const action of ["status", "sign-in", "cancel", "sign-out", "models", "text"] as const) {
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
        };
        const keys = Object.keys(body);
        if (
          keys.some((key) => !["model", "text", "projectId", "idempotencyKey"].includes(key)) ||
          (body.projectId !== undefined && typeof body.projectId !== "string") ||
          (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string")
        ) {
          throw new Error("Invalid Grok text request");
        }
        return runtime.completeText({
          model: body.model,
          text: body.text,
          ...(typeof body.projectId === "string" ? { projectId: body.projectId } : {}),
          ...(typeof body.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
        });
      }
      if (args.length !== 0) throw new Error("Unexpected Grok IPC arguments");
      if (action === "status") return runtime.status();
      if (action === "sign-in") return runtime.signIn();
      if (action === "cancel") return runtime.cancel();
      if (action === "sign-out") return runtime.signOut();
      return runtime.models();
    });
  }
}
