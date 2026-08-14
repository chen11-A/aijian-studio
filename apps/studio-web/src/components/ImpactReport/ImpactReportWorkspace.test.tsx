import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  InvalidationOperationDetailResponse,
  InvalidationOperationListResponse,
  ProjectData,
} from "../../api/studio";
import { ImpactReportWorkspace } from "./ImpactReportWorkspace";

const project = {
  id: `prj_${"a".repeat(32)}`,
  name: "雾城来信",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 1,
  created_at: "2026-08-04T09:00:00Z",
  updated_at: "2026-08-04T09:00:00Z",
} satisfies ProjectData;

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";

const zeroImpactSummary = {
  operation_id: `invop_${"1".repeat(32)}`,
  project_id: project.id,
  changed_artifact_id: `art_${"2".repeat(32)}`,
  old_accepted_version_id: `ver_${"3".repeat(32)}`,
  new_accepted_version_id: `ver_${"4".repeat(32)}`,
  gate_decision_id: `dec_${"5".repeat(32)}`,
  created_at: "2026-08-03T12:00:00Z",
  affected_version_count: 0,
  independent_path_count: 0,
  impact_counts: { blocking: 0, render_only: 0, advisory: 0 },
  strongest_effective_impact: null,
} satisfies InvalidationOperationListResponse["data"]["operations"][number];

const populatedSummary = {
  operation_id: `invop_${"6".repeat(32)}`,
  project_id: project.id,
  changed_artifact_id: `art_${"2".repeat(32)}`,
  old_accepted_version_id: `ver_${"3".repeat(32)}`,
  new_accepted_version_id: `ver_${"7".repeat(32)}`,
  gate_decision_id: `dec_${"8".repeat(32)}`,
  created_at: "2026-08-03T13:00:00Z",
  affected_version_count: 2,
  independent_path_count: 3,
  impact_counts: { blocking: 1, render_only: 1, advisory: 1 },
  strongest_effective_impact: "blocking",
} satisfies InvalidationOperationListResponse["data"]["operations"][number];

const populatedDetail = {
  data: {
    operation: populatedSummary,
    affected_versions: [
      {
        affected_artifact_id: `art_${"9".repeat(32)}`,
        affected_version_id: `ver_${"a".repeat(32)}`,
        strongest_effective_impact: "blocking",
        general_stale: true,
        general_blocked: true,
        render_blocked: true,
        paths: [
          {
            impact_id: `invimp_${"b".repeat(32)}`,
            path_ordinal: 0,
            dependency_path: [`dep_${"c".repeat(32)}`],
            path_relationships: ["derived_from"],
            path_impacts: ["blocking"],
            effective_impact: "blocking",
          },
          {
            impact_id: `invimp_${"d".repeat(32)}`,
            path_ordinal: 1,
            dependency_path: [`dep_${"e".repeat(32)}`, `dep_${"f".repeat(32)}`],
            path_relationships: ["references", "derived_from"],
            path_impacts: ["advisory", "render_only"],
            effective_impact: "render_only",
          },
        ],
      },
      {
        affected_artifact_id: `art_${"9".repeat(32)}`,
        affected_version_id: `ver_${"1".repeat(32)}`,
        strongest_effective_impact: "advisory",
        general_stale: false,
        general_blocked: false,
        render_blocked: false,
        paths: [
          {
            impact_id: `invimp_${"2".repeat(32)}`,
            path_ordinal: 0,
            dependency_path: [`dep_${"3".repeat(32)}`],
            path_relationships: ["mentions"],
            path_impacts: ["advisory"],
            effective_impact: "advisory",
          },
        ],
      },
    ],
  },
  request_id: requestId,
} satisfies InvalidationOperationDetailResponse;

const zeroImpactDetail = {
  data: {
    operation: zeroImpactSummary,
    affected_versions: [],
  },
  request_id: requestId,
} satisfies InvalidationOperationDetailResponse;

function listResponse(
  operations: InvalidationOperationListResponse["data"]["operations"],
): InvalidationOperationListResponse {
  return {
    data: { project_id: project.id, operations },
    request_id: requestId,
  };
}

function operationButtons() {
  return within(screen.getByRole("list", { name: "改稿记录列表" })).getAllByRole("button");
}

function openTechnicalDetails() {
  for (const summary of screen.getAllByText("技术详情")) {
    fireEvent.click(summary);
  }
}

