import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import {
  cloneCreativeContent,
  CREATIVE_PROJECT_ID,
  emptyCreativeContent,
  readCreativeJournal,
  readCreativeLibrary,
  sameCreativeJson,
  saveCreativeLibrary,
  validCreativeContent,
} from "./adapters/creativeLibrary";
import type {
  CreativeContent,
  CreativeGateway,
  CreativeJournal,
  CreativeVersion,
  CreativeWriteCommand,
} from "./adapters/creativeLibrary";

type ReadState = "loading" | "ready" | "empty" | "error";
type NavigationGuard = (guard: (() => boolean) | null) => void;

/** All three editors share the project's authoritative version, never an episode's demo state. */
export function useCreativeLibrary(projectId: string | null, setNavigationGuard: NavigationGuard) {
  const gateway = useMemo<CreativeGateway | null>(() => {
    const transport = createStudioTransport();
    return typeof transport.getProjectCreativeLibrary === "function" &&
      typeof transport.getProjectCreativeLibraryVersion === "function" &&
      typeof transport.createProjectCreativeLibraryVersion === "function"
      ? (transport as CreativeGateway)
      : null;
  }, []);
  const storage = useMemo(() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, []);
  const [version, setVersion] = useState<CreativeVersion | null>(null);
  const [content, setContent] = useState(() => emptyCreativeContent(projectId ?? ""));
  const [readState, setReadState] = useState<ReadState>("loading");
  const [journal, setJournal] = useState<CreativeJournal>({ kind: "EMPTY" });
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const validScope = !!projectId && CREATIVE_PROJECT_ID.test(projectId);
  const dirty = !sameCreativeJson(
    content,
    version?.content ?? emptyCreativeContent(projectId ?? ""),
  );
  const locked =
    busy ||
    !validScope ||
    !gateway ||
    !storage ||
    readState === "loading" ||
    readState === "error" ||
    needsReload ||
    journal.kind !== "EMPTY";
  const leaveState = useRef({ dirty, busy, version, journal });
  leaveState.current = { dirty, busy, version, journal };

  useEffect(() => {
    setNavigationGuard(() => {
      const current = leaveState.current;
      if (current.busy || inFlight.current) {
        setNotice("正在读取或保存设定，请等待结果后再切换页面、作品或剧集。");
        return false;
      }
      if (!current.dirty) return true;
      const warning =
        current.journal.kind === "PENDING"
          ? "这次保存的结果还待核对，恢复记录已保留。离开此页吗？"
          : "当前设定有未保存的修改。放弃修改并离开吗？";
      if (!window.confirm(warning)) return false;
      leaveState.current.dirty = false;
      setContent(
        cloneCreativeContent(current.version?.content ?? emptyCreativeContent(projectId ?? "")),
      );
      return true;
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaveState.current.dirty && !leaveState.current.busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [projectId, setNavigationGuard]);

  const load = useCallback(
    async (initial = false) => {
      if (inFlight.current) return;
      if (
        !initial &&
        leaveState.current.dirty &&
        leaveState.current.journal.kind === "EMPTY" &&
        !window.confirm("重新读取会放弃当前未保存的修改。继续吗？")
      )
        return;
      if (!projectId || !CREATIVE_PROJECT_ID.test(projectId) || !gateway || !storage) {
        setReadState("error");
        setNotice(
          !projectId
            ? "请先选择一个真实作品。"
            : !gateway
              ? "当前桌面版本未连接创作设定接口，请更新并重新打开软件。"
              : "本地恢复记录不可用，暂时不能安全保存。请检查本地存储。",
        );
        return;
      }
      const request = ++epoch.current;
      inFlight.current = true;
      setBusy(true);
      setReadState("loading");
      setNotice("");
      const pending = readCreativeJournal(storage, projectId);
      setJournal(pending);
      const result = await readCreativeLibrary(gateway, projectId);
      if (request !== epoch.current) return;
      inFlight.current = false;
      setBusy(false);
      if (result.kind === "FOUND" || result.kind === "EMPTY") {
        const next = result.kind === "FOUND" ? result.version : null;
        setVersion(next);
        setContent(
          cloneCreativeContent(
            pending.kind === "PENDING"
              ? pending.command.payload.content
              : (next?.content ?? emptyCreativeContent(projectId)),
          ),
        );
        setReadState(next ? "ready" : "empty");
        setNeedsReload(false);
        if (pending.kind === "PENDING")
          setNotice("有一笔保存结果待核对。已恢复原提交内容，请核对原提交后继续编辑。");
        if (pending.kind === "BLOCKED")
          setNotice("本地恢复记录无法读取，已暂停保存以避免重复提交。请保留本地数据并检查存储。");
      } else {
        setReadState("error");
        setNotice(
          result.kind === "REJECTED"
            ? `设定读取被拒绝（${result.status} / ${result.code}），请重新读取。`
            : "设定读取结果未知。请检查本地服务后重新读取；现有草稿未被替换。",
        );
      }
    },
    [projectId, gateway, storage],
  );

  useEffect(() => {
    void load(true);
    return () => {
      epoch.current += 1;
      inFlight.current = false;
    };
  }, [load]);

  function edit(update: (current: CreativeContent) => CreativeContent) {
    if (locked || inFlight.current) return;
    setContent((current) => update(current));
    setNotice("");
  }
  async function save(recover = false) {
    if (!gateway || !storage || !projectId || !validScope || inFlight.current) return false;
    if (!recover && (locked || !dirty)) return false;
    const pending = readCreativeJournal(storage, projectId);
    let command: CreativeWriteCommand;
    if (recover) {
      if (pending.kind !== "PENDING") {
        setJournal(pending);
        setNotice("原提交恢复记录不可用，未发送新版本。");
        return false;
      }
      command = pending.command;
    } else {
      const normalized: CreativeContent = {
        ...content,
        characters: content.characters.map((item, index) => ({
          ...item,
          name: item.name.trim(),
          ordinal: index + 1,
        })),
        scenes: content.scenes.map((item, index) => ({
          ...item,
          name: item.name.trim(),
          ordinal: index + 1,
        })),
      };
      if (!validCreativeContent(normalized, projectId)) {
        setNotice(
          "请填写每个角色和场景的名称（1 至 120 字）；短字段最多 240 字，长文本最多 20000 字。",
        );
        return false;
      }
      let operationId: string;
      try {
        operationId = crypto.randomUUID();
      } catch {
        setNotice("无法生成可靠的保存标识，未发送。请重新打开桌面软件。");
        return false;
      }
      command = {
        operation_id: operationId,
        payload: {
          content: normalized,
          parent_version_id: version?.version_id ?? null,
          expected_revision: version?.head_revision ?? null,
          change_summary: "人工编辑作品共享角色、世界与场景草稿",
        },
      };
    }
    const request = ++epoch.current;
    inFlight.current = true;
    setBusy(true);
    setNotice(recover ? "正在核对原提交并回读保存版本…" : "正在保存并回读版本…");
    const result = await saveCreativeLibrary(gateway, storage, projectId, command, recover);
    if (request !== epoch.current) return false;
    inFlight.current = false;
    setBusy(false);
    setJournal(readCreativeJournal(storage, projectId));
    if (result.kind === "SAVED") {
      setVersion(result.version);
      setContent(cloneCreativeContent(result.version.content));
      setReadState("ready");
      const superseded =
        result.version.head_revision > (command.payload.expected_revision ?? 0) + 1;
      setNeedsReload(superseded);
      setNotice(
        superseded
          ? `原提交 v${result.version.version_number} 已保存并核对；此后另有更新，请重新读取最新版本后继续编辑。`
          : `草稿 v${result.version.version_number} 已保存，并已回读核对。此设定在本作品各集共享。`,
      );
      return true;
    }
    if (result.kind === "REJECTED") {
      setNeedsReload(result.status === 409 || result.status === 428);
      setNotice(
        result.status === 409 || result.status === 428
          ? "作品设定已有更新，本次未覆盖。请重新读取最新版本后再编辑；当前修改仍保留在此页。"
          : `保存被拒绝（${result.status} / ${result.code}）。修改仍保留，请检查后重试。`,
      );
    } else if (result.kind === "BLOCKED") setNotice(result.message);
    else setNotice("保存结果待核对。请使用“核对原提交”，它会使用原保存标识，不会重复创建版本。");
    return false;
  }
  return {
    content,
    version,
    readState,
    journal,
    dirty,
    busy,
    locked,
    notice,
    edit,
    save,
    reload: () => load(),
    setNotice,
    canRecover: journal.kind === "PENDING" && !busy && !!gateway && !!storage,
  };
}
