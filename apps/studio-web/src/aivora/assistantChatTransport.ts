import type { AssistantChatBridge } from "@aijian/contracts/official-text";

declare global {
  interface Window {
    aijianAssistantChat?: AssistantChatBridge;
  }
}

export function assistantChatBridge(): AssistantChatBridge | undefined {
  return window.aijianAssistantChat;
}
