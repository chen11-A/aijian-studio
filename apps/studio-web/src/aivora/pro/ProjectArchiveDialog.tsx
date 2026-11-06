import { useEffect, useRef, useState } from "react";
import type {
  FilmProjectArchiveExport,
  FilmProjectArchiveImport,
  FilmProjectArchiveFailure,
} from "@aijian/contracts/film-project-archive";
import "./ProjectArchiveDialog.css";
const failureCopy: Record<FilmProjectArchiveFailure["code"], string> = {
  INVALID_INPUT: "工程包请求未完成，请重新打开此窗口。",
  BUSY: "另一个工程包操作仍在进行，请稍后重试。",
  PROJECT_CHANGED: "作品内容已变化，请重新导出工程包。",
  SOURCE_MISSING: "有引用素材找不到，工程包未导出。请先检查素材。",
  SOURCE_UNVERIFIED: "有素材暂时无法核验归属，工程包未导出。",
  ARCHIVE_INVALID: "工程包已损坏或不受支持，没有导入。",
  OUTPUT_EXISTS: "所选位置已有文件，请换一个文件名。",
  WRITE_FAILED: "工程包操作没有完成，原作品仍保留，请重试。",
  RUNTIME_UNAVAILABLE: "当前环境不能处理工程包，请使用支持此功能的桌面版。",
};
export function ProjectArchiveDialog({
  mode,
  projectId,
  onClose,
  onExport,
  onImport,
  onImported,
}: {
  mode: "export" | "import";
  projectId: string | null;
  onClose: () => void;
  onExport: () => Promise<FilmProjectArchiveExport>;
  onImport: () => Promise<FilmProjectArchiveImport>;
  onImported: (id: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const sequence = useRef(0),
    working = useRef(false);
  useEffect(() => {
    sequence.current++;
    working.current = false;
    setBusy(false);
    setMessage("");
    return () => {
      sequence.current++;
    };
  }, [mode, projectId]);
  async function run() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    const attempt = ++sequence.current;
    const current = () => attempt === sequence.current;
    try {
      const result = mode === "export" ? await onExport() : await onImport();
      if (!current()) return;
      if (result.kind === "FAILED")
        setMessage(failureCopy[result.code] ?? failureCopy.WRITE_FAILED);
      else if (result.kind === "CANCELLED") setMessage("已取消，原作品没有改动。");
      else if (result.kind === "EXPORTED")
        setMessage(`工程包已写入所选位置，包含 ${result.mediaCount} 份引用素材。`);
      else {
        setMessage("工程包已导入为独立新作品。");
        const opened = await onImported(result.projectId);
        if (current() && !opened) setMessage("工程包已导入，可从作品菜单打开新作品。");
      }
    } catch {
      if (current()) setMessage(failureCopy.WRITE_FAILED);
    } finally {
      if (current()) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <div className="dialog-back">
      <section
        className="dialog project-archive"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "export" ? "导出工程包" : "打开工程包"}
        aria-busy={busy}
      >
        <h2>{mode === "export" ? "导出工程包" : "打开工程包"}</h2>
        <p>
          {mode === "export"
            ? "包含当前这一集的剧本、人物、全部保留镜头版本和引用素材。"
            : "先核验工程包，再导入为独立新作品，原有作品和素材保留。"}
        </p>
        <p className="role-desc">
          不包含历史版本、已导出的成片、账号信息和生成任务。导入后请重新确认声音选择，不会自动生成或付费。
        </p>
        <p className="role-desc">
          工程包不携带原生成的来源验证记录。导入后可编辑和预览，是否能导出成片仍以实际检查结果为准。
        </p>
        {message ? (
          <p role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
        {busy ? (
          <p role="status" aria-live="polite">
            {mode === "export" ? "正在整理并打包素材，请稍候。" : "正在核验并导入工程包，请稍候。"}
          </p>
        ) : null}
        <div className="acts">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            关闭
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy || (mode === "export" && !projectId)}
            onClick={() => void run()}
          >
            {mode === "export" ? "选择保存位置并打包" : "选择工程包"}
          </button>
        </div>
      </section>
    </div>
  );
}
