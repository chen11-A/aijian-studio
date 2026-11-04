import type { OfficialDirectorBridge } from "@aijian/contracts/official-director";

declare global {
  interface Window {
    aijianOfficialDirector?: OfficialDirectorBridge;
  }
}
/** Renderer cannot substitute an HTTP client when the native main-only gateway is missing. */
export function officialDirectorBridge(): OfficialDirectorBridge | null {
  const bridge = window.aijianOfficialDirector;
  const methods: (keyof OfficialDirectorBridge)[] = ["list", "get", "generate", "adopt", "reject"];
  return bridge && methods.every((method) => typeof bridge[method] === "function") ? bridge : null;
}
