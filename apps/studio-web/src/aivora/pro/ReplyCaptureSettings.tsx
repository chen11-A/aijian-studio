import { useEffect, useRef, useState } from "react";
import type { FilmProject } from "../film/project";
import { captureEnabled, captureFile, setCaptureEnabled } from "./agent-capture";

/** Only content used to associate replies; media finishing in the background is harmless. */
function contentKey(film: FilmProject) {
  return JSON.stringify({
    id: film.id,
    sourceText: film.sourceText,
    scenes: film.scenes.map(({ id, text }) => ({ id, text })),
  });
}

export function ReplyCaptureSettings({
  getFilm,
  onNotice,
}: {
  getFilm: () => FilmProject | null;
  onNotice: (text: string) => void;
}) {
  const [enabled, setEnabled] = useState(captureEnabled);
  const [exporting, setExporting] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  async function exportReplies() {
    const film = getFilm();
    if (!film) {
      onNotice("先打开一个作品，再导出排查文件。");
      return;
    }
    if (!captureEnabled()) {
      onNotice("先开启保存原始回复，再进行导演或动作生成。");
      return;
    }
    const ticket = ++request.current;
    const key = contentKey(film);
    setExporting(true);
    try {
      const file = await captureFile(film);
      if (ticket !== request.current || !captureEnabled()) return;
      const current = getFilm();
      if (!current || key !== contentKey(current)) {
        onNotice("作品内容已变化，请重新导出排查文件。");
        return;
      }
      if (!file) {
        onNotice("这个作品还没有匹配的导演原始回复。开启保存后再进行生成。");
        return;
      }
      const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
      const link = document.createElement("a");
      try {
        link.href = url;
        link.download = file.name;
        document.body.append(link);
        link.click();
        onNotice(`已导出 ${file.scenes} 场的排查文件，只下载到本机。`);
      } finally {
        link.remove();
        // Leave the browser one task to begin consuming the download before revoking it.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch {
      if (ticket === request.current) onNotice("排查文件没有导出，请重试。");
    } finally {
      if (ticket === request.current) setExporting(false);
    }
  }

  return (
    <section className="ws-sec" aria-label="排查">
      <h3>排查</h3>
      <label className="check-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            request.current += 1;
            setExporting(false);
            setCaptureEnabled(event.target.checked);
            setEnabled(captureEnabled());
          }}
        />
        保存导演和动作的原始回复（只存本机，用于排查）
      </label>
      <p className="role-desc">
        默认关闭。关闭会清除已保存的本机回复。排查文件可能包含作品文字，仅在你点导出时下载。
      </p>
      <button
        className="btn sm"
        type="button"
        disabled={exporting}
        onClick={() => void exportReplies()}
      >
        {exporting ? "正在整理排查文件…" : "导出排查文件"}
      </button>
    </section>
  );
}
