import type { MediaProbeScope } from "./adapters/mediaAssetProbe";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Button } from "./Common";
import type { MediaAsset, AssetVersion } from "./adapters/assetLibrary";
import {
  createAudioProbeStore,
  sharedAudioProbeStore,
  type AudioAssetProbeGateway,
} from "./adapters/audioAssetProbe";

export function AudioAssetProbe({
  projectId,
  asset,
  version: providedVersion,
  onSampleRate,
  gateway,
  canProbe,
  disabled = false,
}: {
  projectId: string;
  asset: MediaAsset;
  version?: AssetVersion;
  onSampleRate?(rate: number): void;
  gateway?: AudioAssetProbeGateway;
  canProbe: boolean;
  disabled?: boolean;
}) {
  const version = providedVersion ?? asset.latest_version;
  const scope: MediaProbeScope = {
    projectId,
    assetId: asset.id,
    versionId: version.id,
    sha256: version.sha256,
    byteSize: version.byte_size,
  };
  const store = useMemo(
    () => (gateway ? sharedAudioProbeStore(scope, gateway) : createAudioProbeStore(scope)),
    // The exact immutable selection owns state; late responses stay attached to their original scope.
    [gateway, projectId, asset.id, version.id, version.sha256, version.byte_size],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
  }, [store]);
  const unavailable =
    version.kind !== "audio" ||
    version.availability === "MISSING" ||
    version.availability === "CORRUPT";
  const evidence = state.evidence;
  const audio = evidence?.probe.audio;
  useEffect(() => {
    if (audio && version.kind === "audio") onSampleRate?.(audio.sample_rate_hz);
  }, [audio, version.kind, onSampleRate]);
  return (
    <section className="v2-utility-card" aria-label="所选音频探测" style={{ padding: 12 }}>
      <h3>音频探测 · {version.filename}</h3>
      <p>
        选中第 {version.ordinal} 版 · {version.id}
      </p>
      <p role="status">
        {state.phase === "UNAVAILABLE"
          ? "当前桌面版本缺少音频探测接口。"
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
          探测选中音频版本
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
      {evidence && audio && (
        <div>
          <p>
            源音频：{audio.sample_rate_hz} Hz · {audio.channels} 声道 · {audio.total_samples} 样本
          </p>
          <p>
            编码：{audio.codec_name} · 声道布局：{audio.channel_layout ?? "未声明"} · 容器时长：
            {evidence.probe.container_duration.num}/{evidence.probe.container_duration.den} 秒
          </p>
          <p>
            样本入点按源采样率换算；播放器重采样不改变素材入点身份。
            此记录仅供时间定位，不能证明对白内容、声线授权、混音或正式发布审核通过。
          </p>
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
