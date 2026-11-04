import { useEffect, useRef, useState } from "react";
import { Button } from "./Common";
import type { AssetLibraryGateway, AssetVersion } from "./adapters/assetLibrary";

type PreviewProps = {
  projectId: string;
  assetId: string;
  version: AssetVersion;
  gateway: AssetLibraryGateway | undefined;
};

export function CharacterReferencePreview(props: PreviewProps) {
  const { projectId, assetId, version } = props;
  const scope = [
    projectId,
    assetId,
    version.id,
    version.sha256,
    version.mime_type,
    version.kind,
    version.byte_size,
  ].join(":");
  return <ScopedReferencePreview key={scope} {...props} />;
}

function ScopedReferencePreview({ projectId, assetId, version, gateway }: PreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("尚未读取预览");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const ownedUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      epoch.current += 1;
      if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
      ownedUrl.current = null;
    },
    [],
  );
  function clearPreview() {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = null;
    setUrl(null);
  }
  function decodeError(message: string) {
    if (ownedUrl.current !== url) return;
    clearPreview();
    setStatus(message);
  }
  async function preview() {
    if (!gateway || busy) return;
    const request = ++epoch.current;
    clearPreview();
    setBusy(true);
    setStatus("正在读取精确参考版本…");
    try {
      const result = await gateway.readProjectMediaAssetPreview(projectId, assetId, version.id);
      if (request !== epoch.current) return;
      if (
        result.kind !== "READY" ||
        result.sha256 !== version.sha256 ||
        result.mime_type !== version.mime_type ||
        !(result.bytes instanceof Uint8Array) ||
        result.bytes.byteLength !== version.byte_size
      ) {
        setStatus("预览未通过核对；关联保留，请检查原文件或读取限制。");
        return;
      }
      const blob = new Blob([new Uint8Array(result.bytes).buffer], { type: result.mime_type });
      const next = URL.createObjectURL(blob);
      ownedUrl.current = next;
      setUrl(next);
      setStatus("已读取此精确版本；解码和实际播放仍需核对");
    } catch {
      if (request === epoch.current) setStatus("预览读取结果未知，现有参考保留");
    } finally {
      if (request === epoch.current) setBusy(false);
    }
  }
  return (
    <div>
      <Button disabled={!gateway || busy} onClick={() => void preview()}>
        读取此参考预览
      </Button>
      <p role="status">{status}</p>
      {url &&
        (version.kind === "image" ? (
          <img
            src={url}
            alt={version.filename}
            style={{ maxWidth: "100%", maxHeight: 320 }}
            onError={() => decodeError("参考图片无法解码，请核对原文件")}
          />
        ) : (
          <video
            src={url}
            controls
            preload="metadata"
            style={{ maxWidth: "100%" }}
            onError={() => decodeError("参考视频无法播放，请核对原文件")}
          />
        ))}
    </div>
  );
}
