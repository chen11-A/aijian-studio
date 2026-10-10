import { useEffect, useRef, useState } from "react";
import { Button } from "./Common";
import type { DraftReviewTarget } from "./adapters/draftReview";
import {
  revisionSourceMatches,
  type DraftReviewRevisionExportGateway,
} from "./adapters/draftReviewRevision";
import {
  DRAFT_PREVIEW_LIMIT_BYTES,
  DRAFT_PREVIEW_TOO_LARGE,
  draftOutputFailure,
  draftOutputIdentityMatches,
} from "./adapters/draftExportOutput";

type Props = {
  target: DraftReviewTarget;
  exports?: DraftReviewRevisionExportGateway;
  label: string;
  verified: boolean;
};
/** Uses existing verified-output facilities, with no paths or recursive review editor. */
export function DraftReviewRevisionPlayback({ target, exports, label, verified }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef({ active: true, busy: false, ticket: 0, url: null as string | null });
  const key = `${target.operation_id}:${target.assembly_version_id}:${target.assembly_content_hash}:${target.output_sha256}:${target.output_bytes}:${verified}`;
  const close = () => {
    const state = live.current;
    state.ticket++;
    state.busy = false;
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = null;
    setUrl(null);
    setBusy(false);
  };
  useEffect(() => {
    const state = live.current;
    state.active = true;
    close();
    setNotice("");
    return () => {
      state.active = false;
      state.ticket++;
      state.busy = false;
      if (state.url) URL.revokeObjectURL(state.url);
      state.url = null;
    };
  }, [key, exports]);
  const open = async (kind: "preview" | "reveal") => {
    const state = live.current;
    if (
      !verified ||
      !exports ||
      state.busy ||
      (kind === "preview" ? !exports.preview : !exports.reveal)
    )
      return;
    const ticket = ++state.ticket;
    const valid = () => state.active && ticket === state.ticket;
    state.busy = true;
    if (kind === "preview" && state.url) {
      URL.revokeObjectURL(state.url);
      state.url = null;
      setUrl(null);
    }
    setBusy(true);
    setNotice("");
    try {
      const receipt = await exports.get(target.project_id, target.episode_id, target.operation_id);
      if (!valid()) return;
      if (
        receipt.kind !== "FOUND" ||
        receipt.receipt.data.status !== "SUCCEEDED" ||
        !revisionSourceMatches(target, receipt.receipt.data)
      ) {
        setNotice("草稿任务与此精确文件证据不符，未打开。请重新读取记录。");
        return;
      }
      const job = receipt.receipt.data;
      const result =
        kind === "preview"
          ? await exports.preview!(target.project_id, target.episode_id, target.operation_id)
          : await exports.reveal!(target.project_id, target.episode_id, target.operation_id);
      if (!valid()) return;
      if (
        result.kind === "REVEALED" &&
        kind === "reveal" &&
        draftOutputIdentityMatches(result.identity, job)
      ) {
        setNotice("已请求系统打开此精确草稿所在文件夹。");
        return;
      }
      if (
        result.kind !== "READY" ||
        kind !== "preview" ||
        !draftOutputIdentityMatches(result.identity, job) ||
        result.mime_type !== "video/mp4" ||
        !(result.bytes instanceof Uint8Array) ||
        result.bytes.byteLength !== target.output_bytes
      ) {
        setNotice(draftOutputFailure(result));
        return;
      }
      if (result.bytes.byteLength > DRAFT_PREVIEW_LIMIT_BYTES) {
        setNotice(DRAFT_PREVIEW_TOO_LARGE);
        return;
      }
      if (state.url) URL.revokeObjectURL(state.url);
      state.url = URL.createObjectURL(
        new Blob([new Uint8Array(result.bytes)], { type: "video/mp4" }),
      );
      setUrl(state.url);
    } catch {
      if (valid()) setNotice(draftOutputFailure(undefined));
    } finally {
      if (valid()) {
        state.busy = false;
        setBusy(false);
      }
    }
  };
  return (
    <div className="draft-revision-playback">
      <div className="assembly-actions">
        <Button
          disabled={!verified || !exports?.preview || busy}
          onClick={() => void open("preview")}
        >
          播放{label}草稿
        </Button>
        <Button
          disabled={!verified || !exports?.reveal || busy}
          onClick={() => void open("reveal")}
        >
          打开{label}草稿所在文件夹
        </Button>
        {(url || busy) && <Button onClick={close}>关闭{label}预览</Button>}
      </div>
      {busy && <p role="status">正在重新核验{label}草稿…</p>}
      {notice && <p role="status">{notice}</p>}
      {url && (
        <video
          controls
          preload="metadata"
          src={url}
          aria-label={`${label}精确 DRAFT 草稿`}
          onError={() => {
            close();
            setNotice("本地播放器无法解码此草稿，请核对原文件。");
          }}
        />
      )}
      {url && <p>播放器仅供人工比较，原版与候选版的帧号分别属于各自文件。</p>}
    </div>
  );
}
