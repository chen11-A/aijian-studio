import { describe, expect, it } from "vitest";

import { isCanonicalWorkspaceRelativePath } from "./development-export-contract";
import { isRemoteSourceExtractCreateCommand } from "./remote-source-extract-contract";

function sourceExtractCommand(modelId: string) {
  return {
    operation_id: "00000000-0000-4000-8000-000000000000",
    input: {
      source: {
        agent_definition: { definition_id: "writer.source-analyst", version: "1.1.0" },
        skill_definition: { definition_id: "source.extract", version: "1.1.0" },
        source_manifest_version_id: `ver_${"a".repeat(32)}`,
        source_document_id: `src_${"b".repeat(32)}`,
        source_block_id: `srcb_${"c".repeat(32)}`,
        start_byte: 0,
        end_byte: 128,
      },
      selection: {
        connection_id: `pcn_${"d".repeat(32)}`,
        connection_revision: 1,
        model_id: modelId,
      },
    },
  };
}

const controlCodes = [...Array.from({ length: 32 }, (_, index) => index), 127];

describe("desktop contract control-character boundaries", () => {
  it.each(controlCodes)("rejects character code %i in paths and model identifiers", (code) => {
    const control = String.fromCharCode(code);
    expect(isCanonicalWorkspaceRelativePath(`exports/draft${control}.mp4`)).toBe(false);
    expect(isRemoteSourceExtractCreateCommand(sourceExtractCommand(`model${control}id`))).toBe(
      false,
    );
  });

  it.each(["exports/剧本-第一集.mp4", "exports/my draft.mp4", "exports/🎬.mp4"])(
    "preserves ordinary Unicode path %s",
    (path) => expect(isCanonicalWorkspaceRelativePath(path)).toBe(true),
  );

  it.each(["model-v1", "provider/model:latest", "模型-v1"])(
    "preserves ordinary model identifier %s",
    (modelId) =>
      expect(isRemoteSourceExtractCreateCommand(sourceExtractCommand(modelId))).toBe(true),
  );

  it.each([
    "",
    "/absolute.mp4",
    "../draft.mp4",
    "exports/./draft.mp4",
    "exports//draft.mp4",
    "C:/draft.mp4",
    "exports\\draft.mp4",
  ])("keeps rejecting noncanonical path %s", (path) =>
    expect(isCanonicalWorkspaceRelativePath(path)).toBe(false),
  );
});
