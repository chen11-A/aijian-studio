import { expect, test, vi } from "vitest";
import type {
  InvalidationOperationPageResponse,
  InvalidationOperationResponse,
} from "../api/studio";
import {
  INVALIDATION_HISTORY_PAGE_LIMIT,
  InvalidationHistoryController,
} from "./invalidation-history-controller";

const request_id = "e6225937-1243-427b-bc98-56eda28e9dd3";
const projectId = `prj_${"a".repeat(32)}`;
const operationId = `ivo_${"b".repeat(32)}`;
const secondOperationId = `ivo_${"c".repeat(32)}`;
const summary = (id = operationId) => ({
  operation_id: id,
  project_id: projectId,
  changed_artifact_id: `art_${"d".repeat(32)}`,
  old_accepted_version_id: `ver_${"e".repeat(32)}`,
  new_accepted_version_id: `ver_${"f".repeat(32)}`,
  gate_decision_id: `dec_${"1".repeat(32)}`,
  assessment_hash: `sha256:${"2".repeat(64)}`,
  created_at: "2026-08-03T03:00:00Z",
  reason_path_count: 1,
});
const page = (items = [summary()], next_cursor: string | null = null) =>
  ({
    data: { items, next_cursor },
    request_id,
  }) satisfies InvalidationOperationPageResponse;
const fullPage = (firstValue: number, hasNext: boolean) => {
  const items = Array.from({ length: 20 }, (_, index) =>
    summary(`ivo_${(firstValue - index).toString(16).padStart(32, "0")}`),
  );
  return page(items, hasNext ? items.at(-1)!.operation_id : null);
};
const reasonPath: InvalidationOperationResponse["data"]["paths"][number] = {
  path_id: `ivp_${"3".repeat(32)}`,
  operation_id: operationId,
  project_id: projectId,
  affected_artifact_id: `art_${"4".repeat(32)}`,
  affected_version_id: `ver_${"5".repeat(32)}`,
  classification: "INVALIDATE",
  aggregate_impact: "blocking",
  dependency_ids: [`dep_${"6".repeat(32)}`, `dep_${"7".repeat(32)}`],
  relationships: ["derived_from", "renders"],
  edge_impacts: ["blocking", "render_only"],
  effective_impact: "blocking",
  ordinal: 0,
  created_at: "2026-08-03T03:00:00Z",
};
const detail = (id = operationId, paths: InvalidationOperationResponse["data"]["paths"] = []) => {
  const data = Object.fromEntries(
    Object.entries(summary(id)).filter(([key]) => key !== "reason_path_count"),
  ) as Omit<ReturnType<typeof summary>, "reason_path_count">;
  return {
    data: {
      ...data,
      paths: paths.map((value) => ({
        ...value,
        operation_id: id,
        project_id: projectId,
      })),
    },
    request_id,
  } satisfies InvalidationOperationResponse;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("maps frozen API page and detail contracts without dropping reason-path typing", async () => {
  const get = vi.fn().mockResolvedValue(detail(operationId, [reasonPath]));
  const controller = new InvalidationHistoryController(
    { list: vi.fn().mockResolvedValue(page()), get },
    projectId,
  );
  await controller.loadInitial();
  await controller.select(operationId);
  expect(controller.getState().items[0]!.reason_path_count).toBe(1);
  expect(controller.getState().operation!.paths[0]!.relationships[1]).toBe("renders");
  expect(get).toHaveBeenCalledWith(projectId, operationId);
});
test("retries the initial page with fixed API limit and emits every async state", async () => {
  const states: string[] = [];
  const list = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(page());
  const controller = new InvalidationHistoryController({ list, get: vi.fn() }, projectId);
  const unsubscribe = controller.subscribe((state) => states.push(state.list));
  await controller.loadInitial();
  await controller.loadInitial();
  unsubscribe();
  expect(list).toHaveBeenLastCalledWith(projectId, {
    limit: INVALIDATION_HISTORY_PAGE_LIMIT,
  });
  expect(states).toContain("error");
  expect(states).toContain("ready");
});
test("appends by server cursor, preserves rows through error, and serializes duplicate detail selection", async () => {
  const firstPage = fullPage(40, true);
  const secondPage = fullPage(20, false);
  const pending = deferred<InvalidationOperationResponse>();
  const list = vi
    .fn()
    .mockResolvedValueOnce(firstPage)
    .mockRejectedValueOnce(new Error("later"))
    .mockResolvedValueOnce(secondPage);
  const get = vi.fn().mockReturnValue(pending.promise);
  const controller = new InvalidationHistoryController({ list, get }, projectId);
  await controller.loadInitial();
  await controller.loadMore();
  expect(controller.getState()).toMatchObject({
    more: "error",
    items: firstPage.data.items,
  });
  await controller.loadMore();
  expect(controller.getState().items).toHaveLength(40);
  const one = controller.select(operationId);
  const two = controller.select(operationId);
  expect(get).toHaveBeenCalledTimes(1);
  pending.resolve(detail());
  await Promise.all([one, two]);
});
test("refresh invalidates in-flight more while detail remains independently coherent", async () => {
  const lateMore = deferred<InvalidationOperationPageResponse>();
  const lateDetail = deferred<InvalidationOperationResponse>();
  const refreshed = page([summary(secondOperationId)]);
  const list = vi
    .fn()
    .mockResolvedValueOnce(fullPage(40, true))
    .mockReturnValueOnce(lateMore.promise)
    .mockResolvedValueOnce(refreshed);
  const controller = new InvalidationHistoryController(
    { list, get: vi.fn().mockReturnValue(lateDetail.promise) },
    projectId,
  );
  await controller.loadInitial();
  const more = controller.loadMore();
  const selected = controller.select(operationId);
  const refresh = controller.loadInitial();
  lateMore.resolve(fullPage(20, false));
  lateDetail.resolve(detail(operationId, [reasonPath]));
  await Promise.all([more, selected, refresh]);
  expect(controller.getState()).toMatchObject({
    list: "ready",
    items: refreshed.data.items,
    detail: "ready",
    selectedOperationId: operationId,
  });
});
test("project changes and back navigation fail closed while preserving focus restoration identity", async () => {
  const late = deferred<InvalidationOperationResponse>();
  const controller = new InvalidationHistoryController(
    {
      list: vi.fn().mockResolvedValue(page()),
      get: vi.fn().mockReturnValue(late.promise),
    },
    projectId,
  );
  await controller.loadInitial();
  const selected = controller.select(operationId);
  expect(controller.backToList()).toBe(operationId);
  expect(controller.getState().lastSelectedOperationId).toBe(operationId);
  controller.setProject(`prj_${"9".repeat(32)}`);
  late.resolve(detail(operationId, [reasonPath]));
  await selected;
  expect(controller.getState()).toMatchObject({
    detail: "idle",
    selectedOperationId: null,
    lastSelectedOperationId: null,
  });
});
