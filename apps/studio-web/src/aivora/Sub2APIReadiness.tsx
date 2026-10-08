import { useEffect, useRef, useState } from "react";
import type { ProviderConnectionListResponse, Sub2APIReadinessResult } from "../api/studio";
import { Button } from "./Common";

type Connection = ProviderConnectionListResponse["data"][number];
type Reader = (connectionId: string, modelId: string) => Promise<Sub2APIReadinessResult>;
const reasonLabels: Record<string, string> = {
  NOT_SUB2API: "此连接不是 Sub2API",
  CONNECTION_DISABLED: "连接已停用，请启用并保存",
  ORIGIN_INVALID: "已保存地址或本机路由不符合安全要求",
  TEXT_MODEL_NOT_CONFIGURED: "请登记本次使用的 TEXT 模型",
  CREDENTIAL_MISSING: "尚未保存业务密钥",
  CREDENTIAL_UNAVAILABLE: "系统凭据库不可用",
  RUNTIME_UNAVAILABLE: "本地 AI 任务执行器尚未就绪，请重启桌面并重新核对",
};

export function Sub2APIReadiness({
  connection,
  read,
  disabled = false,
}: {
  connection: Connection;
  read?: Reader;
  disabled?: boolean;
}) {
  const [modelId, setModelId] = useState(connection.models[0]?.model_id ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const inFlight = useRef(false);
  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [],
  );
  const knownMode =
    connection.origin_mode === "PUBLIC_HTTPS" || connection.origin_mode === "LOCAL_LOOPBACK_HTTP";

  async function readCurrent() {
    if (!read || !modelId || disabled || inFlight.current || !knownMode) return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    const request = ++epoch.current;
    const result = await read(connection.id, modelId).catch(() => ({
      kind: "READINESS_UNKNOWN" as const,
    }));
    if (epoch.current !== request) return;
    inFlight.current = false;
    setBusy(false);
    if (result.kind !== "READ") {
      setNotice(
        result.kind === "DEFINITE_SERVER_ERROR"
          ? `本地配置读取被拒绝（${result.status} / ${result.code}）；请重新读取连接。`
          : "本地配置结果尚无法核实，请重试读取；没有发送模型请求。",
      );
      return;
    }
    const data = result.receipt.data;
    if (
      data.connection_id !== connection.id ||
      data.connection_revision !== connection.revision ||
      data.origin_mode !== connection.origin_mode ||
      data.model_id !== modelId ||
      data.provider_observation !== "NOT_CHECKED" ||
      data.model_entitlement !== "UNKNOWN"
    ) {
      setNotice("读取结果与已保存的连接模式、修订或模型不一致，请刷新连接后重新核对。");
      return;
    }
    setNotice(
      data.local_preconditions_met
        ? "本地配置条件已满足。尚未连接供应商验证，模型权限和真实调用结果仍待单独确认。"
        : `本地配置尚未就绪：${data.reasons.map((reason) => reasonLabels[reason] ?? reason).join("；")}。`,
    );
  }

  return (
    <fieldset disabled={!read || disabled || busy || !knownMode}>
      <legend>检查已保存的本地配置</legend>
      <p>检查地址格式、凭据状态和本地执行器，不发送文本或调用模型。</p>
      <p>
        已保存模式：
        {connection.origin_mode === "LOCAL_LOOPBACK_HTTP" ? "本机 loopback" : "公网 HTTPS"} · 修订{" "}
        {connection.revision}
      </p>
      <label>
        核对 TEXT 模型
        <select
          value={modelId}
          onChange={(event) => {
            setModelId(event.target.value);
            setNotice("");
          }}
        >
          {connection.models
            .filter((model) => model.capabilities.length === 1 && model.capabilities[0] === "TEXT")
            .map((model) => (
              <option key={model.model_id} value={model.model_id}>
                {model.model_id}
              </option>
            ))}
        </select>
      </label>
      <Button
        disabled={!read || disabled || !modelId || busy || !knownMode}
        onClick={() => void readCurrent()}
      >
        {busy ? "正在读取本地配置…" : "只读核对本地配置"}
      </Button>
      {notice && <p role="status">{notice}</p>}
    </fieldset>
  );
}
