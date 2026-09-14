import { describe, expect, it } from "vitest";
import { validateSourceFile } from "./sourceImport";

describe("source import adapter", () => {
  it("keeps the original strict TXT and 5 MiB boundary", () => {
    expect(validateSourceFile(new File(["x"], "story.md", { type: "text/markdown" }))).toContain(
      ".txt",
    );
    expect(
      validateSourceFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "story.txt")),
    ).toContain("5 MiB");
    expect(validateSourceFile(new File(["x"], "story.TXT", { type: "text/plain" }))).toBeNull();
  });
});
