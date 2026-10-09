import { useEffect, useRef, useState } from "react";
import { Button } from "./Common";
import {
  parsePreviewStatus,
  previewCommand,
  previewOpenRequestId,
  validPreviewIdentity,
} from "./adapters/mediaPreviewSession";
import type {
  MediaPreviewIdentity,
  MediaPreviewResult,
  MediaPreviewSessionGateway,
  MediaPreviewStatus,
} from "./adapters/mediaPreviewSession";

type Props = {
  projectId: string;
  episodeId: string;
  identity: MediaPreviewIdentity | null;
  totalFrames: number | null;
  gateway: MediaPreviewSessionGateway | undefined;
};

function pendingKey(projectId: string, episodeId: string): string {
  return `aivora:mlt-preview:open:${projectId}:${episodeId}`;
}

function readPending(projectId: string, episodeId: string): string | null | undefined {
  try {
    return window.localStorage.getItem(pendingKey(projectId, episodeId));
  } catch {
    return undefined;
  }
}

function savePending(projectId: string, episodeId: string, value: string): boolean {
  try {
    const key = pendingKey(projectId, episodeId);
    window.localStorage.setItem(key, value);
    return window.localStorage.getItem(key) === value;
  } catch {
    return false;
  }
}

function clearPending(projectId: string, episodeId: string): void {
  try {
    window.localStorage.removeItem(pendingKey(projectId, episodeId));
  } catch {
    /* Keep a future open blocked if the pending ID cannot be removed. */
  }
}

const unavailableCopy: Record<string, string> = {
  NATIVE_HOST_NOT_INSTALLED: "本机未安装经核验的 MLT 预览宿主。",
  PLAN_NOT_READY: "原装配版本的执行计划尚未准备好。",
  TRANSPORT_NOT_READY: "本地 SDL2 预览窗口尚未准备好。",
};

