import { describe, expect, it } from "vitest";
import {
  parseOperationQuery,
  parsePreviewRequest,
  parseSendRequest,
} from "./assistant-chat-validation";

const id = "11111111-1111-4111-8111-111111111111";
const preview = {
  sessionId: id,
  scope: { projectId: null, episodeId: null, page: "home" },
  userText: "如何开始？",
  model: "fixture",
  expectedProfileId: id,
  references: [],
};

describe("assistant chat renderer input", () => {
  it("accepts bounded projectless chat and rejects extra fields or mismatched scope", () => {
    expect(parsePreviewRequest(preview)).toEqual(preview);
    expect(parsePreviewRequest({ ...preview, body: "untrusted" })).toBeNull();
    expect(
      parsePreviewRequest({
        ...preview,
        scope: { ...preview.scope, episodeId: "ep_" + "a".repeat(32) },
      }),
    ).toBeNull();
    expect(parsePreviewRequest({ ...preview, userText: "x".repeat(8001) })).toBeNull();
  });

  it("accepts only saved, bounded object references", () => {
    const reference = {
      objectKind: "CREATIVE_WORLD",
      objectId: "world",
      versionId: "ver_" + "a".repeat(32),
      contentHash: "sha256:" + "b".repeat(64),
      headRevision: 1,
    };
    const scoped = {
      ...preview,
      scope: { projectId: "prj_" + "a".repeat(32), episodeId: null, page: "world" },
      references: [reference],
    };
    expect(parsePreviewRequest(scoped)).toEqual(scoped);
    expect(parsePreviewRequest({ ...scoped, references: Array(4).fill(reference) })).toBeNull();
    expect(
      parsePreviewRequest({ ...scoped, references: [{ ...reference, content: "forged" }] }),
    ).toBeNull();
    expect(
      parsePreviewRequest({ ...scoped, references: [{ ...reference, objectId: "other" }] }),
    ).toBeNull();
  });

  it("requires an exact frozen send identity", () => {
    const send = {
      previewId: id,
      operationId: id,
      inputHash: "sha256:" + "a".repeat(64),
      expectedProfileId: id,
    };
    expect(parseSendRequest(send)).toEqual(send);
    expect(parseSendRequest({ ...send, inputHash: "bad" })).toBeNull();
    expect(parseSendRequest({ ...send, text: "replacement" })).toBeNull();
  });

  it("binds operation reads to a validated project and episode scope", () => {
    const query = {
      operationId: id,
      expectedProfileId: id,
      scope: {
        projectId: "prj_" + "a".repeat(32),
        episodeId: "ep_" + "b".repeat(32),
        page: "review",
      },
    };
    expect(parseOperationQuery(query)).toEqual(query);
    expect(parseOperationQuery({ operationId: id, expectedProfileId: id })).toBeNull();
    expect(
      parseOperationQuery({
        ...query,
        scope: { projectId: null, episodeId: query.scope.episodeId, page: "review" },
      }),
    ).toBeNull();
  });
});
