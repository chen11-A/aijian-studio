import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { InvalidationOperationPageResponse } from "../api/studio";
import type { InvalidationHistoryGateway } from "./invalidation-history-controller";
import { useInvalidationHistory } from "./use-invalidation-history";

const projectA = `prj_${"a".repeat(32)}`;
const projectB = `prj_${"b".repeat(32)}`;
const page = (id: string, responseProjectId = projectA): InvalidationOperationPageResponse => ({
  data: {
    items: [
      {
        operation_id: id,
        project_id: responseProjectId,
        changed_artifact_id: `art_${"c".repeat(32)}`,
        old_accepted_version_id: `ver_${"d".repeat(32)}`,
        new_accepted_version_id: `ver_${"e".repeat(32)}`,
        gate_decision_id: `dec_${"1".repeat(32)}`,
        assessment_hash: `sha256:${"2".repeat(64)}`,
        created_at: "2026-08-03T03:00:00Z",
        reason_path_count: 0,
      },
    ],
    next_cursor: null,
  },
  request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const gateway = (list: InvalidationHistoryGateway["list"]): InvalidationHistoryGateway => ({
  list,
  get: vi.fn(),
});

test("reports asynchronous initial data to the rendered hook state", async () => {
  const list = vi.fn().mockResolvedValue(page(`ivo_${"3".repeat(32)}`));
  const g = gateway(list);
  const { result } = renderHook(() => useInvalidationHistory(g, projectA));
  await waitFor(() => expect(result.current[1].list).toBe("ready"));
  expect(result.current[1].items).toHaveLength(1);
});
test("drops a late old-project result after rerender", async () => {
  const old = deferred<InvalidationOperationPageResponse>();
  const list = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(page(`ivo_${"4".repeat(32)}`, projectB));
  const g = gateway(list);
  const { result, rerender } = renderHook(({ project }) => useInvalidationHistory(g, project), {
    initialProps: { project: projectA },
  });
  rerender({ project: projectB });
  await waitFor(() => expect(result.current[1].projectId).toBe(projectB));
  old.resolve(page(`ivo_${"5".repeat(32)}`));
  await waitFor(() => expect(result.current[1].list).toBe("ready"));
  expect(result.current[1].items[0]!.operation_id).toBe(`ivo_${"4".repeat(32)}`);
});
test("rebuilds for a same-project gateway change and rejects the old result", async () => {
  const old = deferred<InvalidationOperationPageResponse>();
  const g1 = gateway(vi.fn().mockReturnValue(old.promise));
  const g2 = gateway(vi.fn().mockResolvedValue(page(`ivo_${"6".repeat(32)}`)));
  const { result, rerender } = renderHook(({ g }) => useInvalidationHistory(g, projectA), {
    initialProps: { g: g1 },
  });
  rerender({ g: g2 });
  await waitFor(() =>
    expect(result.current[1].items[0]?.operation_id).toBe(`ivo_${"6".repeat(32)}`),
  );
  old.resolve(page(`ivo_${"7".repeat(32)}`));
  await act(async () => {
    await old.promise;
  });
  expect(result.current[1].items[0]!.operation_id).toBe(`ivo_${"6".repeat(32)}`);
});
test("unmount cancels late work and does not request again", async () => {
  const late = deferred<InvalidationOperationPageResponse>();
  const list = vi.fn().mockReturnValue(late.promise);
  const g = gateway(list);
  const { result, unmount } = renderHook(() => useInvalidationHistory(g, projectA));
  const controller = result.current[0];
  unmount();
  late.resolve(page(`ivo_${"8".repeat(32)}`));
  await act(async () => {
    await late.promise;
  });
  expect(list).toHaveBeenCalledTimes(1);
  expect(controller.getState().list).toBe("loading");
});
