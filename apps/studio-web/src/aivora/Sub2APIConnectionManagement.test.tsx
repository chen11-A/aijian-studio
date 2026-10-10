import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderConnectionListResponse, StudioTransport } from "../api/studio";
import type * as StudioModule from "../api/studio";
import {
  persistProviderWrite,
  readProviderJournal,
  type ProviderPendingWrite,
} from "../domain/sub2api-provider-journal";
import { Sub2APIConnectionManagement } from "./Sub2APIConnectionManagement";

let transport: Partial<StudioTransport>;
vi.mock("../api/studio", async (importOriginal) => ({
  ...(await importOriginal<typeof StudioModule>()),
  createStudioTransport: () => transport,
}));

type Connection = ProviderConnectionListResponse["data"][number];
const connection: Connection = {
  id: `pcn_${"a".repeat(32)}`,
  provider_kind: "SUB2API",
  display_name: "Synthetic public",
  base_url: "https://gateway.example",
  origin_mode: "PUBLIC_HTTPS",
  enabled: true,
  revision: 1,
  credential_status: "CONFIGURED",
  models: [{ model_id: "synthetic-text", capabilities: ["TEXT"] }],
  created_at: "2026-10-10T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
};
const operationId = `pcop_${"b".repeat(32)}`;
const journalKey = `aivora:sub2api-provider:pending:${connection.id}`;
const metadata: ProviderPendingWrite = {
  kind: "metadata",
  connectionId: connection.id,
  command: {
    expected_revision: 1,
    display_name: "Edited",
    base_url: connection.base_url,
    origin_mode: "PUBLIC_HTTPS",
    enabled: true,
    models: connection.models,
  },
};
const rotation: ProviderPendingWrite = {
  kind: "rotation",
  connectionId: connection.id,
  expectedRevision: 1,
  operationId,
};
function list(current: Connection = connection) {
  return { data: [current], request_id: "synthetic-request" };
}
function rotationRead(id = operationId, status = "APPLIED") {
  return {
    kind: "READ",
    receipt: {
      request_id: "synthetic-request",
      data: {
        connection_id: connection.id,
        operation_id: id,
        expected_revision: 1,
        status,
        applied_revision: status === "APPLIED" ? 2 : null,
        created_at: connection.created_at,
        updated_at: connection.updated_at,
      },
    },
  };
}
function setup(current: Connection = connection) {
  const api = {
    listProviderConnections: vi.fn().mockResolvedValue(list(current)),
    editSub2APIMetadata: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    rotateSub2APIKey: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    readSub2APIKeyRotation: vi.fn().mockImplementation(async (_id, op) => rotationRead(op)),
    readSub2APIConfiguredReadiness: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
  };
  transport = api;
  const onReload = vi.fn().mockResolvedValue(undefined);
  const view = render(<Sub2APIConnectionManagement connection={current} onReload={onReload} />);
  fireEvent.click(screen.getByText(/管理 Sub2API 连接/));
  return { api, onReload, ...view };
}
function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "保存元数据" }));
}
function query() {
  fireEvent.click(screen.getByRole("button", { name: "只读核对原操作" }));
}
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Sub2API metadata management preserves revision and pending intent", () => {
  test("persists the exact intent before one PATCH and clears only after matching readback", async () => {
    const h = setup();
    change("连接名称", " Edited ");
    h.api.editSub2APIMetadata.mockImplementation(async (_id, command) => {
      expect(readProviderJournal(connection.id)).toEqual({ kind: "pending", write: metadata });
      expect(command).toEqual(metadata.command);
      h.api.listProviderConnections.mockResolvedValue(
        list({ ...connection, display_name: "Edited", revision: 2 }),
      );
      return { kind: "REMOTE_UNKNOWN" };
    });
    save();
    save();
    expect(await screen.findByText(/元数据编辑完成/)).toBeInTheDocument();
    expect(h.api.editSub2APIMetadata).toHaveBeenCalledTimes(1);
    expect(h.onReload).toHaveBeenCalledTimes(1);
    expect(readProviderJournal(connection.id)).toEqual({ kind: "empty" });
  });

  test("unchanged metadata is a read-only no-op", async () => {
    const h = setup();
    save();
    expect(await screen.findByText(/元数据没有变化/)).toBeInTheDocument();
    expect(h.api.editSub2APIMetadata).not.toHaveBeenCalled();
    expect(readProviderJournal(connection.id)).toEqual({ kind: "empty" });
  });

  test.each([
    ["连接名称", " "],
    ["连接名称", "x".repeat(81)],
    ["公网 HTTPS origin", "http://remote.example"],
    ["公网 HTTPS origin", "https://example.com/path"],
    ["公网 HTTPS origin", "https://[invalid"],
    ["公网 HTTPS origin", "https://user@example.com"],
    ["TEXT 模型 ID（逗号分隔）", ""],
    ["TEXT 模型 ID（逗号分隔）", "same,same"],
    ["TEXT 模型 ID（逗号分隔）", "x".repeat(201)],
    ["TEXT 模型 ID（逗号分隔）", Array.from({ length: 101 }, (_, n) => `model-${n}`).join(",")],
  ])("invalid %s=%s is rejected before read or write", async (label, value) => {
    const h = setup();
    change(label, value);
    save();
    expect(await screen.findByText(/请填写 1–80/)).toBeInTheDocument();
    expect(h.api.listProviderConnections).not.toHaveBeenCalled();
    expect(h.api.editSub2APIMetadata).not.toHaveBeenCalled();
  });

  test.each([
    "missing",
    "duplicate",
    "wrong-kind",
    "no-request",
    "no-array",
    "unknown-mode",
    "bad-revision",
    "offline",
  ])("pre-write read %s cannot authorize PATCH", async (fault) => {
    const h = setup();
    change("连接名称", "Edited");
    const response = list() as { data: unknown; request_id: string };
    if (fault === "missing") response.data = [];
    if (fault === "duplicate") response.data = [connection, connection];
    if (fault === "wrong-kind") response.data = [{ ...connection, provider_kind: "OPENAI" }];
    if (fault === "no-request") response.request_id = "";
    if (fault === "no-array") response.data = {};
    if (fault === "unknown-mode") response.data = [{ ...connection, origin_mode: undefined }];
    if (fault === "bad-revision") response.data = [{ ...connection, revision: 0 }];
    h.api.listProviderConnections.mockResolvedValue(response);
    if (fault === "offline") h.api.listProviderConnections.mockRejectedValue(new Error("offline"));
    save();
    expect(await screen.findByText(/写前无法读回/)).toBeInTheDocument();
    expect(h.api.editSub2APIMetadata).not.toHaveBeenCalled();
  });

  test.each(["revision", "origin", "name", "enabled", "models", "mode"])(
    "concurrent %s change requires review before write",
    async (field) => {
      const h = setup();
      change("连接名称", "Edited");
      const current = structuredClone(connection);
      if (field === "revision") current.revision++;
      if (field === "origin") current.base_url = "https://changed.example";
      if (field === "name") current.display_name = "Other";
      if (field === "enabled") current.enabled = false;
      if (field === "models") current.models = [{ model_id: "other", capabilities: ["TEXT"] }];
      if (field === "mode") current.origin_mode = "LOCAL_LOOPBACK_HTTP";
      h.api.listProviderConnections.mockResolvedValue(list(current));
      save();
      expect(await screen.findByText(/连接在编辑期间已变化/)).toBeInTheDocument();
      expect(h.api.editSub2APIMetadata).not.toHaveBeenCalled();
      expect(h.onReload).toHaveBeenCalledTimes(1);
    },
  );

  test("mode switch clears the secret and sends explicit canonical local origin", async () => {
    const h = setup();
    change("新密钥", "synthetic-secret");
    fireEvent.click(screen.getByRole("button", { name: "本机 loopback" }));
    expect(screen.getByLabelText("新密钥")).toHaveValue("");
    expect(screen.getByLabelText("新密钥")).toBeDisabled();
    change("本机 IP 与显式端口", "http://127.0.0.1:8000");
    fireEvent.click(screen.getByLabelText("启用连接"));
    change("TEXT 模型 ID（逗号分隔）", "other, second");
    save();
    await waitFor(() => expect(h.api.editSub2APIMetadata).toHaveBeenCalledTimes(1));
    expect(h.api.editSub2APIMetadata.mock.calls[0]![1]).toMatchObject({
      origin_mode: "LOCAL_LOOPBACK_HTTP",
      base_url: "http://127.0.0.1:8000",
      enabled: false,
      models: [
        { model_id: "other", capabilities: ["TEXT"] },
        { model_id: "second", capabilities: ["TEXT"] },
      ],
    });
    expect(await screen.findByText(/元数据编辑尚未/)).toBeInTheDocument();
  });

  test("unknown PATCH stays locked; read-only recovery never PATCHes again", async () => {
    const h = setup();
    change("连接名称", "Edited");
    h.api.editSub2APIMetadata.mockRejectedValue(new Error("response lost"));
    save();
    expect(await screen.findByText(/元数据编辑尚未/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存元数据" })).toBeDisabled();
    h.api.listProviderConnections.mockResolvedValue(
      list({ ...connection, display_name: "Edited", revision: 2 }),
    );
    query();
    expect(await screen.findByText(/元数据编辑完成/)).toBeInTheDocument();
    expect(h.api.editSub2APIMetadata).toHaveBeenCalledTimes(1);
  });

  test("definite metadata rejection releases matching intent without retry", async () => {
    const h = setup();
    change("连接名称", "Edited");
    h.api.editSub2APIMetadata.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "CONFLICT",
    });
    save();
    expect(await screen.findByText(/编辑被明确拒绝：409/)).toBeInTheDocument();
    expect(readProviderJournal(connection.id)).toEqual({ kind: "empty" });
    expect(h.api.editSub2APIMetadata).toHaveBeenCalledTimes(1);
  });

  test("storage failure blocks PATCH before dispatch", async () => {
    const h = setup();
    change("连接名称", "Edited");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    save();
    expect(await screen.findByText(/元数据编辑意图未能持久保存/)).toBeInTheDocument();
    expect(h.api.editSub2APIMetadata).not.toHaveBeenCalled();
  });
});

