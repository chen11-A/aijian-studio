import { useEffect, useRef, useState } from "react";
import type { ChatGPTModel } from "@aijian/contracts/chatgpt-auth";
import type {
  OfficialTextBase,
  OfficialTextBridge,
  OfficialTextOperation,
} from "@aijian/contracts/official-text";
import { chatGPTBridge } from "./chatgpt-auth/transport";
import { useOfficialConnection } from "./chatgpt-auth/ChatGPTConnectionContext";
import { verifySelectedModel } from "./chatgpt-auth/verifySelectedModel";

declare global {
  interface Window {
    aijianOfficialText?: OfficialTextBridge;
  }
}
export type OfficialTextPanelProps = {
  projectId: string;
  episodeId: string;
  base: OfficialTextBase | null;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAdopted: () => Promise<void>;
};
export const sameBase = (left: OfficialTextBase | null, right: OfficialTextBase | null) =>
  left === null
    ? right === null
    : right !== null &&
      left.version_id === right.version_id &&
      left.content_hash === right.content_hash &&
      left.head_revision === right.head_revision;

/** Exact saved text is reviewed here; only a persisted adoption receipt can reload the editor. */
export function useOfficialTextProposals({
  projectId,
  episodeId,
  base,
  disabled,
  onBusyChange,
  onAdopted,
}: OfficialTextPanelProps) {
  const account = useOfficialConnection();
  const bridge = window.aijianOfficialText;
  const [operations, setOperations] = useState<OfficialTextOperation[]>([]);
  const [readState, setReadState] = useState<"loading" | "ready" | "error">("loading");
  const [localModels, setLocalModels] = useState<ChatGPTModel[]>([]);
  const [localModel, setLocalModel] = useState("");
  const models = account
    ? account.catalogProfileId
      ? account.connection.models
      : []
    : localModels;
  const resolved = account?.resolve(projectId);
  const model = account ? (resolved?.verified ? resolved.modelSlug : "") : localModel;
  const setModel = (slug: string) => {
    if (account) {
      if (!account.setProjectModel(projectId, slug))
        setNotice("模型选择未保存，请核对当前账号和本机存储。");
    } else setLocalModel(slug);
  };
  const [text, setText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const flight = useRef(false);
  const scopeEpoch = useRef(0);
  const unknown = operations.some((operation) => operation.status === "REMOTE_UNKNOWN");
  const live = useRef({
    projectId,
    episodeId,
    bridge,
    base,
    disabled,
    unknown,
    readState,
    model,
    text,
    instructions,
  });
  live.current = {
    projectId,
    episodeId,
    bridge,
    base,
    disabled,
    unknown,
    readState,
    model,
    text,
    instructions,
  };
  useEffect(() => {
    setLocalModels([]);
    setLocalModel("");
  }, [projectId, episodeId]);
  useEffect(() => {
    let current = true;
    scopeEpoch.current += 1;
    active.current = true;
    if (!bridge) {
      setReadState("error");
      return;
    }
    void bridge
      .list(projectId, episodeId)
      .then((result) => {
        if (!current) return;
        if (result.kind === "OK") {
          setOperations(result.operations);
          setReadState("ready");
        } else setReadState("error");
      })
      .catch(() => {
        if (current) setReadState("error");
      });
    return () => {
      current = false;
      active.current = false;
      scopeEpoch.current += 1;
    };
  }, [bridge, projectId, episodeId]);
  function enter() {
    if (flight.current || disabled) return false;
    flight.current = true;
    setBusy(true);
    onBusyChange(true);
    return true;
  }
  function leave() {
    flight.current = false;
    if (active.current) {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function reload() {
    if (!bridge || !enter()) return;
    try {
      const result = await bridge.list(projectId, episodeId);
      if (!active.current) return;
      if (result.kind === "OK") {
        setOperations(result.operations);
        setReadState("ready");
        setNotice("已只读核对本集建议记录。");
      } else {
        setReadState("error");
        setNotice("建议记录无法核实，未重复生成。");
      }
    } catch {
      if (active.current) setReadState("error");
    } finally {
      leave();
    }
  }
  async function loadModels() {
    if (account) {
      await account.readModels();
      return;
    }
    const auth = chatGPTBridge();
    if (!auth || !enter()) return;
    try {
      const result = await auth.models();
      if (!active.current) return;
      if (result.kind === "OK") {
        setLocalModels(result.models);
        setLocalModel("");
        setNotice(
          result.models.length ? "请选择当前账号实际可用的模型。" : "当前账号没有可用模型。",
        );
      } else setNotice(`无法读取官方模型（${result.code}）。请在连接管理中核对登录与套餐权限。`);
    } catch {
      if (active.current) setNotice("官方模型读取失败，请核对连接。");
    } finally {
      leave();
    }
  }
  async function generate() {
    if (!bridge || !text.trim() || !model || unknown || readState !== "ready" || !enter()) return;
    const ticket = scopeEpoch.current;
    const stillCurrent = () =>
      active.current &&
      ticket === scopeEpoch.current &&
      live.current.projectId === projectId &&
      live.current.episodeId === episodeId &&
      live.current.bridge === bridge &&
      sameBase(live.current.base, base) &&
      !live.current.disabled &&
      !live.current.unknown &&
      live.current.readState === "ready" &&
      live.current.model === model &&
      live.current.text === text &&
      live.current.instructions === instructions;
    try {
      const expectedProfileId = account
        ? await verifySelectedModel(account, projectId, model)
        : null;
      if (!stillCurrent()) return;
      if (!expectedProfileId) {
        setNotice("当前账号或模型目录已变化，未发送。请重新读取模型并核对选择。");
        return;
      }
      const result = await bridge.generate({
        projectId,
        episodeId,
        base,
        operationId: crypto.randomUUID(),
        expectedProfileId,
        model,
        text,
        ...(instructions.trim() ? { instructions } : {}),
      });
      if (!stillCurrent()) return;
      if (result.kind === "OK") {
        setOperations((old) =>
          [
            result.operation,
            ...old.filter(
              (item) => item.request.operation_id !== result.operation.request.operation_id,
            ),
          ].slice(0, 10),
        );
        setNotice(
          result.operation.status === "COMPLETED"
            ? "官方文本已保存。请审阅建议，再决定是否追加到剧本。"
            : "已找到原操作记录；没有再次发送。 ",
        );
      } else if (result.kind === "NOT_SENT") setNotice(`此次请求未发送（${result.code}）。`);
      else {
        setReadState("error");
        setNotice("生成或保存结果尚未确认。请只读核对记录；不要再次生成相同请求。");
      }
    } catch {
      if (stillCurrent()) {
        setReadState("error");
        setNotice("提交结果未知。请只读核对，禁止重复发送。");
      }
    } finally {
      leave();
    }
  }
  async function adopt(operation: OfficialTextOperation) {
    if (
      !bridge ||
      !operation.proposal ||
      operation.adoption ||
      !sameBase(base, operation.request.base) ||
      !enter()
    )
      return;
    try {
      const result = await bridge.adopt(projectId, episodeId, operation.request.operation_id, {
        proposal_version_id: operation.proposal.version_id,
        proposal_content_hash: operation.proposal.content_hash,
        confirm: true,
      });
      if (!active.current) return;
      if (result.kind === "OK" && result.operation.adoption) {
        setOperations((old) =>
          old.map((item) =>
            item.request.operation_id === operation.request.operation_id ? result.operation : item,
          ),
        );
        setNotice("已追加为新的可编辑剧本草稿，仍需人工编排与确认。");
        // Release the editor's operation lock before its verified script reload.
        leave();
        await onAdopted();
        return;
      }
      setNotice(
        result.kind === "ERROR" && result.code === "OFFICIAL_TEXT_SCRIPT_CHANGED"
          ? "剧本基准已变化，未覆盖现有内容。请核对新版本；原建议继续保留。"
          : "采纳结果未能确认。请只读核对记录和剧本，未再次追加。",
      );
      if (result.kind !== "ERROR") setReadState("error");
    } catch {
      if (active.current) {
        setReadState("error");
        setNotice("采纳结果未知，请只读核对。");
      }
    } finally {
      leave();
    }
  }
  return {
    bridge,
    operations,
    readState,
    models,
    model,
    setModel,
    modelSource: resolved?.source ?? "none",
    modelVerified: !!account && !!resolved?.verified,
    restoreDefaultModel: () => account?.restoreProjectDefault(projectId) ?? false,
    preferenceError: account?.preferenceError ?? false,
    text,
    setText,
    instructions,
    setInstructions,
    notice,
    catalogNotice: account?.connection.notice ?? "",
    catalogStatusFailed: account?.connection.statusReadFailed ?? false,
    reloadAccount: () => account?.connection.load(),
    busy,
    unknown,
    reload,
    loadModels,
    generate,
    adopt,
  };
}
