import { describe, expect, it, vi } from "vitest";
import { importTextSource, MAX_SOURCE_BYTES, validateSourceFile } from "./sourceImport";

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
  it("imports a 20,000-character UTF-8 source file without changing its bytes", async () => {
    const text = "原文".repeat(10_000);
    const file = new File([text], "long-source.txt", { type: "text/plain" });
    const send = vi.fn().mockResolvedValue({ data: { id: "source" } });
    await expect(
      importTextSource({ importTextSource: send } as never, "prj_test", file),
    ).resolves.toEqual({
      kind: "SUCCEEDED",
      response: { data: { id: "source" } },
    });
    const encoded = send.mock.calls[0]![1].content_base64 as string;
    const bytes = Uint8Array.from(atob(encoded), (character) => character.codePointAt(0)!);
    expect(new TextDecoder().decode(bytes)).toBe(text);
  });
  it("accepts and imports a file at the exact 5 MiB boundary", async () => {
    const file = new File([new Uint8Array(MAX_SOURCE_BYTES)], "boundary.txt", {
      type: "text/plain",
    });
    const send = vi.fn().mockResolvedValue({ data: { id: "boundary" } });
    await expect(
      importTextSource({ importTextSource: send } as never, "prj_test", file),
    ).resolves.toMatchObject({
      kind: "SUCCEEDED",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid input before reading or dispatching", async () => {
    const send = vi.fn();
    await expect(
      importTextSource({ importTextSource: send } as never, "prj_test", new File(["x"], "bad.md")),
    ).resolves.toMatchObject({ kind: "INVALID_INPUT" });
    expect(send).not.toHaveBeenCalled();
    await expect(
      importTextSource(
        { importTextSource: send } as never,
        "prj_test",
        new File([new Uint8Array(MAX_SOURCE_BYTES + 1)], "large.txt"),
      ),
    ).resolves.toEqual({ kind: "INVALID_INPUT", message: "文件超过 5 MiB，请拆分后再导入。" });
    expect(send).not.toHaveBeenCalled();
  });
  for (const mode of ["error", "nonstring", "missing-separator"] as const) {
    it(`does not dispatch unreadable FileReader ${mode} data`, async () => {
      const OriginalFileReader = globalThis.FileReader;
      class BrokenReader {
        result: string | ArrayBuffer | null = null;
        onerror: (() => void) | null = null;
        onload: (() => void) | null = null;
        readAsDataURL() {
          if (mode === "error") this.onerror?.();
          else {
            this.result = mode === "nonstring" ? new ArrayBuffer(0) : "base64-without-separator";
            this.onload?.();
          }
        }
      }
      Object.defineProperty(globalThis, "FileReader", { configurable: true, value: BrokenReader });
      const send = vi.fn();
      try {
        await expect(
          importTextSource(
            { importTextSource: send } as never,
            "prj_test",
            new File(["x"], "bad.txt"),
          ),
        ).resolves.toEqual({
          kind: "REMOTE_UNKNOWN",
          message: "导入状态未知。请刷新来源清单后再决定是否重试。",
        });
        expect(send).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(globalThis, "FileReader", {
          configurable: true,
          value: OriginalFileReader,
        });
      }
    });
  }
  it("makes one transport attempt and does not retry a rejection", async () => {
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      importTextSource(
        { importTextSource: send } as never,
        "prj_test",
        new File(["x"], "retry.txt"),
      ),
    ).resolves.toEqual({
      kind: "REMOTE_UNKNOWN",
      message: "导入状态未知。请刷新来源清单后再决定是否重试。",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
