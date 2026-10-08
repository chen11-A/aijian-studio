import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import {
  cloneStoryboardContent,
  STORYBOARD_PROJECT_ID,
  STORYBOARD_EPISODE_ID,
  emptyStoryboardContent,
  readStoryboardJournal,
  readStoryboard,
  sameStoryboardJson,
  saveStoryboard,
  validStoryboardContent,
} from "./adapters/episodeStoryboard";
import type {
  StoryboardContent,
  StoryboardGateway,
  StoryboardJournal,
  StoryboardVersion,
  StoryboardWriteCommand,
} from "./adapters/episodeStoryboard";

type ReadState = "loading" | "ready" | "empty" | "error";
type NavigationGuard = (guard: (() => boolean) | null) => void;

/** Authoritative episode version with an operation-only pending write recovery journal. */
export function useEpisodeStoryboard(
  projectId: string | null,
  episodeId: string | null,
  setNavigationGuard: NavigationGuard,
) {
  const gateway = useMemo<StoryboardGateway | null>(() => {
    const transport = createStudioTransport();
    return typeof transport.getEpisodeStoryboard === "function" &&
      typeof transport.getEpisodeStoryboardVersion === "function" &&
      typeof transport.createEpisodeStoryboardVersion === "function"
      ? (transport as StoryboardGateway)
      : null;
  }, []);
  const storage = useMemo(() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, []);
  const [version, setVersion] = useState<StoryboardVersion | null>(null);
  const [content, setContent] = useState(() =>
    emptyStoryboardContent(projectId ?? "", episodeId ?? ""),
  );
  const [readState, setReadState] = useState<ReadState>("loading");
  const [journal, setJournal] = useState<StoryboardJournal>({ kind: "EMPTY" });
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const validScope =
    !!projectId &&
    STORYBOARD_PROJECT_ID.test(projectId) &&
    !!episodeId &&
    STORYBOARD_EPISODE_ID.test(episodeId);
  const dirty = !sameStoryboardJson(
    content,
    version?.content ?? emptyStoryboardContent(projectId ?? "", episodeId ?? ""),
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
        setNotice("正在读取或保存分镜，请等待结果后再切换页面、作品或剧集。");
        return false;
      }
      if (!current.dirty) return true;
      const warning =
        current.journal.kind === "PENDING"
          ? "这次保存的结果还待核对，恢复记录已保留。离开此页吗？"
          : "当前分镜有未保存的修改。放弃修改并离开吗？";
      if (!window.confirm(warning)) return false;
      leaveState.current.dirty = false;
      setContent(
        cloneStoryboardContent(
          current.version?.content ?? emptyStoryboardContent(projectId ?? "", episodeId ?? ""),
        ),
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
  }, [projectId, episodeId, setNavigationGuard]);

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
      if (
        !projectId ||
        !STORYBOARD_PROJECT_ID.test(projectId) ||
        !episodeId ||
        !STORYBOARD_EPISODE_ID.test(episodeId) ||
        !gateway ||
        !storage
      ) {
        setReadState("error");
        setNotice(
          !projectId
            ? "请先选择真实作品和剧集。"
            : !gateway
              ? "当前桌面版本未连接分镜接口，请更新并重新打开软件。"
              : "本地恢复记录不可用，暂时不能安全保存。请检查本地存储。",
        );
        return;
      }
      const request = ++epoch.current;
      inFlight.current = true;
      setBusy(true);
      setReadState("loading");
      setNotice("");
      const pending = readStoryboardJournal(storage, projectId, episodeId);
      setJournal(pending);
      const result = await readStoryboard(gateway, projectId, episodeId);
      if (request !== epoch.current) return;
      inFlight.current = false;
      setBusy(false);
      if (result.kind === "FOUND" || result.kind === "EMPTY") {
        const next = result.kind === "FOUND" ? result.version : null;
        setVersion(next);
        setContent(
          cloneStoryboardContent(
            pending.kind === "PENDING"
              ? pending.command.payload.content
              : (next?.content ?? emptyStoryboardContent(projectId, episodeId)),
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
            ? `分镜读取被拒绝（${result.status} / ${result.code}），请重新读取。`
            : "分镜读取结果未知。请检查本地服务后重新读取；现有草稿未被替换。",
        );
      }
    },
    [projectId, episodeId, gateway, storage],
  );

  useEffect(() => {
    void load(true);
    return () => {
      epoch.current += 1;
      inFlight.current = false;
    };
  }, [load]);

  function edit(update: (current: StoryboardContent) => StoryboardContent) {
    if (locked || inFlight.current) return;
    setContent((current) => update(current));
    setNotice("");
  }
  async function save(recover = false) {
    if (!gateway || !storage || !projectId || !episodeId || !validScope || inFlight.current)
      return false;
    if (!recover && (locked || (!dirty && version !== null))) return false;
    const pending = readStoryboardJournal(storage, projectId, episodeId);
    let command: StoryboardWriteCommand;
    if (recover) {
      if (pending.kind !== "PENDING") {
        setJournal(pending);
        setNotice("原提交恢复记录不可用，未发送新版本。");
        return false;
      }
      command = pending.command;
    } else {
      const normalized: StoryboardContent = {
        ...content,
        shots: content.shots.map((shot, index) => ({
          ...shot,
          title: shot.title.trim(),
          ordinal: index + 1,
        })),
      };
      if (!validStoryboardContent(normalized, projectId, episodeId)) {
        setNotice(
          "请填写镜头标题（1 至 240 字）和正整数帧数；帧率为 1 至 120，长文本最多 20000 字。",
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
          change_summary: "人工编辑分集分镜草稿",
        },
      };
    }
    const request = ++epoch.current;
    inFlight.current = true;
    setBusy(true);
    setNotice(recover ? "正在核对原提交并回读保存版本…" : "正在保存并回读版本…");
    const result = await saveStoryboard(gateway, storage, projectId, episodeId, command, recover);
    if (request !== epoch.current) return false;
    inFlight.current = false;
    setBusy(false);
    setJournal(readStoryboardJournal(storage, projectId, episodeId));
    if (result.kind === "SAVED") {
      setVersion(result.version);
      setContent(cloneStoryboardContent(result.version.content));
      setReadState("ready");
      const superseded =
        result.version.head_revision > (command.payload.expected_revision ?? 0) + 1;
      setNeedsReload(superseded);
      setNotice(
        superseded
          ? `原提交 v${result.version.version_number} 已保存并核对；此后另有更新，请重新读取最新版本后继续编辑。`
          : `草稿 v${result.version.version_number} 已保存，并已回读核对。重新打开本集可继续编辑。`,
      );
      return true;
    }
    if (result.kind === "REJECTED") {
      setNeedsReload(result.status === 409 || result.status === 428);
      setNotice(
        result.status === 409 || result.status === 428
          ? "本集分镜已有更新，本次未覆盖。请重新读取最新版本后再编辑；当前修改仍保留在此页。"
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
