import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionListResponse, Sub2APIReadinessResult } from "../api/studio";
import { Sub2APIReadiness } from "./Sub2APIReadiness";
const connection: ProviderConnectionListResponse["data"][number] = {
  id: `pcn_${"a".repeat(32)}`,
  provider_kind: "SUB2API",
  display_name: "Local test",
  base_url: "http://127.0.0.1:18080",
  origin_mode: "LOCAL_LOOPBACK_HTTP",
  enabled: true,
  revision: 2,
  credential_status: "CONFIGURED",
  models: [{ model_id: "test-model", capabilities: ["TEXT"] }],
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
};
function result(): Sub2APIReadinessResult {
  return {
    kind: "READ",
    receipt: {
      data: {
        connection_id: connection.id,
        connection_revision: connection.revision,
        origin_mode: connection.origin_mode,
        model_id: "test-model",
        credential_status: "CONFIGURED",
        runtime_status: "WAITING_FOR_EXPLICIT_APPROVAL",
        local_preconditions_met: true,
        reasons: [],
        provider_observation: "NOT_CHECKED",
        model_entitlement: "UNKNOWN",
      },
      request_id: "local-test",
    },
  };
}
afterEach(cleanup);
describe("saved Sub2API local readiness", () => {
  it("can check loopback without suggesting live inference succeeded", async () => {
    const read = vi.fn().mockResolvedValue(result());
    render(<Sub2APIReadiness connection={connection} read={read} />);
    fireEvent.click(screen.getByRole("button", { name: "只读核对本地配置" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未连接供应商验证");
    expect(read).toHaveBeenCalledExactlyOnceWith(connection.id, "test-model");
  });
  it.each(["origin_mode", "connection_revision", "model_id"] as const)(
    "rejects mismatched %s",
    async (field) => {
      const value = result();
      if (value.kind !== "READ") throw new Error("bad fixture");
      if (field === "origin_mode") value.receipt.data.origin_mode = "PUBLIC_HTTPS";
      if (field === "connection_revision") value.receipt.data.connection_revision = 3;
      if (field === "model_id") value.receipt.data.model_id = "different";
      render(<Sub2APIReadiness connection={connection} read={vi.fn().mockResolvedValue(value)} />);
      fireEvent.click(screen.getByRole("button", { name: "只读核对本地配置" }));
      expect(await screen.findByRole("status")).toHaveTextContent("不一致");
    },
  );
  it("explains missing configuration without exposing credentials", async () => {
    const value = result();
    if (value.kind !== "READ") throw new Error("bad fixture");
    value.receipt.data.local_preconditions_met = false;
    value.receipt.data.reasons = ["CREDENTIAL_MISSING", "RUNTIME_UNAVAILABLE"];
    render(<Sub2APIReadiness connection={connection} read={vi.fn().mockResolvedValue(value)} />);
    fireEvent.click(screen.getByRole("button", { name: "只读核对本地配置" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未保存业务密钥");
    expect(screen.getByRole("status")).toHaveTextContent("执行器尚未就绪");
  });
  it("keeps unknown or rejected local reads distinct", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
      kind: "DEFINITE_SERVER_ERROR",
      status: 404,
      code: "PROVIDER_CONNECTION_NOT_FOUND",
      request_id: "test",
    });
    render(<Sub2APIReadiness connection={connection} read={read} />);
    fireEvent.click(screen.getByRole("button", { name: "只读核对本地配置" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚无法核实");
    fireEvent.click(screen.getByRole("button", { name: "只读核对本地配置" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "404 / PROVIDER_CONNECTION_NOT_FOUND",
    );
  });
  it("deduplicates reads and discards results when unmounted", async () => {
    let finish: (value: Sub2APIReadinessResult) => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<Sub2APIReadinessResult>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<Sub2APIReadiness connection={connection} read={read} />);
    const button = screen.getByRole("button", { name: "只读核对本地配置" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(read).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    view.unmount();
    await act(async () => finish(result()));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
