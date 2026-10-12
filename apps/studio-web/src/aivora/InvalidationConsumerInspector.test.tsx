import { act, render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import fixture from "../../../desktop/src/invalidation-consumer.testFixture.json";
import { InvalidationConsumerInspector } from "./InvalidationConsumerInspector";
import type { AijianDesktopBridge } from "../api/studio";
import type {
  InvalidationConsumerResponse,
  InvalidationConsumerIdentity,
} from "@aijian/contracts/invalidation-consumer";
const identity = fixture.identity;
function bridge() {
  const inspect = vi.fn().mockResolvedValue(fixture.response);
  window.aijian = { inspectInvalidationConsumer: inspect } as unknown as AijianDesktopBridge;
  return inspect;
}
afterEach(() => {
  cleanup();
  delete window.aijian;
});
it("reads only after explicit click and shows the exact saved episode/shot context", async () => {
  const inspect = bridge();
  render(<InvalidationConsumerInspector identity={identity} />);
  expect(inspect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看分集与镜头" }));
  await screen.findByText(/第1集 · 第 1 集/);
  expect(screen.getByText(/镜头 1 · 镜头 1/)).toBeTruthy();
  expect(screen.getByText(/本版本全部镜头/)).toBeTruthy();
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(inspect).toHaveBeenCalledWith(identity);
});
it.each(["wrong-project", "wrong-version", "bad-assessment"])(
  "retains the report identity on %s then explicitly retries the same read",
  async (fault) => {
    const inspect = bridge(),
      bad = structuredClone(fixture.response);
    if (fault === "wrong-project") bad.data.project_id = "prj_" + "0".repeat(32);
    if (fault === "wrong-version") bad.data.version_id = "ver_" + "0".repeat(32);
    if (fault === "bad-assessment") bad.data.assessment_hash = "sha256:" + "0".repeat(64);
    inspect.mockResolvedValueOnce(bad);
    render(<InvalidationConsumerInspector identity={identity} />);
    fireEvent.click(screen.getByRole("button", { name: "查看分集与镜头" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(/第1集 · 第 1 集/)).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "查看分集与镜头" }));
    await screen.findByText(/第1集 · 第 1 集/);
    expect(inspect.mock.calls).toEqual([[identity], [identity]]);
  },
);
it("preserves a previous verified exact summary when a later explicit read is unknown", async () => {
  const inspect = bridge();
  render(<InvalidationConsumerInspector identity={identity} />);
  fireEvent.click(screen.getByRole("button", { name: "查看分集与镜头" }));
  await screen.findByText(/第1集 · 第 1 集/);
  inspect.mockRejectedValueOnce(new Error("unknown"));
  fireEvent.click(screen.getByRole("button", { name: "重新核对分集与镜头" }));
  await screen.findByRole("alert");
  expect(screen.getByText(/第1集 · 第 1 集/)).toBeTruthy();
  expect(screen.getByText(/上次已核对/)).toBeTruthy();
});
it("drops a late A reply after A→B→A and prevents concurrent duplicate reads", async () => {
  const inspect = bridge();
  let finish!: (v: InvalidationConsumerResponse) => void;
  inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<InvalidationConsumerInspector identity={identity} />);
  fireEvent.click(screen.getByRole("button", { name: "查看分集与镜头" }));
  fireEvent.click(screen.getByRole("button", { name: "查看分集与镜头" }));
  expect(inspect).toHaveBeenCalledTimes(1);
  const other: InvalidationConsumerIdentity = { ...identity, project_id: "prj_" + "0".repeat(32) };
  view.rerender(<InvalidationConsumerInspector identity={other} />);
  view.rerender(<InvalidationConsumerInspector identity={identity} />);
  await act(async () => finish(fixture.response as InvalidationConsumerResponse));
  expect(screen.queryByText(/第1集 · 第 1 集/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看分集与镜头" }));
  await screen.findByText(/第1集 · 第 1 集/);
  await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
});