/** MLT frames live in a separate native window; this panel shows only host receipts. */
export function MltPreviewPanel({ projectId, episodeId, identity, totalFrames, gateway }: Props) {
  const scope = JSON.stringify([
    projectId,
    episodeId,
    identity?.assembly_artifact_id,
    identity?.assembly_version_id,
    identity?.assembly_content_hash,
    identity?.assembly_head_revision,
    identity?.plan_hash,
  ]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const epoch = useRef(0);
  const statusRef = useRef<MediaPreviewStatus | null>(null);
  const [status, setStatus] = useState<MediaPreviewStatus | null>(null);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seekFrame, setSeekFrame] = useState(0);
  const [notice, setNotice] = useState("");
  const [unknown, setUnknown] = useState(false);
  const validIdentity =
    !!identity &&
    validPreviewIdentity(identity) &&
    identity.project_id === projectId &&
    identity.episode_id === episodeId;
  const terminal =
    status?.state === "FAILED" || status?.state === "EXPIRED" || status?.state === "CLOSED";
  statusRef.current = status;

  useEffect(() => {
    epoch.current += 1;
    const saved = readPending(projectId, episodeId);
    setStatus(null);
    setBusy(false);
    setOpenRequestId(saved ?? null);
    setUnknown(saved !== null);
    setNotice(
      saved === undefined
        ? "本地会话记录不可用；预览启动已阻止。"
        : saved === null
          ? ""
          : "存在先前预览启动请求；请按原请求 ID 只读查询，不重复打开。",
    );
    return () => {
      epoch.current += 1;
      const prior = statusRef.current;
      if (prior && gateway && prior.state !== "CLOSED" && prior.state !== "EXPIRED") {
        const command = previewCommand(prior);
        if (command) void gateway.closeMediaPreviewSession(command).catch(() => undefined);
      }
    };
  }, [scope, gateway]);

  function accept(
    result: MediaPreviewResult,
    requested: string,
    prior: MediaPreviewStatus | null,
  ): void {
    if (result.kind === "STATUS") {
      const parsed =
        identity && parsePreviewStatus(result.status, identity, requested, prior ?? undefined);
      if (!parsed) {
        setUnknown(true);
        setNotice("预览回执身份、generation 或时钟结构不符；只可查询原请求。");
        return;
      }
      setStatus(parsed);
      setOpenRequestId(requested);
      setUnknown(false);
      if (parsed.state === "CLOSED" || parsed.state === "EXPIRED")
        clearPending(projectId, episodeId);
      setNotice(
        parsed.state === "FAILED"
          ? `原生预览失败：${parsed.failure ?? "HOST_UNKNOWN"}。`
          : `已读回原生预览状态 ${parsed.state}；画面在独立本地窗口。`,
      );
      return;
    }
    if (result.kind === "UNAVAILABLE") {
      setNotice(unavailableCopy[result.reason] ?? "预览宿主不可用。");
      if (!prior) {
        clearPending(projectId, episodeId);
        setOpenRequestId(null);
        setUnknown(false);
      } else setUnknown(true);
      return;
    }
    setUnknown(true);
    setNotice(
      result.kind === "STALE_SESSION"
        ? "预览会话已过期；仅可按原请求 ID 查询，不能对旧 generation 继续控制。"
        : "预览命令结果未知；保留原请求 ID，只读查询，不自动重复命令。",
    );
  }

  async function open() {
    if (
      !gateway ||
      !validIdentity ||
      !identity ||
      busy ||
      status ||
      unknown ||
      readPending(projectId, episodeId) !== null
    )
      return;
    const id = previewOpenRequestId();
    if (!id || !savePending(projectId, episodeId, id)) {
      setUnknown(true);
      setNotice("预览启动意图未能持久保存；未调用原生宿主。");
      return;
    }
    const request = ++epoch.current;
    setOpenRequestId(id);
    setBusy(true);
    const result = await gateway
      .openMediaPreviewSession({ open_request_id: id, identity })
      .catch(() => ({ kind: "UNKNOWN" as const }));
    if (epoch.current !== request || activeScope.current !== scope) return;
    setBusy(false);
    accept(result, id, null);
  }

  async function query() {
    if (!gateway || !validIdentity || !identity || !openRequestId || busy) return;
    const prior = status;
    const request = ++epoch.current;
    setBusy(true);
    const result = await gateway
      .readMediaPreviewSessionStatus(
        prior
          ? { session_id: prior.session_id, generation: prior.generation }
          : { open_request_id: openRequestId },
      )
      .catch(() => ({ kind: "UNKNOWN" as const }));
    if (epoch.current !== request || activeScope.current !== scope) return;
    setBusy(false);
    accept(result, openRequestId, prior);
  }

  async function mutate(kind: "play" | "pause" | "seek" | "close") {
    if (
      !gateway ||
      !validIdentity ||
      !identity ||
      !status ||
      !openRequestId ||
      busy ||
      (kind !== "close" && terminal) ||
      (kind === "close" && ["CLOSED", "EXPIRED"].includes(status.state)) ||
      (kind === "seek" &&
        (totalFrames === null ||
          !Number.isSafeInteger(seekFrame) ||
          seekFrame < 0 ||
          seekFrame >= totalFrames))
    )
      return;
    const command = previewCommand(status);
    if (!command) {
      setNotice("无法生成原生命令 ID；未发送播放控制。");
      return;
    }
    const request = ++epoch.current;
    setBusy(true);
    const result = await (
      kind === "play"
        ? gateway.playMediaPreviewSession(command)
        : kind === "pause"
          ? gateway.pauseMediaPreviewSession(command)
          : kind === "close"
            ? gateway.closeMediaPreviewSession(command)
            : gateway.seekMediaPreviewSession({ ...command, frame_index: seekFrame })
    ).catch(() => ({ kind: "UNKNOWN" as const }));
    if (epoch.current !== request || activeScope.current !== scope) return;
    setBusy(false);
    accept(result, openRequestId, status);
  }

  const clock = status?.clock;
  return (
    <section className="v2-media-card" aria-label="MLT 原生预览会话">
      <h2>MLT 原生预览</h2>
      <p>
        画面由独立 SDL2 本地窗口显示。本页只展示宿主回执与控制状态；不以静帧或预渲 MP4
        冒充实时预览。
      </p>
      {!gateway && <p role="status">预览桌面桥尚未接入。</p>}
      {!validIdentity && <p role="status">未取得精确装配版本与只读执行计划哈希；预览不可启动。</p>}
      {notice && <p role="status">{notice}</p>}
      {openRequestId && (
        <p>
          原启动请求 <code>{openRequestId}</code>
        </p>
      )}
      {status && (
        <>
          <p>
            会话 <code>{status.session_id}</code> · generation {status.generation} · {status.state}
          </p>
          <p>
            最后显示帧：{clock?.shown_frame_index ?? "未核实"} · 音频输出采样：
            {clock?.authority === "NATIVE_AUDIO_OUTPUT" && clock.audio_output_sample_index !== null
              ? `${clock.audio_output_sample_index} / ${clock.audio_sample_rate_hz} Hz`
              : "未核实"}{" "}
            · 时钟权威：{clock?.authority}
          </p>
          <p>
            会话到期：{status.expires_at}。
            {clock?.authority !== "NATIVE_AUDIO_OUTPUT" && "当前没有可核实的音画同步结论。"}
          </p>
        </>
      )}
      <div>
        <Button
          disabled={
            !gateway ||
            !validIdentity ||
            busy ||
            !!status ||
            unknown ||
            readPending(projectId, episodeId) !== null
          }
          onClick={() => void open()}
        >
          打开本地预览
        </Button>
        <Button
          disabled={!gateway || !openRequestId || busy || !validIdentity}
          onClick={() => void query()}
        >
          查询原会话
        </Button>
        <Button
          disabled={
            !status || busy || unknown || !["READY_PAUSED", "PAUSED"].includes(status.state)
          }
          onClick={() => void mutate("play")}
        >
          播放
        </Button>
        <Button
          disabled={!status || busy || terminal || status.state !== "PLAYING" || unknown}
          onClick={() => void mutate("pause")}
        >
          暂停
        </Button>
        <Button
          disabled={!status || busy || unknown || ["CLOSED", "EXPIRED"].includes(status.state)}
          onClick={() => void mutate("close")}
        >
          关闭会话
        </Button>
        <Button
          disabled={
            !status ||
            busy ||
            !["CLOSED", "EXPIRED"].includes(status.state) ||
            readPending(projectId, episodeId) !== null
          }
          onClick={() => {
            setStatus(null);
            setOpenRequestId(null);
            setUnknown(false);
            setNotice("原会话已结束；如仍有精确执行计划，可重新打开新会话。");
          }}
        >
          新会话
        </Button>
      </div>
      <label>
        定位到帧
        <input
          type="number"
          min={0}
          max={Math.max(0, (totalFrames ?? 1) - 1)}
          value={seekFrame}
          disabled={!status || busy || terminal || unknown || totalFrames === null}
          onChange={(event) => setSeekFrame(Number(event.target.value))}
        />
      </label>
      <Button
        disabled={
          !status ||
          busy ||
          terminal ||
          unknown ||
          totalFrames === null ||
          !["READY_PAUSED", "PAUSED", "PLAYING"].includes(status.state) ||
          !Number.isSafeInteger(seekFrame) ||
          seekFrame < 0 ||
          seekFrame >= totalFrames
        }
        onClick={() => void mutate("seek")}
      >
        精确定位
      </Button>
    </section>
  );
}
