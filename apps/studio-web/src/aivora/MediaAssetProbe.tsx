import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Button } from "./Common";
import { ASSEMBLY_TIMEBASES } from "./adapters/assemblyEditing";
import type { MediaAsset } from "./adapters/assetLibrary";
import {
  createMediaProbeStore,
  sharedMediaProbeStore,
  type MediaAssetProbeGateway,
  type MediaProbeScope,
} from "./adapters/mediaAssetProbe";

export function MediaAssetProbe({
  projectId,
  asset,
  gateway,
  canProbe,
  disabled = false,
}: {
  projectId: string;
  asset: MediaAsset;
  gateway?: MediaAssetProbeGateway;
  canProbe: boolean;
  disabled?: boolean;
}) {
  const version = asset.latest_version;
  const scope: MediaProbeScope = {
    projectId,
    assetId: asset.id,
    versionId: version.id,
    sha256: version.sha256,
    byteSize: version.byte_size,
  };
  const store = useMemo(
    () => (gateway ? sharedMediaProbeStore(scope, gateway) : createMediaProbeStore(scope)),
    // The exact immutable selection owns state; late responses stay attached to their original scope.
    [gateway, projectId, asset.id, version.id, version.sha256, version.byte_size],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
  }, [store]);
  const unavailable = version.availability === "MISSING" || version.availability === "CORRUPT";
  const evidence = state.evidence;
  const video = evidence?.probe.video;
  const supportedRate =
    video &&
    ASSEMBLY_TIMEBASES.some(
      ({ value }) =>
        value.frame_rate.num === video.average_frame_rate.num &&
        value.frame_rate.den === video.average_frame_rate.den,
    );
  return (
    <section className="v2-utility-card" aria-label="所选视频探测" style={{ padding: 12 }}>
      <h3>视频探测 · {version.filename}</h3>
      <p>
        选中第 {version.ordinal} 版 · {version.id}
      </p>
      <p role="status">
        {state.phase === "UNAVAILABLE"
          ? "当前桌面版本缺少视频探测接口。"
          : state.phase === "LOADING"
            ? "正在读取选中版本的探测记录…"
            : state.notice}
      </p>
      {!canProbe && <p>当前媒体工具未通过校验，不能开始新探测；已保存记录仍可读取。</p>}
      {unavailable && <p role="alert">原件缺失或损坏，请先导入新版本。</p>}
      <div className="assembly-actions">
        <Button
          primary
          disabled={
            disabled ||
            unavailable ||
            !canProbe ||
            state.busy ||
            state.uncertain ||
            state.phase !== "NOT_FOUND"
          }
          onClick={() => {
            if (canProbe && !disabled && !unavailable) void store.probe();
          }}
        >
          探测选中视频版本
        </Button>
        <Button disabled={state.busy || !gateway} onClick={() => void store.refresh()}>
          重新读取此版本探测记录
        </Button>
      </div>
      {state.uncertain && (
        <p role="alert">探测结果不确定，已锁定重复操作；离开或重新打开此页不会清除锁定。</p>
      )}
      {state.uncertain && state.notFound && !state.busy && (
        <details>
          <summary>处理未查到记录的探测</summary>
          <p>旧请求可能仍在处理。请先确认上次探测已经结束，再明确允许重新尝试。</p>
          <Button
            onClick={() => {
              if (
                window.confirm(
                  "当前未查到探测记录，旧请求仍可能在处理。仅在已确认上次探测结束后继续。确认解除此版本的重试锁定吗？",
                )
              )
                store.acknowledgeFinished();
            }}
          >
            确认上次探测已结束，解除锁定
          </Button>
        </details>
      )}
      {evidence && video && (
        <div>
          <p>
            已验证探测：{video.width} × {video.height} · {video.frames.length} 帧 ·{" "}
            {video.average_frame_rate.num}/{video.average_frame_rate.den} fps ·{" "}
            {video.is_variable_frame_rate ? "可变帧率" : "恒定帧率"}
          </p>
          <p>
            容器时长：{evidence.probe.container_duration.num}/
            {evidence.probe.container_duration.den} 秒 ·{" "}
            {evidence.probe.audio
              ? `${evidence.probe.audio.sample_rate_hz} Hz / ${evidence.probe.audio.channels} 声道`
              : "无内嵌音频"}
          </p>
          {video.is_variable_frame_rate ? (
            <p role="alert">当前剪辑管线不支持此可变帧率视频，请使用受支持的恒定帧率版本。</p>
          ) : !supportedRate ? (
            <p role="alert">当前剪辑管线不支持此源帧率，请使用受支持帧率的视频版本。</p>
          ) : (
            <p>
              剪辑时将序列帧率设为 {video.average_frame_rate.num}/{video.average_frame_rate.den}
              ，源入点加片段时长不可超过 {video.frames.length} 帧。
              {!evidence.probe.audio && "此视频必须静音使用。"}
              返回剪辑后重新读取并保存装配，服务会核对此版本的探测记录。
            </p>
          )}
          <details>
            <summary>探测版本与工具证据</summary>
            <p style={{ overflowWrap: "anywhere" }}>素材 SHA-256：{evidence.asset_sha256}</p>
            <p style={{ overflowWrap: "anywhere" }}>
              探测记录：{evidence.id} · {evidence.probe_sha256}
            </p>
            <p>
              {evidence.toolchain_profile_id} · {evidence.toolchain_version} · {evidence.created_at}
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
