import { describe, expect, it, vi } from "vitest";
import {
  importTextSource,
  MAX_SOURCE_BYTES,
  readSourceDocumentText,
  validateSourceFile,
  sourceFileSha256,
} from "./sourceImport";

async function textReadback(
  source: { id: string; project_id: string; raw_sha256: string },
  normalizedText: string,
) {
  return {
    data: {
      id: source.id,
      project_id: source.project_id,
      raw_sha256: source.raw_sha256,
      normalized_text: normalizedText,
      normalized_sha256: await sourceFileSha256(new File([normalizedText], "normalized.txt")),
    },
  };
}

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
    const response = {
      data: {
        id: "source",
        project_id: "prj_test",
        raw_sha256: await sourceFileSha256(file),
        blocks: [{ text }],
      },
    };
    const send = vi.fn().mockResolvedValue(response);
    const getSource = vi.fn().mockResolvedValue(response);
    const getSourceText = vi.fn().mockResolvedValue(await textReadback(response.data, text));
    await expect(
      importTextSource(
        { importTextSource: send, getSource, getSourceText } as never,
        "prj_test",
        file,
      ),
    ).resolves.toEqual({
      kind: "SUCCEEDED",
      response,
      normalizedText: text,
    });
    const encoded = send.mock.calls[0]![1].content_base64 as string;
    const bytes = Uint8Array.from(atob(encoded), (character) => character.codePointAt(0)!);
    expect(new TextDecoder().decode(bytes)).toBe(text);
    expect(send).toHaveBeenCalledTimes(1);
    expect(getSource).toHaveBeenCalledWith("prj_test", "source");
    expect(getSourceText).toHaveBeenCalledWith("prj_test", "source");
  });
  it("accepts and imports a file at the exact 5 MiB boundary", async () => {
    const file = new File([new Uint8Array(MAX_SOURCE_BYTES)], "boundary.txt", {
      type: "text/plain",
    });
    const response = {
      data: {
        id: "boundary",
        project_id: "prj_test",
        raw_sha256: await sourceFileSha256(file),
        blocks: [{ text: "\0".repeat(MAX_SOURCE_BYTES) }],
      },
    };
    const send = vi.fn().mockResolvedValue(response);
    const getSource = vi.fn().mockResolvedValue(response);
    const getSourceText = vi
      .fn()
      .mockResolvedValue(await textReadback(response.data, "\0".repeat(MAX_SOURCE_BYTES)));
    await expect(
      importTextSource(
        { importTextSource: send, getSource, getSourceText } as never,
        "prj_test",
        file,
      ),
    ).resolves.toMatchObject({
      kind: "SUCCEEDED",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(getSourceText).toHaveBeenCalledWith("prj_test", "boundary");
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
          projectId: "prj_test",
          rawSha256: await sourceFileSha256(new File(["x"], "bad.txt")),
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
      projectId: "prj_test",
      rawSha256: await sourceFileSha256(new File(["x"], "retry.txt")),
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  for (const mismatch of ["id", "project_id", "raw_sha256", "read-error"] as const) {
    it(`does not sign success for readback ${mismatch}`, async () => {
      const file = new File(["真实原文"], "source.txt");
      const data = {
        id: "source",
        project_id: "prj_test",
        raw_sha256: await sourceFileSha256(file),
        blocks: [{ text: "真实原文" }],
      };
      const send = vi.fn().mockResolvedValue({ data });
      const getSource =
        mismatch === "read-error"
          ? vi.fn().mockRejectedValue(new Error("read failed"))
          : vi.fn().mockResolvedValue({ data: { ...data, [mismatch]: "different" } });
      await expect(
        importTextSource({ importTextSource: send, getSource } as never, "prj_test", file),
      ).resolves.toMatchObject({ kind: "REMOTE_UNKNOWN" });
      expect(send).toHaveBeenCalledTimes(1);
      expect(getSource).toHaveBeenCalledWith("prj_test", "source");
    });
  }
  for (const field of ["project_id", "raw_sha256"] as const) {
    it(`rejects mismatched POST ${field} despite valid GET`, async () => {
      const file = new File(["原文"], "source.txt");
      const data = {
        id: "source",
        project_id: "prj_test",
        raw_sha256: await sourceFileSha256(file),
        blocks: [{ text: "原文" }],
      };
      const send = vi.fn().mockResolvedValue({ data: { ...data, [field]: "wrong" } });
      const getSource = vi.fn().mockResolvedValue({ data });
      await expect(
        importTextSource({ importTextSource: send, getSource } as never, "prj_test", file),
      ).resolves.toMatchObject({ kind: "REMOTE_UNKNOWN" });
      expect(send).toHaveBeenCalledTimes(1);
      expect(getSource).toHaveBeenCalledWith("prj_test", "source");
    });
  }

  it.each(["missing-block", "text-drift", "ordinal-drift"])(
    "keeps import UNKNOWN when POST and GET blocks have %s despite valid full text",
    async (failure) => {
      const text = "原文\n>\n> 对白";
      const file = new File([text], "source.txt");
      const raw_sha256 = await sourceFileSha256(file);
      const block = { id: "blk_1", ordinal: 1, text: "原文" };
      const posted = { id: "src_1", project_id: "prj_test", raw_sha256, blocks: [block] };
      const blocks =
        failure === "missing-block"
          ? []
          : [{ ...block, ...(failure === "text-drift" ? { text: "篡改预览" } : { ordinal: 2 }) }];
      const send = vi.fn().mockResolvedValue({ data: posted });
      const getSource = vi.fn().mockResolvedValue({ data: { ...posted, blocks } });
      const getSourceText = vi.fn().mockResolvedValue(await textReadback(posted, text));
      await expect(
        importTextSource(
          { importTextSource: send, getSource, getSourceText } as never,
          "prj_test",
          file,
        ),
      ).resolves.toMatchObject({
        kind: "REMOTE_UNKNOWN",
        sourceId: posted.id,
        rawSha256: raw_sha256,
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(getSourceText).toHaveBeenCalledWith("prj_test", posted.id);
    },
  );

  it("does not sign a saved import when full-text readback exceeds the 5 MiB contract", async () => {
    const file = new File(["x"], "source.txt");
    const raw_sha256 = await sourceFileSha256(file);
    const source = {
      id: "src_test",
      project_id: "prj_test",
      raw_sha256,
      blocks: [{ id: "blk_1", ordinal: 1, text: "x" }],
    };
    const send = vi.fn().mockResolvedValue({ data: source });
    const getSource = vi.fn().mockResolvedValue({ data: source });
    const getSourceText = vi.fn().mockResolvedValue({
      data: {
        id: source.id,
        project_id: source.project_id,
        raw_sha256,
        normalized_text: "x".repeat(MAX_SOURCE_BYTES + 1),
        normalized_sha256: raw_sha256,
      },
    });
    await expect(
      importTextSource(
        { importTextSource: send, getSource, getSourceText } as never,
        "prj_test",
        file,
      ),
    ).resolves.toMatchObject({
      kind: "REMOTE_UNKNOWN",
      sourceId: source.id,
      rawSha256: raw_sha256,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(getSourceText).toHaveBeenCalledWith("prj_test", source.id);
  });

  it("reads the exact persisted text across standalone quote separators", async () => {
    const text =
      "### 镜头 03\n\n> 周野：第一句。\n>\n> 林澄：第二句。\n>\n> 周野：第三句。\n\n### 镜头 04\n\n> 林澄：再见。\n>\n> 周野：好。";
    const source = {
      id: "src_test",
      project_id: "prj_test",
      raw_sha256: await sourceFileSha256(new File([text], "source.txt")),
      blocks: [{ text: "> 周野：第一句。" }, { text: ">" }, { text: "> 林澄：第二句。" }],
    };
    const getSourceText = vi.fn().mockResolvedValue(await textReadback(source, text));
    await expect(
      readSourceDocumentText({ getSourceText } as never, "prj_test", source as never),
    ).resolves.toBe(text);
    expect(getSourceText).toHaveBeenCalledWith("prj_test", "src_test");
  });

  it.each([
    "missing-bridge",
    "not-found",
    "wrong-project",
    "wrong-source",
    "wrong-raw-hash",
    "wrong-normalized-hash",
  ])("does not accept full text when %s", async (failure) => {
    const text = "原文\n>\n> 对白";
    const source = {
      id: "src_test",
      project_id: "prj_test",
      raw_sha256: await sourceFileSha256(new File([text], "source.txt")),
      blocks: [{ text: "原文" }],
    };
    const readback = await textReadback(source, text);
    if (failure === "wrong-project") readback.data.project_id = "prj_other";
    if (failure === "wrong-source") readback.data.id = "src_other";
    if (failure === "wrong-raw-hash") readback.data.raw_sha256 = "a".repeat(64);
    if (failure === "wrong-normalized-hash") readback.data.normalized_sha256 = "b".repeat(64);
    const getSourceText = vi.fn().mockResolvedValue(readback);
    if (failure === "not-found") getSourceText.mockRejectedValue(new Error("404"));
    await expect(
      readSourceDocumentText(
        failure === "missing-bridge" ? ({} as never) : ({ getSourceText } as never),
        "prj_test",
        source as never,
      ),
    ).rejects.toThrow();
    expect(getSourceText).toHaveBeenCalledTimes(failure === "missing-bridge" ? 0 : 1);
  });
});
