import { useEffect, useRef, useState } from "react";
import { Button } from "./Common";
import { storyboardShotAtFrame, type StoryboardContent } from "./adapters/episodeStoryboard";

/** Timed cards show the authored plan only. There is no generated motion or audio. */
export function StoryboardTextPreview({ content }: { content: StoryboardContent }) {
  const total = content.shots.reduce((sum, shot) => sum + shot.duration_frames, 0);
  const validTiming =
    content.fps >= 1 &&
    content.fps <= 120 &&
    content.shots.every(
      (shot) => Number.isSafeInteger(shot.duration_frames) && shot.duration_frames > 0,
    );
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef(0);
  const position = Math.max(0, Math.min(frame, Math.max(total - 1, 0)));
  const shot = storyboardShotAtFrame(content, position);
  useEffect(() => {
    setPlaying(false);
    setFrame(0);
    frameRef.current = 0;
  }, [content]);
  useEffect(() => {
    if (!playing || !total || !validTiming) return;
    let handle = 0;
    const originFrame = frameRef.current;
    const originTime = performance.now();
    const tick = (time: number) => {
      const next = Math.min(
        total - 1,
        originFrame + Math.floor(((time - originTime) * content.fps) / 1000),
      );
      frameRef.current = next;
      setFrame(next);
      if (next >= total - 1) setPlaying(false);
      else handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, total, content.fps, validTiming]);
  function seek(value: number) {
    setPlaying(false);
    setFrame(value);
    frameRef.current = value;
  }
  return (
    <section className="storyboard-preview" aria-label="分镜文字预演">
      <header>
        <h3>分镜文字预演</h3>
        <span>文字卡片 · 无生成画面或声音</span>
      </header>
      <div className="storyboard-preview-card">
        {shot ? (
          <>
            <small>
              镜头 {shot.ordinal} · {(shot.duration_frames / content.fps).toFixed(2)} 秒
            </small>
            <h3>{shot.title || "未命名镜头"}</h3>
            <p>{shot.description || "填写画面描述后在这里预演。"}</p>
            {shot.camera && <p className="storyboard-preview-camera">机位：{shot.camera}</p>}
            {shot.action && <p>动作：{shot.action}</p>}
            {shot.dialogue && <p>对白：{shot.dialogue}</p>}
          </>
        ) : (
          <p>添加镜头后，可按镜头时长播放文字分镜。</p>
        )}
      </div>
      <input
        aria-label="分镜预演进度"
        type="range"
        min={0}
        max={Math.max(total - 1, 0)}
        value={position}
        disabled={!total || !validTiming}
        onChange={(event) => seek(Number(event.target.value))}
      />
      <footer>
        <Button
          disabled={!total || !validTiming}
          onClick={() => {
            if (position >= total - 1) {
              frameRef.current = 0;
              setFrame(0);
            }
            setPlaying((value) => !value);
          }}
        >
          {playing ? "暂停预演" : "播放文字预演"}
        </Button>
        <Button disabled={!total} onClick={() => seek(0)}>
          回到开头
        </Button>
        <span>
          {position + (total ? 1 : 0)} / {total} 帧 ·{" "}
          {validTiming ? (total / content.fps).toFixed(2) : "—"} 秒
        </span>
      </footer>
    </section>
  );
}
