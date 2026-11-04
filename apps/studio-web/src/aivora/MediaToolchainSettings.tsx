import { useEffect, useRef } from "react";
import { Button } from "./Common";
import { useMediaToolchain } from "./useMediaToolchain";
import { type MediaToolchainGateway } from "./mediaToolchainContract";

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
      <h2>视频工具</h2>
      <p role="status">
        {media.canProbe ? "视频工具已就绪" : media.message || "视频工具还没准备好"}
      </p>
      {status?.version && <p>版本：{status.version}</p>}
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
      <p>移除只取消配置，不删除工具文件。已有素材和成片都会保留。</p>
    </section>
  );
}
