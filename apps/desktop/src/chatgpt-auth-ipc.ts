import type { ChatGPTBridge } from "@aijian/contracts/chatgpt-auth";
import { useScope } from "./chatgpt-auth-storage";

export const CHATGPT_HELP_URLS = {
  documentation: "https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt",
  usage: "https://chatgpt.com/settings/usage",
  eligibility: "https://openai.com/form/sign-in-with-chatgpt-interest/",
} as const;
export function registerChatGPTHandlers<TEvent>(
  handle: (
    channel: string,
    callback: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  authorized: (event: TEvent) => boolean,
  runtimeFor: () => ChatGPTBridge,
  openLink: (url: string) => Promise<void>,
): void {
  const actions = ["status", "sign-in", "cancel", "select", "sign-out", "models", "help"] as const;
  for (const action of actions)
    handle(`chatgpt-auth:${action}`, async (event, ...args) => {
      if (!authorized(event)) throw new Error("ChatGPT IPC sender is not authorized");
      if (action === "sign-in") {
        if (
          args.length < 1 ||
          args.length > 2 ||
          !useScope(args[0]) ||
          (args[1] !== undefined &&
            args[1] !== null &&
            (typeof args[1] !== "string" || !/^[0-9a-f-]{36}$/.test(args[1])))
        )
          throw new Error("Invalid ChatGPT sign-in request");
        return runtimeFor().signIn(args[0], args[1] as string | null | undefined);
      }
      if (action === "select") {
        if (args.length !== 1 || typeof args[0] !== "string" || !/^[0-9a-f-]{36}$/.test(args[0]))
          throw new Error("Invalid ChatGPT profile selection");
        return runtimeFor().selectProfile(args[0]);
      }
      if (action === "help") {
        if (
          args.length !== 1 ||
          (args[0] !== "documentation" && args[0] !== "usage" && args[0] !== "eligibility")
        )
          throw new Error("Invalid ChatGPT help topic");
        return openLink(CHATGPT_HELP_URLS[args[0]]);
      }
      if (args.length !== 0) throw new Error("Unexpected ChatGPT IPC arguments");
      const runtime = runtimeFor();
      if (action === "status") return runtime.status();
      if (action === "cancel") return runtime.cancel();
      if (action === "sign-out") return runtime.signOut();
      return runtime.models();
    });
}
