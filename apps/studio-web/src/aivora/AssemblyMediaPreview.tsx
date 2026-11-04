import { useEffect, useRef, useState } from "react";
import type { AssetLibraryGateway, AssetVersion } from "./adapters/assetLibrary";
import type { AssemblyMediaRef } from "./adapters/episodeMediaAssembly";
import { wavSampleRate } from "./adapters/assemblyEditing";

type Props = {
  compactNotice?: boolean;
  projectId: string;
  media: AssemblyMediaRef;
  version: AssetVersion | undefined;
  gateway: AssetLibraryGateway | undefined;
  onSampleRate(rate: number): void;
};
/** One verified local original, independently decoded by the desktop's media element. */
export function AssemblyMediaPreview(props: Props) {
  const { projectId, media, version } = props;
  const scope = JSON.stringify([
    projectId,
    media,
    version?.id,
    version?.sha256,
    version?.kind,
    version?.mime_type,
    version?.byte_size,
    version?.availability,
    version?.rights_status,
  ]);
  return <ScopedAssemblyMediaPreview key={scope} {...props} />;
}
function ScopedAssemblyMediaPreview({
  projectId,
  media,
  version,
  gateway,
  onSampleRate,
  compactNotice,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const ownedUrl = useRef<string | null>(null);
  const [notice, setNotice] = useState("正在读取所选原素材…");
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setUrl(null);
    setNotice("正在读取所选原素材…");
    if (version && version.byte_size > 32 * 1024 * 1024) {
      setNotice("原件超过 32 MiB 内嵌预览上限。仍可编辑和保存引用；当前桌面尚无大文件流式预览。");
      return;
    }
    if (
      !gateway ||
      !version ||
      version.id !== media.asset_version_id ||
      version.sha256 !== media.sha256 ||
      version.availability !== "VERIFIED" ||
      version.rights_status === "RESTRICTED"
    ) {
      setNotice("原素材缺失、未验证或受限，无法预览。");
      return;
    }
    void (async () => {
      try {
        const result = await gateway.readProjectMediaAssetPreview(
          projectId,
          media.asset_id,
          media.asset_version_id,
        );
        if (!active) return;
        if (result.kind !== "READY") {
          setNotice(
            result.kind === "DEFINITE_SERVER_ERROR"
              ? `预览被拒绝：${result.code}`
              : "原素材读取结果未知，请重新选择或刷新。",
          );
          return;
        }
        if (
          !(result.bytes instanceof Uint8Array) ||
          result.bytes.byteLength !== version.byte_size ||
          result.sha256 !== media.sha256 ||
          result.mime_type !== version.mime_type
        ) {
          setNotice("原素材字节、大小或哈希身份不符；未播放。");
          return;
        }
        const sampleRate =
          version.kind === "audio" && version.mime_type === "audio/wav"
            ? wavSampleRate(result.bytes)
            : undefined;
        if (sampleRate) onSampleRate(sampleRate);
        objectUrl = URL.createObjectURL(
          new Blob([new Uint8Array(result.bytes)], { type: result.mime_type }),
        );
        ownedUrl.current = objectUrl;
        setUrl(objectUrl);
        setNotice(
          "已读取核验原素材。此播放器独立播放完整原件，不应用序列裁剪、字幕或混音；不代表帧精确审片通过。",
        );
      } catch {
        if (active) setNotice("原素材预览不可用，请刷新后重试。");
      }
    })();
    return () => {
      active = false;
      if (objectUrl && ownedUrl.current === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        ownedUrl.current = null;
      }
    };
  }, [
    projectId,
    media.asset_id,
    media.asset_version_id,
    media.sha256,
    version,
    gateway,
    onSampleRate,
  ]);
  const failed = () => {
    if (ownedUrl.current !== url) return;
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = null;
    setUrl(null);
    setNotice("桌面解码器无法播放此原件格式，或文件内容损坏。剪辑引用仍保留；没有生成替代预览。");
  };
  return (
    <section className="assembly-preview" aria-label="所选原素材预览">
      <h3 title={version?.filename ?? media.asset_version_id}>
        {compactNotice && url ? "已核验原件" : "所选原素材"} ·{" "}
        {version?.filename ?? media.asset_version_id}
      </h3>
      {url && version?.kind === "image" && (
        <img src={url} alt={version.filename} onError={failed} />
      )}
      {url && version?.kind === "video" && (
        <video
          key={url}
          controls
          preload="metadata"
          src={url}
          aria-label="所选视频原件"
          onError={failed}
        />
      )}
      {url && version?.kind === "audio" && (
        <audio
          key={url}
          controls
          preload="metadata"
          src={url}
          aria-label="所选音频原件"
          onError={failed}
        />
      )}
      {compactNotice && !url && (
        <p className="assembly-monitor-boundary">原件监看 · 裁剪、字幕、混音未应用</p>
      )}
      {compactNotice && url ? (
        <details className="assembly-original-status">
          <summary>原件监看 · 裁剪、字幕、混音未应用</summary>
          <p role="status">{notice}</p>
        </details>
      ) : (
        <p role="status">{notice}</p>
      )}
    </section>
  );
}
