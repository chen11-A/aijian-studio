import { useEffect, useRef } from "react";
import { Button } from "./Common";
import { useMediaToolchain } from "./useMediaToolchain";
import { MEDIA_TOOLCHAIN_SOURCE_LABELS } from "./adapters/mediaToolchain";
import {
  EXTERNAL_MEDIA_HASHES,
  EXTERNAL_MEDIA_PROFILE,
  type MediaToolchainGateway,
} from "./mediaToolchainContract";

export function MediaToolchainSettings({ gateway }: { gateway?: MediaToolchainGateway }) {
  const media = useMediaToolchain(gateway);
  const status = media.status;
  const owner = useRef(Symbol("media-settings-card"));
  const cancelSelection = media.cancelSelection;
  useEffect(() => {
    const selectionOwner = owner.current;
    return () => {
      void cancelSelection(selectionOwner);
    };
  }, [cancelSelection]);
  return (
    <section className="v2-utility-card" aria-label="本地媒体工具设置" style={{ padding: 16 }}>
      <h2>本地媒体工具 · DRAFT</h2>
      <p role="status">{media.message}</p>
      <p>
        手动选择已下载工具的 bin
        文件夹。本软件不下载或安装工具；使用前会在本机核对固定版本及文件校验值。
      </p>
      <p>
        支持 Windows x86_64 · Gyan FFmpeg Full 8.1.2。外部工具仅用于探测、连续预览和草稿
        MP4，不代表正式发布批准。
      </p>
      {status && (
        <>
          <p>
            来源：
            {MEDIA_TOOLCHAIN_SOURCE_LABELS[status.source]}
          </p>
          {status.directory && <p style={{ overflowWrap: "anywhere" }}>目录：{status.directory}</p>}
          {status.version && <p>版本：{status.version}</p>}
          {status.profile_id && (
            <p style={{ overflowWrap: "anywhere" }}>配置：{status.profile_id}</p>
          )}
          <p>
            探测：{media.canProbe ? "可用" : "不可用"} · 连续预览：
            {media.canPreview ? "可用" : "不可用"} · 草稿导出：
            {media.canDraftExport ? "可用" : "不可用"}
          </p>
          <p style={{ overflowWrap: "anywhere" }}>{status.diagnostic}</p>
        </>
      )}
      {media.notice && <p role="status">{media.notice}</p>}
      <div className="assembly-actions">
        <Button
          primary
          disabled={media.busy || media.phase !== "READY" || status?.state === "UNSUPPORTED"}
          onClick={() => void media.select(owner.current)}
        >
          选择媒体工具文件夹
        </Button>
        <Button
          disabled={media.busy || media.phase !== "READY" || status?.source !== "EXTERNAL"}
          onClick={() => void media.clear()}
        >
          移除外部工具配置
        </Button>
        <Button
          disabled={media.busy || media.phase === "UNAVAILABLE"}
          onClick={() => void media.refresh()}
        >
          重新读取媒体工具状态
        </Button>
      </div>
      <p>移除只取消配置，不删除工具文件。已有素材、草稿记录和已验证输出保留。</p>
      <details>
        <summary>受支持工具校验值</summary>
        <p style={{ overflowWrap: "anywhere" }}>{EXTERNAL_MEDIA_PROFILE}</p>
        <p style={{ overflowWrap: "anywhere" }}>FFmpeg SHA-256：{EXTERNAL_MEDIA_HASHES.ffmpeg}</p>
        <p style={{ overflowWrap: "anywhere" }}>FFprobe SHA-256：{EXTERNAL_MEDIA_HASHES.ffprobe}</p>
      </details>
    </section>
  );
}
