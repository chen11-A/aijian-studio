import { afterEach, describe, expect, it } from "vitest";
import { rememberServiceEntryChoice } from "../FirstRunServiceChoice";
import { takeApiKeyFallbackRequest, useApiKeyFallback } from "./navigation";

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("SuperGrok API Key fallback", () => {
  it("keeps one step to the key form until the services page opens", () => {
    rememberServiceEntryChoice("grok");
    const pages: string[] = [];
    const seen: string[] = [];
    const onPage = (event: Event) => {
      pages.push(String((event as CustomEvent<string>).detail));
    };
    const onKey = () => seen.push("api-key");
    window.addEventListener("aivora-open-page", onPage);
    window.addEventListener("aivora-use-api-key", onKey);
    useApiKeyFallback();
    window.removeEventListener("aivora-open-page", onPage);
    window.removeEventListener("aivora-use-api-key", onKey);
    expect(pages).toEqual(["services"]);
    expect(seen).toEqual(["api-key"]);
    expect(window.localStorage.getItem("aivora.service-onboarding.v1")).toBe("api");
    expect(takeApiKeyFallbackRequest()).toBe(true);
    expect(takeApiKeyFallbackRequest()).toBe(false);
  });
});
