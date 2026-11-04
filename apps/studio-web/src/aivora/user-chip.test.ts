import { describe, expect, it } from "vitest";
import { accountMonogram, signedInLabel } from "./user-chip";

describe("header identity", () => {
  it("prefers the signed-in Grok name and never invents a portrait", () => {
    expect(
      signedInLabel({
        grokSignedIn: true,
        grokLabel: "person@example.test",
        chatgptSignedIn: true,
        chatgptLabel: "other@example.test",
        localName: "本地用户",
      }),
    ).toBe("person@example.test");
    expect(accountMonogram("person@example.test")).toBe("P");
    expect(accountMonogram("陈")).toBe("陈");
    expect(accountMonogram("  ")).toBe("用");
  });

  it("falls back to ChatGPT, then the local name, when Grok has no label", () => {
    expect(
      signedInLabel({
        grokSignedIn: true,
        grokLabel: null,
        chatgptSignedIn: true,
        chatgptLabel: "ada@example.test",
        localName: "本地用户",
      }),
    ).toBe("ada@example.test");
    expect(
      signedInLabel({
        grokSignedIn: false,
        grokLabel: null,
        chatgptSignedIn: false,
        chatgptLabel: null,
        localName: "本地用户",
      }),
    ).toBe("本地用户");
  });
});
