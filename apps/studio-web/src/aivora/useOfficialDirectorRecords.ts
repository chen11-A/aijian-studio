import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ChatGPTModel } from "@aijian/contracts/chatgpt-auth";
import type { OfficialDirectorOperation } from "@aijian/contracts/official-director";
import type { ShotPlanPreparation } from "@aijian/contracts/shot-plan";
import { chatGPTBridge } from "./chatgpt-auth/transport";
import { readHumanShotPlanPreparation } from "./adapters/humanShotPlan";
import {
  readDirectorJournal,
  type DirectorJournal,
  type DirectorStorage,
} from "./adapters/officialDirectorJournal";
import { directorOperationInScope } from "./adapters/officialDirectorProposal";
import type { OfficialDirectorPanelProps } from "./useOfficialDirectorProposals";
import { useOfficialConnection } from "./chatgpt-auth/ChatGPTConnectionContext";

/** Shared epoch and flight fence protect reads, writes and changing episode scopes. */
export function useOfficialDirectorRecords({
  props,
  storage,
  epoch,
  flight,
  setBusy,
  setJournal,
}: {
  props: OfficialDirectorPanelProps;
  storage: DirectorStorage | null;
  epoch: { current: number };
  flight: { current: boolean };
  setBusy: Dispatch<SetStateAction<boolean>>;
  setJournal: Dispatch<SetStateAction<DirectorJournal>>;
}) {
  const { projectId, episodeId, bridge, preparationGateway } = props;
  const account = useOfficialConnection();
  const [preparation, setPreparation] = useState<ShotPlanPreparation | null>(null);
  const [operations, setOperations] = useState<OfficialDirectorOperation[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [readState, setReadState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
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
        setNotice("模型选择未保存，请在 AI 服务页核对账号目录与本机存储。");
    } else setLocalModel(slug);
  };
  const leave = (ticket: number) => {
    if (ticket !== epoch.current) return;
    flight.current = false;
    setBusy(false);
  };
  const reload = useCallback(async () => {
    if (flight.current) return;
    const ticket = epoch.current;
    if (!bridge || !preparationGateway) {
      setReadState("error");
      setNotice("当前桌面版本未连接 AI 导演接口。请使用支持此接口的桌面版。");
      return;
    }
    flight.current = true;
    setBusy(true);
    try {
      const [inputs, saved] = await Promise.all([
        readHumanShotPlanPreparation(preparationGateway, projectId, episodeId),
        bridge.list(projectId, episodeId),
      ]);
      if (ticket !== epoch.current) return;
      setJournal(readDirectorJournal(storage, projectId, episodeId));
      setPreparation(inputs.kind === "PREPARED" ? inputs.preparation : null);
      const valid =
        saved.kind === "OK" &&
        saved.operations.every((op) => directorOperationInScope(op, projectId, episodeId));
      if (saved.kind === "OK" && valid) {
        setOperations(saved.operations);
        setHasMore(saved.hasMore);
      }
      setReadState(valid ? "ready" : "error");
      setNotice(
        !valid
          ? "操作记录无法核实，已暂停新生成和采纳。请只读核对。"
          : inputs.kind !== "PREPARED"
            ? "当前输入尚未核实。请先保存并明确确认剧本及制作意图，再重新读取。"
            : !storage
              ? "本地恢复存储不可用，已暂停提交。"
              : "",
      );
    } catch {
      if (ticket === epoch.current) {
        setReadState("error");
        setNotice("操作记录读取失败，未重复生成。请只读核对。");
      }
    } finally {
      leave(ticket);
    }
  }, [bridge, preparationGateway, storage, projectId, episodeId]);
  useEffect(() => {
    epoch.current += 1;
    flight.current = false;
    setBusy(false);
    setOperations([]);
    setHasMore(false);
    setPreparation(null);
    setReadState("loading");
    setLocalModels([]);
    setLocalModel("");
    setJournal(readDirectorJournal(storage, projectId, episodeId));
    void reload();
    return () => {
      epoch.current += 1;
      flight.current = false;
    };
  }, [projectId, episodeId, bridge, preparationGateway, storage, reload]);
  useEffect(() => {
    const refresh = () => setJournal(readDirectorJournal(storage, projectId, episodeId));
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [storage, projectId, episodeId, setJournal]);
  async function loadModels() {
    if (account) {
      await account.readModels();
      return;
    }
    const auth = chatGPTBridge();
    if (!auth) {
      setNotice("官方模型接口不可用。请使用支持连接管理的桌面版，未开始登录或推理。");
      return;
    }
    if (!bridge || flight.current) return;
    flight.current = true;
    setBusy(true);
    const ticket = epoch.current;
    try {
      const result = await auth.models();
      if (ticket !== epoch.current) return;
      setLocalModels(result.kind === "OK" ? result.models : []);
      setLocalModel("");
      setNotice(
        result.kind === "OK"
          ? result.models.length
            ? "已读取当前账号实际可用模型。"
            : "当前账号没有可用模型。"
          : `官方模型不可读取（${result.code}）。请在连接管理核对账号与套餐授权。`,
      );
    } catch {
      if (ticket === epoch.current) setNotice("官方模型读取失败，请核对连接管理。");
    } finally {
      leave(ticket);
    }
  }
  return {
    preparation,
    setPreparation,
    operations,
    hasMore,
    setOperations,
    readState,
    notice,
    catalogNotice: account?.connection.notice ?? "",
    catalogStatusFailed: account?.connection.statusReadFailed ?? false,
    reloadAccount: () => account?.connection.load(),
    setNotice,
    models,
    model,
    setModel,
    modelSource: resolved?.source ?? "none",
    modelVerified: !!account && !!resolved?.verified,
    restoreDefaultModel: () => account?.restoreProjectDefault(projectId) ?? false,
    preferenceError: account?.preferenceError ?? false,
    reload,
    loadModels,
  };
}
