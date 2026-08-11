import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ProposalRunCapability,
  SourceDocumentResponse,
  SourceManifestResponse,
} from "../../api/studio";
import { createProposalRunOperationJournal } from "../../proposal-run-operation-journal";
import { SourceExtractRunLauncher } from "./SourceExtractRunLauncher";

const projectId = `prj_${"1".repeat(32)}`;
const sourceId = `src_${"2".repeat(32)}`;
const blockId = `srcb_${"3".repeat(32)}`;
const versionId = `ver_${"4".repeat(32)}`;
const operationId = "87302cb8-71f8-4bb9-856a-162571f1ae6e";
const source = {
  data: {
    id: sourceId,
    project_id: projectId,
    filename: "story.txt",
    media_type: "text/plain",
    encoding: "utf-8",
    byte_size: 24,
    raw_sha256: "5".repeat(64),
    imported_at: "2026-08-11T09:00:00Z",
    chapter_count: 1,
    block_count: 1,
    blocks: [
      {
        id: blockId,
        ordinal: 0,
        kind: "paragraph",
        chapter_index: 1,
        text: "雾城来信的第一段原文",
        normalized_start_byte: 0,
        normalized_end_byte: 24,
        content_sha256: "6".repeat(64),
      },
    ],
  },
  request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
} satisfies SourceDocumentResponse;
const manifestVersion = {
  id: versionId,
  artifact_id: `art_${"7".repeat(32)}`,
  version_number: 1,
  schema_version: "1.0.0" as const,
  content: {
    scope_type: "full_work" as const,
    documents: [
      {
        source_document_id: sourceId,
        import_order: 1,
        filename: "story.txt",
        media_type: "text/plain" as const,
        encoding: "utf-8" as const,
        byte_size: 24,
        raw_sha256: "5".repeat(64),
        normalized_sha256: "8".repeat(64),
        chapter_count: 1,
        blocks: [
          {
            source_block_id: blockId,
            ordinal: 0,
            kind: "paragraph" as const,
            chapter_index: 1,
            start_byte: 0,
            end_byte: 24,
            content_sha256: "6".repeat(64),
          },
        ],
      },
    ],
    exclusions: [],
  },
  content_hash: `sha256:${"9".repeat(64)}`,
  parent_version_id: null,
  change_summary: "冻结小说来源",
  created_at: "2026-08-11T09:01:00Z",
};
const manifest = {
  data: {
    project_id: projectId,
    head: {
      artifact_id: manifestVersion.artifact_id,
      latest_version_id: versionId,
      review_version_id: versionId,
      review_submission_id: `sub_${"a".repeat(32)}`,
      accepted_version_id: versionId,
      revision: 3,
      review_evidence_revision: 1,
      updated_at: "2026-08-11T09:02:00Z",
    },
    latest_version: manifestVersion,
    review_version: manifestVersion,
    accepted_version: manifestVersion,
  },
  request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
} satisfies SourceManifestResponse;

function journal() {
  return createProposalRunOperationJournal(localStorage, {
    operationId: () => operationId,
    now: () => "2026-08-11T10:00:00.000Z",
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
});

describe("source extract run launcher", () => {
  test("does not expose creation in ordinary Web or at the 390px review viewport", async () => {
    const getManifest = vi.fn().mockResolvedValue(manifest);
    const ordinary = render(
      <SourceExtractRunLauncher projectId={projectId} source={source} getManifest={getManifest} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(getManifest).not.toHaveBeenCalled();
    ordinary.unmount();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    render(
      <SourceExtractRunLauncher
        projectId={projectId}
        source={source}
        getManifest={getManifest}
        capability={{ create: vi.fn() }}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(getManifest).not.toHaveBeenCalled();
  });

  test("submits the exact first approved block through the persistent journal", async () => {
    const create = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    render(
      <SourceExtractRunLauncher
        projectId={projectId}
        source={source}
        getManifest={vi.fn().mockResolvedValue(manifest)}
        capability={{ create }}
        journal={journal()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "启动来源提取" }));
    expect(await screen.findByText("提交结果未知")).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith(projectId, {
      operation_id: operationId,
      input: {
        agent_definition: { definition_id: "writer.source-analyst", version: "1.0.0" },
        skill_definition: { definition_id: "source.extract", version: "1.0.0" },
        source_manifest_version_id: versionId,
        source_document_id: sourceId,
        source_block_id: blockId,
        start_byte: 0,
        end_byte: 24,
      },
    });
    expect(screen.getByText(/不会自动换一个操作重新计费/)).toBeInTheDocument();
  });

  test("restores the same pending operation after remount for an explicit retry", async () => {
    const persistentJournal = journal();
    const firstCreate = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    const first = render(
      <SourceExtractRunLauncher
        projectId={projectId}
        source={source}
        getManifest={vi.fn().mockResolvedValue(manifest)}
        capability={{ create: firstCreate }}
        journal={persistentJournal}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "启动来源提取" }));
    await screen.findByText("提交结果未知");
    first.unmount();

    const retryCreate = vi.fn().mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "PROPOSAL_RUN_CONFLICT",
      request_id: "123e4567-e89b-42d3-a456-426614174000",
    });
    const reloadedManifest = vi.fn().mockRejectedValue(new Error("manifest changed"));
    render(
      <SourceExtractRunLauncher
        projectId={projectId}
        source={source}
        getManifest={reloadedManifest}
        capability={{ create: retryCreate } as ProposalRunCapability}
        journal={persistentJournal}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "恢复同一操作" }));
    await waitFor(() => expect(retryCreate).toHaveBeenCalled());
    expect(retryCreate.mock.calls[0]?.[1].operation_id).toBe(operationId);
    expect(reloadedManifest).not.toHaveBeenCalled();
    expect(await screen.findByText(/服务器已明确拒绝/)).toBeInTheDocument();
    expect(persistentJournal.load(projectId)).toBeNull();
  });

  test("fails closed when no accepted manifest or exact bounded block exists", async () => {
    const unavailableManifest: SourceManifestResponse = {
      ...manifest,
      data: {
        ...manifest.data,
        head: { ...manifest.data.head, accepted_version_id: null },
        accepted_version: null,
      },
    };
    render(
      <SourceExtractRunLauncher
        projectId={projectId}
        source={source}
        getManifest={vi.fn().mockResolvedValue(unavailableManifest)}
        capability={{ create: vi.fn() }}
        journal={journal()}
      />,
    );

    expect(await screen.findByText(/需要先由具名人员批准来源清单/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启动来源提取" })).not.toBeInTheDocument();
  });
});
