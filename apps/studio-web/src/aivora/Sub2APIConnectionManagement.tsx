import { useEffect, useMemo, useRef, useState } from "react";
import {
  createStudioTransport,
  type ProviderConnectionListResponse,
  type Sub2APIMetadataCommand,
} from "../api/studio";
import {
  clearProviderWrite,
  newRotationOperationId,
  persistProviderWrite,
  readProviderJournal,
  type ProviderPendingWrite,
} from "../domain/sub2api-provider-journal";
import {
  isLiteralSub2APILoopbackOrigin,
  sub2apiOriginModeWritesReady,
  type Sub2APIOriginMode,
} from "../domain/provider-settings-model";
import { Button } from "./Common";
import { Sub2APIReadiness } from "./Sub2APIReadiness";

type Connection = ProviderConnectionListResponse["data"][number];

function textModels(value: string): { model_id: string; capabilities: ["TEXT"] }[] | null {
  const ids = value.split(",").map((item) => item.trim());
  if (
    !ids.length ||
    ids.some((id) => !id || id.length > 200) ||
    new Set(ids).size !== ids.length ||
    ids.length > 100
  )
    return null;
  return ids.map((model_id) => ({ model_id, capabilities: ["TEXT"] }));
}

function validOrigin(value: string): boolean {
  if (!/^https:\/\/[^/?#\\]+$/.test(value) || /[\s\\@%]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function Sub2APIConnectionManagement({
  connection,
  onReload,
}: {
  connection: Connection;
  onReload: () => Promise<void>;
}) {
  const transport = useMemo(createStudioTransport, []);
  const connectionMode =
    connection.origin_mode === "LOCAL_LOOPBACK_HTTP" ? "LOCAL_LOOPBACK_HTTP" : "PUBLIC_HTTPS";
  const scope = `${connection.id}/${connection.revision}/${String(connection.origin_mode)}`;
  const activeScope = useRef(scope);
  const metadataInFlight = useRef<string | null>(null);
  activeScope.current = scope;
  const [journal, setJournal] = useState(() => readProviderJournal(connection.id));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Sub2APIOriginMode>(connectionMode);
  const [name, setName] = useState(connection.display_name);
  const [origin, setOrigin] = useState(connection.base_url);
  const [enabled, setEnabled] = useState(connection.enabled);
  const [models, setModels] = useState(connection.models.map((item) => item.model_id).join(", "));
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    activeScope.current = scope;
    setJournal(readProviderJournal(connection.id));
    setMode(connectionMode);
    setName(connection.display_name);
    setOrigin(connection.base_url);
    setEnabled(connection.enabled);
    setModels(connection.models.map((item) => item.model_id).join(", "));
    setApiKey("");
    setBusy(false);
    return () => {
      if (activeScope.current === scope) activeScope.current = "";
    };
  }, [connection.id, connection.revision, connection.origin_mode]);

  const pending = journal.kind === "pending" ? journal.write : null;
  const canWrite =
    journal.kind === "empty" &&
    !busy &&
    metadataInFlight.current !== scope &&
    (connection.origin_mode === "PUBLIC_HTTPS" ||
      (sub2apiOriginModeWritesReady && connection.origin_mode === "LOCAL_LOOPBACK_HTTP"));

  async function readCurrent(): Promise<Connection | null> {
    try {
      const response = await transport.listProviderConnections();
      if (!response.request_id || !Array.isArray(response.data)) return null;
      const matches = response.data.filter((item) => item.id === connection.id);
      const current = matches.length === 1 ? matches[0] : undefined;
      return current?.provider_kind === "SUB2API" ? current : null;
    } catch {
      return null;
    }
  }

  async function reconcileMetadata(write: Extract<ProviderPendingWrite, { kind: "metadata" }>) {
    const current = await readCurrent();
    if (activeScope.current !== scope) return;
    const command = write.command;
    if (
      current &&
      current.revision === command.expected_revision + 1 &&
      current.display_name === command.display_name &&
      current.base_url === command.base_url &&
      (command.origin_mode === undefined
        ? current.origin_mode === undefined || current.origin_mode === "PUBLIC_HTTPS"
        : current.origin_mode === command.origin_mode) &&
      current.enabled === command.enabled &&
      JSON.stringify(current.models) === JSON.stringify(command.models) &&
      clearProviderWrite(write)
    ) {
      setJournal(readProviderJournal(connection.id));
      setNotice(`已从连接列表读回修订 ${current.revision}；元数据编辑完成。`);
      await onReload();
      return;
    }
    setNotice("元数据编辑尚未与权威连接修订及完整内容匹配；保持原意图锁，只可继续读取。");
  }

  async function queryRotation(write: Extract<ProviderPendingWrite, { kind: "rotation" }>) {
    if (!transport.readSub2APIKeyRotation) {
      setNotice("当前桌面版本缺少按原操作 ID 查询的接口；保持写入锁。");
      return;
    }
    const result = await transport
      .readSub2APIKeyRotation(write.connectionId, write.operationId)
      .catch(() => ({ kind: "REMOTE_UNKNOWN" as const }));
    if (activeScope.current !== scope) return;
    if (
      result.kind !== "READ" ||
      result.receipt.data.connection_id !== write.connectionId ||
      result.receipt.data.operation_id !== write.operationId ||
      result.receipt.data.expected_revision !== write.expectedRevision
    ) {
      setNotice("原换钥匙操作未能可靠读回；保持操作 ID 和写入锁，不重新提交。");
      return;
    }
    const operation = result.receipt.data;
    if (operation.status !== "APPLIED" || operation.applied_revision === null) {
      setNotice(
        `原换钥匙操作 ${write.operationId} 状态 ${operation.status}；保持写入锁，不重新提交。`,
      );
      return;
    }
    const current = await readCurrent();
    if (activeScope.current !== scope) return;
    if (
      current?.revision === operation.applied_revision &&
      current.credential_status === "CONFIGURED" &&
      clearProviderWrite(write)
    ) {
      setJournal(readProviderJournal(connection.id));
      setNotice(`原操作已应用；连接修订 ${current.revision} 与凭据状态已读回。`);
      await onReload();
      return;
    }
    setNotice("换钥匙操作显示已应用，但连接修订或凭据状态未匹配；保持写入锁。");
  }

  async function readPending() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      if (pending.kind === "metadata") await reconcileMetadata(pending);
      else await queryRotation(pending);
    } finally {
      if (activeScope.current === scope) setBusy(false);
    }
  }

  async function saveMetadata() {
    if (!canWrite || metadataInFlight.current === scope) return;
    if (mode === "LOCAL_LOOPBACK_HTTP" && !sub2apiOriginModeWritesReady) {
      setNotice(
        isLiteralSub2APILoopbackOrigin(origin.trim())
          ? "本机地址格式已核对；生成合同、桌面桥接与迁移链尚未验收，未发送 PATCH。"
          : "本机地址只接受 http://127.0.0.1:端口 或 http://[::1]:端口，端口须显式填写 1–65535；未发送 PATCH。",
      );
      return;
    }
    if (!transport.editSub2APIMetadata) return;
    const parsedModels = textModels(models);
    const displayName = name.trim();
    const baseUrl = origin.trim();
    if (
      !displayName ||
      displayName.length > 80 ||
      !(mode === "LOCAL_LOOPBACK_HTTP"
        ? isLiteralSub2APILoopbackOrigin(baseUrl)
        : validOrigin(baseUrl)) ||
      !parsedModels
    ) {
      setNotice("请填写 1–80 字符名称、当前模式允许的 origin 和不重复的 TEXT 模型 ID。");
      return;
    }
    metadataInFlight.current = scope;
    setBusy(true);
    try {
      const current = await readCurrent();
      if (activeScope.current !== scope) return;
      if (
        !current ||
        (current.origin_mode !== "PUBLIC_HTTPS" && current.origin_mode !== "LOCAL_LOOPBACK_HTTP") ||
        !Number.isSafeInteger(current.revision) ||
        current.revision < 1
      ) {
        setNotice("写前无法读回权威连接模式与修订；未发送 PATCH。");
        return;
      }
      if (
        current.revision !== connection.revision ||
        current.origin_mode !== connection.origin_mode ||
        current.base_url !== connection.base_url ||
        current.display_name !== connection.display_name ||
        current.enabled !== connection.enabled ||
        JSON.stringify(current.models) !== JSON.stringify(connection.models)
      ) {
        setNotice("连接在编辑期间已变化；未发送 PATCH，请按新模式和修订重新核对。");
        await onReload();
        return;
      }
      const command: Sub2APIMetadataCommand = {
        expected_revision: current.revision,
        display_name: displayName,
        base_url: baseUrl,
        origin_mode: mode,
        enabled,
        models: parsedModels,
      };
      if (
        command.display_name === current.display_name &&
        command.base_url === current.base_url &&
        mode === current.origin_mode &&
        command.enabled === current.enabled &&
        JSON.stringify(command.models) === JSON.stringify(current.models)
      ) {
        setNotice("元数据没有变化；未发送编辑请求。");
        return;
      }
      const write: ProviderPendingWrite = {
        kind: "metadata",
        connectionId: current.id,
        command,
      };
      if (!persistProviderWrite(write)) {
        setJournal(readProviderJournal(current.id));
        setNotice("元数据编辑意图未能持久保存，或已有待核对写入；没有发送 PATCH。");
        return;
      }
      setJournal(readProviderJournal(current.id));
      const result = await transport
        .editSub2APIMetadata(current.id, command)
        .catch(() => ({ kind: "REMOTE_UNKNOWN" as const }));
      if (activeScope.current !== scope) return;
      if (result.kind === "DEFINITE_SERVER_ERROR") {
        if (clearProviderWrite(write)) setJournal(readProviderJournal(current.id));
        setNotice(`编辑被明确拒绝：${result.status} / ${result.code}。请重新读取连接修订。`);
        await onReload();
      } else {
        await reconcileMetadata(write);
      }
    } finally {
      if (metadataInFlight.current === scope) metadataInFlight.current = null;
      if (activeScope.current === scope) setBusy(false);
    }
  }

  async function rotateKey() {
    if (!transport.rotateSub2APIKey || !canWrite || mode !== connectionMode) return;
    if (apiKey.length < 8 || apiKey.length > 8192 || /\s/.test(apiKey)) {
      setNotice("新业务密钥须为 8–8192 字符且不含空白。");
      return;
    }
    const operationId = newRotationOperationId();
    if (!operationId) {
      setNotice("无法生成操作 ID；未提交换钥匙。");
      return;
    }
    const write: ProviderPendingWrite = {
      kind: "rotation",
      connectionId: connection.id,
      expectedRevision: connection.revision,
      operationId,
    };
    if (!persistProviderWrite(write)) {
      setJournal(readProviderJournal(connection.id));
      setNotice("换钥匙操作 ID 未能持久保存，或已有待核对操作；没有发送 POST。");
      return;
    }
    const keyOnce = apiKey;
    setApiKey("");
    setJournal(readProviderJournal(connection.id));
    setBusy(true);
    const result = await transport
      .rotateSub2APIKey(connection.id, {
        expected_revision: connection.revision,
        operation_id: operationId,
        api_key: keyOnce,
      })
      .catch(() => ({ kind: "REMOTE_UNKNOWN" as const }));
    if (activeScope.current !== scope) return;
    setBusy(false);
    if (result.kind === "DEFINITE_SERVER_ERROR") {
      if (clearProviderWrite(write)) setJournal(readProviderJournal(connection.id));
      setNotice(`换钥匙被明确拒绝：${result.status} / ${result.code}；未自动重试。`);
      await onReload();
    } else {
      setNotice(`已提交一次换钥匙，操作 ID ${operationId}；正在按原 ID 只读查询。`);
      await queryRotation(write);
    }
  }

  return (
    <details className="provider-connection-management">
      <summary>管理 Sub2API 连接 · 修订 {connection.revision}</summary>
      {journal.kind === "blocked" && (
        <p role="alert">本地操作记录不可读取；已阻止编辑和换钥匙，请保留原始记录。</p>
      )}
      {connection.origin_mode !== "PUBLIC_HTTPS" &&
        connection.origin_mode !== "LOCAL_LOOPBACK_HTTP" && (
          <p role="alert">
            连接列表未提供可核对的部署模式；已阻止写入，请先核对同版后端和桌面合同。
          </p>
        )}
      {pending && (
        <p role="alert">
          原{pending.kind === "rotation" ? "换钥匙" : "元数据编辑"}操作待核对
          {pending.kind === "rotation"
            ? ` · ${pending.operationId}`
            : ` · 原修订 ${pending.command.expected_revision}`}
          ；禁止再次提交。
        </p>
      )}
      {pending && (
        <Button disabled={busy} onClick={() => void readPending()}>
          只读核对原操作
        </Button>
      )}
      <fieldset disabled={!canWrite}>
        <legend>编辑连接元数据 · CAS</legend>
        <div role="group" aria-label="Sub2API 部署模式">
          <Button
            aria-pressed={mode === "PUBLIC_HTTPS"}
            onClick={() => {
              setMode("PUBLIC_HTTPS");
              setOrigin(connectionMode === "PUBLIC_HTTPS" ? connection.base_url : "");
              setApiKey("");
            }}
          >
            公网 HTTPS
          </Button>
          <Button
            aria-pressed={mode === "LOCAL_LOOPBACK_HTTP"}
            onClick={() => {
              setMode("LOCAL_LOOPBACK_HTTP");
              setOrigin(connectionMode === "LOCAL_LOOPBACK_HTTP" ? connection.base_url : "");
              setApiKey("");
            }}
          >
            本机 loopback{sub2apiOriginModeWritesReady ? "" : " · 候选"}
          </Button>
        </div>
        {mode !== connectionMode && <p>切换部署模式后，旧的抽取批准需重新审批。</p>}
        <label>
          连接名称
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          {mode === "LOCAL_LOOPBACK_HTTP" ? "本机 IP 与显式端口" : "公网 HTTPS origin"}
          <input
            value={origin}
            maxLength={2048}
            onChange={(event) => setOrigin(event.target.value)}
          />
        </label>
        <label>
          TEXT 模型 ID（逗号分隔）
          <input value={models} onChange={(event) => setModels(event.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          启用连接
        </label>
        <Button
          disabled={!canWrite || !transport.editSub2APIMetadata}
          onClick={() => void saveMetadata()}
        >
          {mode === "LOCAL_LOOPBACK_HTTP" && !sub2apiOriginModeWritesReady
            ? "核对本机地址 · 不保存"
            : "保存元数据"}
        </Button>
      </fieldset>
      {mode === "LOCAL_LOOPBACK_HTTP" && (
        <p role="status">
          仅接受 127.0.0.1 或 [::1]
          加显式端口；localhost、私网、路径及重定向目标不可用。权威读回模式：{connectionMode}
          ；本机网关不代表上游 AI 离线。
          {!sub2apiOriginModeWritesReady && "当前版本尚不能保存本机模式。"}
        </p>
      )}
      <fieldset disabled={!transport.rotateSub2APIKey || !canWrite || mode !== connectionMode}>
        <legend>轮换业务密钥</legend>
        <label>
          新密钥
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <Button
          disabled={!transport.rotateSub2APIKey || !canWrite || !apiKey}
          onClick={() => void rotateKey()}
        >
          明确轮换一次
        </Button>
      </fieldset>
      <Sub2APIReadiness
        key={scope}
        connection={connection}
        read={transport.readSub2APIConfiguredReadiness}
        disabled={busy}
      />
      {notice && <p role="status">{notice}</p>}
      {(!transport.editSub2APIMetadata ||
        !transport.rotateSub2APIKey ||
        !transport.readSub2APIKeyRotation ||
        !transport.readSub2APIConfiguredReadiness) && (
        <p role="status">当前桌面版本缺少部分 B31 桥接能力；对应操作不可用。</p>
      )}
    </details>
  );
}
