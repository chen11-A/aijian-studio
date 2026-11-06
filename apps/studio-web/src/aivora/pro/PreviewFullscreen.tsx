import { useEffect, useRef, useState, type ReactNode } from "react";

/** 5-3-12: keep the current player and its controls together in native fullscreen. */
export function PreviewFullscreen({
  children,
  ignoreShortcut,
  onNotice,
}: {
  children: ReactNode;
  ignoreShortcut: (event: KeyboardEvent) => boolean;
  onNotice: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const callbacks = useRef({ ignoreShortcut, onNotice });
  callbacks.current = { ignoreShortcut, onNotice };

  const toggle = async () => {
    const player = ref.current;
    if (!player || busy.current) return;
    busy.current = true;
    try {
      if (document.fullscreenElement === player) {
        await document.exitFullscreen();
      } else {
        await player.requestFullscreen();
      }
    } catch {
      callbacks.current.onNotice("暂时不能全屏预览，请再试一次。");
    } finally {
      busy.current = false;
    }
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    const player = ref.current;
    const onChange = () => setFullscreen(document.fullscreenElement === player);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.key === "Escape" && document.fullscreenElement === player) {
        event.preventDefault();
        void toggleRef.current();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() !== "f" || callbacks.current.ignoreShortcut(event)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      void toggleRef.current();
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
      if (document.fullscreenElement === player) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      className="preview-player"
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest(".screen")) {
          void toggle();
        }
      }}
    >
      {children}
      <button
        type="button"
        className="btn sm fullscreen-toggle"
        aria-label={fullscreen ? "退出全屏 (Esc)" : "全屏预览 (F)"}
        title={fullscreen ? "退出全屏（Esc）" : "全屏预览（F，或双击画面）"}
        onClick={() => void toggle()}
      >
        {fullscreen ? "退出全屏" : "全屏"}
      </button>
    </div>
  );
}
