import { useEffect, useRef, useState } from "react";

/** Local text inspection only. Selecting a document never grants its instructions authority. */
export function SkillMarkdownImport({
  disabled,
  onPreview,
  onDraftChange,
  onClose,
}: {
  disabled: boolean;
  onPreview: (guidance: string) => void;
  onDraftChange: () => void;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<{ name: string; text: string } | null>(null);
  const [guidance, setGuidance] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const reader = useRef<FileReader | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = window.document.activeElement;
    filePicker.current?.focus();
    return () => {
      reader.current?.abort();
      reader.current = null;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  return (
    <section
      className="dialog skill-import-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="导入本地 SKILL.md 参考"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
        if (event.key !== "Tab") return;
        const edge = event.shiftKey ? filePicker.current : closeButton.current;
        if (event.target === edge) {
          event.preventDefault();
          (event.shiftKey ? closeButton.current : filePicker.current)?.focus();
        }
      }}
    >
      <h2>导入本地 SKILL.md 参考</h2>
      <p>只读取一个本地 Markdown，作为纯文字参考。不访问链接、不执行脚本、不发起生成。</p>
      <label>
        选择本地 Markdown
        <input
          ref={filePicker}
          type="file"
          accept=".md,.markdown,text/markdown"
          disabled={disabled}
          onChange={(event) => {
            onDraftChange();
            reader.current?.abort();
            setDocument(null);
            setGuidance("");
            setSelected("");
            setError("");
            setReading(false);
            const files = event.currentTarget.files;
            const file = files?.[0];
            const count = files?.length;
            event.currentTarget.value = "";
            if (!file) return;
            if (count !== 1 || !/\.(md|markdown)$/iu.test(file.name) || file.size > 65536) {
              setError("请选择一个不超过 64 KB 的 Markdown 文件。");
              return;
            }
            const pending = new FileReader();
            reader.current = pending;
            setReading(true);
            pending.onload = () => {
              if (reader.current !== pending) return;
              setDocument({ name: file.name, text: String(pending.result ?? "") });
              setReading(false);
            };
            pending.onerror = () => {
              if (reader.current !== pending) return;
              setError("读取失败，请重新选择本地文件。");
              setReading(false);
            };
            pending.readAsText(file, "UTF-8");
          }}
        />
      </label>
      {reading && <p role="status">正在读取本地文字…</p>}
      {error && <p role="alert">{error}</p>}
      {document && (
        <>
          <label>
            原文参考：{document.name}
            <textarea
              aria-label="Markdown 原文参考"
              readOnly
              value={document.text}
              rows={6}
              onSelect={(event) => {
                const input = event.currentTarget;
                setSelected(input.value.slice(input.selectionStart, input.selectionEnd));
              }}
            />
          </label>
          <button
            className="btn"
            disabled={disabled || !selected.trim()}
            onClick={() => {
              if (selected.length > 2000) {
                setError("选中文字请不超过 2000 字符。");
                return;
              }
              onDraftChange();
              setGuidance(selected);
              setError("");
            }}
          >
            采用选中文字
          </button>
          <label>
            本镜构图指导
            <textarea
              value={guidance}
              disabled={disabled}
              maxLength={2000}
              rows={3}
              placeholder="只摘选或改写你要用于这一镜的构图描述，不要填写脚本、工具或声音指令。"
              onChange={(event) => {
                onDraftChange();
                setGuidance(event.currentTarget.value);
              }}
            />
          </label>
          <p>
            仅此框的文字会进入本镜视频说明。先预览，再确认；不改台词、配音、音频片段或选用版本。可用顶部「撤销」恢复。
          </p>
        </>
      )}
      <div className="acts">
        {document && (
          <button
            type="button"
            className="btn primary"
            disabled={disabled || !guidance.trim()}
            onClick={() => onPreview(guidance.trim())}
          >
            预览本镜构图指导
          </button>
        )}
        <button ref={closeButton} type="button" className="btn" onClick={onClose}>
          关闭
        </button>
      </div>
    </section>
  );
}