describe("Sub2API credential rotation and recovery UI", () => {
  test("one explicit secret write then exact readback, with no secret persisted in the journal", async () => {
    const h = setup();
    h.api.listProviderConnections.mockResolvedValue(list({ ...connection, revision: 2 }));
    change("新密钥", "synthetic-secret");
    fireEvent.click(screen.getByRole("button", { name: "明确轮换一次" }));
    expect(screen.getByLabelText("新密钥")).toHaveValue("");
    expect(localStorage.getItem(journalKey)).not.toContain("synthetic-secret");
    expect(await screen.findByText(/原操作已应用/)).toBeInTheDocument();
    expect(h.api.rotateSub2APIKey).toHaveBeenCalledTimes(1);
    const command = h.api.rotateSub2APIKey.mock.calls[0]![1];
    expect(command).toMatchObject({ expected_revision: 1, api_key: "synthetic-secret" });
    expect(h.api.readSub2APIKeyRotation).toHaveBeenCalledExactlyOnceWith(
      connection.id,
      command.operation_id,
    );
    expect(readProviderJournal(connection.id)).toEqual({ kind: "empty" });
  });

  test.each(["short", "contains space", "x".repeat(8193)])(
    "invalid key is never sent",
    async (secret) => {
      const h = setup();
      change("新密钥", secret);
      fireEvent.click(screen.getByRole("button", { name: "明确轮换一次" }));
      expect(await screen.findByText(/新业务密钥须为/)).toBeInTheDocument();
      expect(h.api.rotateSub2APIKey).not.toHaveBeenCalled();
    },
  );

  test.each(["entropy", "storage"])("%s failure prevents secret submission", async (fault) => {
    const h = setup();
    change("新密钥", "synthetic-secret");
    if (fault === "entropy")
      vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
        throw new Error("no entropy");
      });
    else
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("full");
      });
    fireEvent.click(screen.getByRole("button", { name: "明确轮换一次" }));
    expect(
      await screen.findByText(
        fault === "entropy" ? /无法生成操作 ID/ : /换钥匙操作 ID 未能持久保存/,
      ),
    ).toBeInTheDocument();
    expect(h.api.rotateSub2APIKey).not.toHaveBeenCalled();
  });

  test.each(["PREPARED", "UNKNOWN", "CONFLICT"])(
    "%s rotation remains locked across read-only checks",
    async (status) => {
      expect(persistProviderWrite(rotation)).toBe(true);
      const h = setup();
      h.api.readSub2APIKeyRotation.mockResolvedValue(rotationRead(operationId, status));
      query();
      expect(await screen.findByText(new RegExp(`状态 ${status}`))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "明确轮换一次" })).toBeDisabled();
      expect(readProviderJournal(connection.id).kind).toBe("pending");
      expect(h.api.rotateSub2APIKey).not.toHaveBeenCalled();
    },
  );

  test.each(["connection_id", "operation_id", "expected_revision", "offline"])(
    "%s mismatch cannot clear original rotation",
    async (fault) => {
      persistProviderWrite(rotation);
      const h = setup();
      const response = rotationRead();
      if (fault === "offline") h.api.readSub2APIKeyRotation.mockRejectedValue(new Error("offline"));
      else
        h.api.readSub2APIKeyRotation.mockResolvedValue({
          ...response,
          receipt: { ...response.receipt, data: { ...response.receipt.data, [fault]: "wrong" } },
        });
      query();
      expect(await screen.findByText(/原换钥匙操作未能可靠读回/)).toBeInTheDocument();
      expect(readProviderJournal(connection.id)).toEqual({ kind: "pending", write: rotation });
    },
  );

  test("APPLIED without matching current configured revision remains locked", async () => {
    persistProviderWrite(rotation);
    const h = setup();
    query();
    expect(await screen.findByText(/连接修订或凭据状态未匹配/)).toBeInTheDocument();
    expect(readProviderJournal(connection.id).kind).toBe("pending");
    h.api.listProviderConnections.mockResolvedValue(list({ ...connection, revision: 2 }));
    query();
    expect(await screen.findByText(/原操作已应用/)).toBeInTheDocument();
    expect(h.api.rotateSub2APIKey).not.toHaveBeenCalled();
  });

  test("unknown rotation request is queried, not repeated", async () => {
    const h = setup();
    h.api.rotateSub2APIKey.mockRejectedValue(new Error("lost"));
    h.api.readSub2APIKeyRotation.mockImplementation(async (_id, op) => rotationRead(op, "UNKNOWN"));
    change("新密钥", "synthetic-secret");
    fireEvent.click(screen.getByRole("button", { name: "明确轮换一次" }));
    expect(await screen.findByText(/状态 UNKNOWN/)).toBeInTheDocument();
    expect(h.api.rotateSub2APIKey).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("新密钥")).toHaveValue("");
  });

  test("definite rotation rejection is shown without automatic retry", async () => {
    const h = setup();
    h.api.rotateSub2APIKey.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "CONFLICT",
    });
    change("新密钥", "synthetic-secret");
    fireEvent.click(screen.getByRole("button", { name: "明确轮换一次" }));
    expect(await screen.findByText(/换钥匙被明确拒绝：409/)).toBeInTheDocument();
    expect(h.api.rotateSub2APIKey).toHaveBeenCalledTimes(1);
    expect(h.api.readSub2APIKeyRotation).not.toHaveBeenCalled();
    expect(readProviderJournal(connection.id).kind).toBe("empty");
  });

  test("corrupt journal and missing origin mode disable writes", () => {
    localStorage.setItem(journalKey, "{");
    setup({ ...connection, origin_mode: null });
    expect(screen.getByText(/本地操作记录不可读取/)).toBeInTheDocument();
    expect(screen.getByText(/连接列表未提供可核对/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存元数据" })).toBeDisabled();
  });

  test("missing read capability keeps a recovered rotation locked", async () => {
    persistProviderWrite(rotation);
    const h = setup();
    delete transport.readSub2APIKeyRotation;
    query();
    expect(await screen.findByText(/缺少按原操作 ID 查询/)).toBeInTheDocument();
    expect(h.api.rotateSub2APIKey).not.toHaveBeenCalled();
  });

  test("scope change clears typed secret and ignores a late metadata pre-read", async () => {
    const h = setup();
    let release!: (value: ProviderConnectionListResponse) => void;
    h.api.listProviderConnections.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    change("连接名称", "Edited");
    change("新密钥", "synthetic-secret");
    save();
    h.rerender(
      <Sub2APIConnectionManagement
        connection={{ ...connection, revision: 2 }}
        onReload={h.onReload}
      />,
    );
    expect(screen.getByLabelText("新密钥")).toHaveValue("");
    await act(async () => {
      release(list());
    });
    expect(h.api.editSub2APIMetadata).not.toHaveBeenCalled();
    expect(readProviderJournal(connection.id).kind).toBe("empty");
  });
});
