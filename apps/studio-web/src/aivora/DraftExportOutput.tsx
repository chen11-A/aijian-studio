import { useEffect, useRef, useState } from "react";
import { Button } from "./Common";
import { DraftReviewNotes } from "./DraftReviewNotes";
import {
  draftJobMatches,
  type DraftExportGateway,
  type DraftExportJob,
} from "./adapters/draftExport";
import {
  DRAFT_PREVIEW_LIMIT_BYTES,
  DRAFT_PREVIEW_TOO_LARGE,
  draftOutputFailure,
  draftOutputIdentityMatches,
} from "./adapters/draftExportOutput";

type Props = {
  projectId: string;
  episodeId: string;
  job: DraftExportJob;
  gateway: Pick<DraftExportGateway, "preview" | "reveal" | "review"> | undefined;
};
type PreviewState =
  { kind: "idle" | "loading" } | { kind: "ready"; url: string } | { kind: "error"; notice: string };
type RevealState = { kind: "idle" | "loading" } | { kind: "ready" | "error"; notice: string };

/** Remount for an immutable receipt or scope change, even when the operation ID is reused. */
export function DraftExportOutput(props: Props) {
  const { job, projectId, episodeId } = props;
  if (job.status !== "SUCCEEDED" || !draftJobMatches(job, projectId, episodeId)) return null;
  const identityKey = JSON.stringify([
    projectId,
    episodeId,
    job.operation_id,
    job.assembly_version_id,
    job.assembly_content_hash,
    job.output_sha256,
    job.output_bytes,
    job.output_path,
  ]);
  return <VerifiedDraftOutput key={identityKey} {...props} />;
}
function VerifiedDraftOutput({ job, projectId, episodeId, gateway }: Props) {
  const [playbackSeconds, setPlaybackSeconds] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [reveal, setReveal] = useState<RevealState>({ kind: "idle" });
  const lifetime = useRef({
    active: true,
    preview: 0,
    reveal: 0,
    previewBusy: false,
    revealBusy: false,
  });
  const objectUrl = useRef<string | null>(null);
  const releaseUrl = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  useEffect(() => {
    const current = lifetime.current;
    current.active = true;
    setPreview({ kind: "idle" });
    setPlaybackSeconds(null);
    setReveal({ kind: "idle" });
    return () => {
      current.active = false;
      current.preview += 1;
      current.reveal += 1;
      current.previewBusy = false;
      current.revealBusy = false;
      releaseUrl();
    };
  }, [gateway?.preview, gateway?.reveal]);
  const close = () => {
    lifetime.current.preview += 1;
    lifetime.current.previewBusy = false;
    releaseUrl();
    setPreview({ kind: "idle" });
    setPlaybackSeconds(null);
  };
  const readPreview = async () => {
    const current = lifetime.current;
    if (!gateway?.preview || current.previewBusy) return;
    const request = ++current.preview;
    current.previewBusy = true;
    releaseUrl();
    setPreview({ kind: "loading" });
    setPlaybackSeconds(null);
    const valid = () => current.active && request === current.preview;
    try {
      const result = await gateway.preview(projectId, episodeId, job.operation_id);
      if (!valid()) return;
      if (result?.kind !== "READY") {
        setPreview({ kind: "error", notice: draftOutputFailure(result) });
        return;
      }
      if (
        !draftOutputIdentityMatches(result.identity, job) ||
        result.mime_type !== "video/mp4" ||
        !(result.bytes instanceof Uint8Array) ||
        result.bytes.byteLength !== job.output_bytes
      ) {
        setPreview({
          kind: "error",
          notice: "草稿字节、大小或任务身份不符；未创建播放器。请重新读取任务。",
        });
        return;
      }
      if (result.bytes.byteLength > DRAFT_PREVIEW_LIMIT_BYTES) {
        setPreview({ kind: "error", notice: DRAFT_PREVIEW_TOO_LARGE });
        return;
      }
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(result.bytes)], { type: "video/mp4" }),
      );
      objectUrl.current = url;
      setPreview({ kind: "ready", url });
    } catch {
      if (valid()) setPreview({ kind: "error", notice: draftOutputFailure(undefined) });
    } finally {
      if (valid()) current.previewBusy = false;
    }
  };
  const revealOutput = async () => {
    const current = lifetime.current;
    if (!gateway?.reveal || current.revealBusy) return;
    const request = ++current.reveal;
    current.revealBusy = true;
    setReveal({ kind: "loading" });
    const valid = () => current.active && request === current.reveal;
    try {
      const result = await gateway.reveal(projectId, episodeId, job.operation_id);
      if (!valid()) return;
      setReveal(
        result?.kind === "REVEALED"
          ? draftOutputIdentityMatches(result.identity, job)
            ? { kind: "ready", notice: "已请求系统打开已验证草稿所在文件夹。" }
            : {
                kind: "error",
                notice: "打开文件夹返回的任务身份不符，尚未确认成功。请重新读取任务。",
              }
          : { kind: "error", notice: draftOutputFailure(result) },
      );
    } catch {
      if (valid()) setReveal({ kind: "error", notice: draftOutputFailure(undefined) });
    } finally {
      if (valid()) current.revealBusy = false;
    }
  };
  return (
    <section className="draft-export-output" aria-label={`${job.output_filename} 已验证草稿操作`}>
      <div className="assembly-actions">
        <Button
          disabled={!gateway?.preview || preview.kind === "loading"}
          onClick={() => void readPreview()}
        >
          播放已验证草稿
        </Button>
        <Button
          disabled={!gateway?.reveal || reveal.kind === "loading"}
          onClick={() => void revealOutput()}
        >
          打开所在文件夹
        </Button>
        {preview.kind !== "idle" && <Button onClick={close}>关闭草稿预览</Button>}
      </div>
      {!gateway?.preview && <p>当前桌面版本未提供草稿播放，请使用支持此能力的桌面版本。</p>}
      {!gateway?.reveal && <p>当前桌面版本未提供打开所在文件夹，请核对上方保存位置。</p>}
      {preview.kind === "loading" && <p role="status">正在重新核验草稿文件并读取预览…</p>}
      {preview.kind === "error" && <p role="alert">{preview.notice}</p>}
      {preview.kind === "ready" && (
        <>
          <video
            key={preview.url}
            controls
            preload="metadata"
            src={preview.url}
            aria-label="已验证 DRAFT 草稿视频"
            onLoadedMetadata={(event) => setPlaybackSeconds(event.currentTarget.currentTime)}
            onTimeUpdate={(event) => setPlaybackSeconds(event.currentTarget.currentTime)}
            onSeeked={(event) => setPlaybackSeconds(event.currentTarget.currentTime)}
            onError={() => {
              releaseUrl();
              setPlaybackSeconds(null);
              setPreview({
                kind: "error",
                notice: "本地播放器无法解码此草稿。请打开所在文件夹核对，或重新导出。",
              });
            }}
          />
          <p>已读取与任务记录一致的本地 DRAFT 文件。不代表帧精确审片或正式发布批准。</p>
        </>
      )}
      <DraftReviewNotes job={job} gateway={gateway?.review} playbackSeconds={playbackSeconds} />
      {reveal.kind === "loading" && <p role="status">正在核验草稿并请求打开文件夹…</p>}
      {(reveal.kind === "ready" || reveal.kind === "error") && (
        <p role={reveal.kind === "error" ? "alert" : "status"}>{reveal.notice}</p>
      )}
    </section>
  );
}
