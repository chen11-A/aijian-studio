import { rememberServiceEntryChoice } from "../FirstRunServiceChoice";

const fallbackKey = "aivora.api-key-fallback.v1";

/** Ask the studio shell to open a page. Safe when the shell is not mounted. */
export function openAivoraPage(page: string) {
  window.dispatchEvent(new CustomEvent("aivora-open-page", { detail: page }));
}

/** True until the services page consumes a SuperGrok 403 fallback. */
export function apiKeyFallbackPending(): boolean {
  try {
    return window.sessionStorage.getItem(fallbackKey) === "1";
  } catch {
    return false;
  }
}

/** One-shot read. A second call is false, so the page does not trap the user. */
export function takeApiKeyFallbackRequest(): boolean {
  try {
    if (window.sessionStorage.getItem(fallbackKey) !== "1") return false;
    window.sessionStorage.removeItem(fallbackKey);
    return true;
  } catch {
    return false;
  }
}

/** One step from a SuperGrok 403 to the 密钥 form. Does not call a provider. */
export function useApiKeyFallback() {
  try {
    window.sessionStorage.setItem(fallbackKey, "1");
  } catch {
    // The event still switches the tab when AI 服务 is already open.
  }
  rememberServiceEntryChoice("api");
  window.dispatchEvent(new CustomEvent("aivora-use-api-key"));
  openAivoraPage("services");
  document.getElementById("xai-api-key")?.focus();
}