describe("impact report workspace", () => {
  test("covers loading, empty history, and recoverable list error", async () => {
    const listOperations = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(listResponse([]));
    render(
      <ImpactReportWorkspace
        project={project}
        listOperations={listOperations}
        getOperation={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在读取影响历史");
    expect(await screen.findByText("改稿影响暂时无法读取")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByText("还没有改稿记录")).toBeInTheDocument();
    expect(listOperations).toHaveBeenCalledTimes(2);
  });

  test("selects newest operation and renders zero-impact detail honestly", async () => {
    const listOperations = vi.fn().mockResolvedValue(listResponse([zeroImpactSummary]));
    const getOperation = vi.fn().mockResolvedValue(zeroImpactDetail);
    render(
      <ImpactReportWorkspace
        project={project}
        listOperations={listOperations}
        getOperation={getOperation}
      />,
    );

    expect(await screen.findAllByText("无影响")).not.toHaveLength(0);
    expect(getOperation).toHaveBeenCalledWith(project.id, zeroImpactSummary.operation_id);
    expect(await screen.findByText(/没有需要跟着改的后续内容/)).toBeInTheDocument();
    expect(screen.getAllByText(/当时的快照|不是现在的状态/).length).toBeGreaterThan(0);
  });

  test("keeps multiple versions and paths distinct with full chains and text severity", async () => {
    const listOperations = vi
      .fn()
      .mockResolvedValue(listResponse([zeroImpactSummary, populatedSummary]));
    const getOperation = vi.fn().mockImplementation(async (_projectId, operationId: string) => {
      if (operationId === populatedSummary.operation_id) return populatedDetail;
      return zeroImpactDetail;
    });
    render(
      <ImpactReportWorkspace
        project={project}
        listOperations={listOperations}
        getOperation={getOperation}
      />,
    );

    expect(await screen.findAllByText(/影响了 2 个后续版本/)).not.toHaveLength(0);
    expect(getOperation).toHaveBeenCalledWith(project.id, populatedSummary.operation_id);
    expect(await screen.findByText("必须重做 / 只影响成片 / 提示")).toBeInTheDocument();
    expect(screen.getByText("1 / 1 / 1")).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "改稿记录列表" });
    expect(within(list).getAllByText("必须重做").length).toBeGreaterThan(0);
    expect(within(list).getAllByText("无影响").length).toBeGreaterThan(0);

    openTechnicalDetails();
    expect(screen.getByText(`ver_${"a".repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText(`ver_${"1".repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText(`dep_${"c".repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText(`dep_${"e".repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText(`dep_${"f".repeat(32)}`)).toBeInTheDocument();
    expect(screen.getAllByText("关系 derived_from").length).toBeGreaterThan(0);
    expect(screen.getByText("关系 references")).toBeInTheDocument();
    expect(screen.getByText("关系 mentions")).toBeInTheDocument();
    expect(screen.getAllByText(/影响路径 1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/影响路径 2/)).toBeInTheDocument();
    expect(screen.getByText("当时已过期")).toBeInTheDocument();
    expect(screen.getByText("当时必须重做")).toBeInTheDocument();
    expect(screen.getByText("当时成片受阻")).toBeInTheDocument();
    expect(screen.getByText("当时没有必须重做的项")).toBeInTheDocument();

    // Textual severity remains distinguishable beyond color classes.
    expect(screen.getAllByText("必须重做").length).toBeGreaterThan(0);
    expect(screen.getAllByText("只影响成片").length).toBeGreaterThan(0);
    expect(screen.getAllByText("提示").length).toBeGreaterThan(0);

    fireEvent.click(operationButtons()[0]!);
    await waitFor(() =>
      expect(getOperation).toHaveBeenCalledWith(project.id, zeroImpactSummary.operation_id),
    );
  });

  test("ignores stale list and detail responses after newer selection", async () => {
    const listDeferred: {
      resolve: (value: InvalidationOperationListResponse) => void;
    } = {
      resolve: () => undefined,
    };
    const detailDeferred: {
      resolve: (value: InvalidationOperationDetailResponse) => void;
    } = {
      resolve: () => undefined,
    };
    const listOperations = vi.fn().mockImplementation(
      () =>
        new Promise<InvalidationOperationListResponse>((resolve) => {
          listDeferred.resolve = resolve;
        }),
    );
    const getOperation = vi.fn().mockImplementation((_projectId, operationId: string) => {
      if (operationId === zeroImpactSummary.operation_id) {
        return new Promise<InvalidationOperationDetailResponse>((resolve) => {
          detailDeferred.resolve = resolve;
        });
      }
      return Promise.resolve(populatedDetail);
    });

    const firstProject = project;
    const secondProject = { ...project, id: `prj_${"b".repeat(32)}`, name: "第二项目" };
    const { rerender } = render(
      <ImpactReportWorkspace
        project={firstProject}
        listOperations={listOperations}
        getOperation={getOperation}
      />,
    );

    // Switch project before the first list resolves.
    rerender(
      <ImpactReportWorkspace
        project={secondProject}
        listOperations={vi.fn().mockResolvedValue(
          listResponse([
            { ...zeroImpactSummary, project_id: secondProject.id },
            { ...populatedSummary, project_id: secondProject.id },
          ]),
        )}
        getOperation={getOperation}
      />,
    );

    expect(await screen.findAllByText(/影响了 2 个后续版本/)).not.toHaveLength(0);
    listDeferred.resolve(listResponse([zeroImpactSummary]));

    // Select older operation, then switch to newer before the older detail resolves.
    fireEvent.click(operationButtons()[0]!);
    await waitFor(() =>
      expect(getOperation).toHaveBeenCalledWith(secondProject.id, zeroImpactSummary.operation_id),
    );
    fireEvent.click(operationButtons()[1]!);
    await waitFor(() => {
      expect(screen.getByText("1 / 1 / 1")).toBeInTheDocument();
    });
    detailDeferred.resolve(zeroImpactDetail);

    await waitFor(() => {
      expect(screen.getByText("1 / 1 / 1")).toBeInTheDocument();
    });
    expect(screen.queryByText(/没有独立下游路径/)).not.toBeInTheDocument();
  });

  test("retries a failed detail load", async () => {
    const listOperations = vi.fn().mockResolvedValue(listResponse([populatedSummary]));
    const getOperation = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(populatedDetail);
    render(
      <ImpactReportWorkspace
        project={project}
        listOperations={listOperations}
        getOperation={getOperation}
      />,
    );

    expect(await screen.findByText("记录详情暂时无法读取")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByText(/影响了 2 个后续版本/)).toBeInTheDocument();
    expect(getOperation).toHaveBeenCalledTimes(2);
  });
});
