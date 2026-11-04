import { Button } from "./Common";
import type { DraftReviewTarget } from "./adapters/draftReview";

export function DraftReviewCommentComposer({
  target,
  locked,
  verified,
  frame,
  text,
  playbackSeconds,
  validFrame,
  noteCount,
  setFrame,
  setText,
  capture,
  create,
}: {
  target: DraftReviewTarget;
  locked: boolean;
  verified: boolean;
  frame: string;
  text: string;
  playbackSeconds?: number | null;
  validFrame: boolean;
  noteCount: number;
  setFrame: (frame: string) => void;
  setText: (text: string) => void;
  capture: () => void;
  create: () => Promise<void>;
}) {
  return (
    <div className="draft-review-compose">
      <label>
        帧号（从 0 开始）
        <input
          type="number"
          min={0}
          max={target.total_frames - 1}
          step={1}
          value={frame}
          disabled={locked || !verified}
          onChange={(event) => setFrame(event.currentTarget.value)}
        />
      </label>
      <Button
        disabled={locked || playbackSeconds === null || playbackSeconds === undefined || !verified}
        onClick={capture}
      >
        从播放位置估算帧号
      </Button>
      <p>有效帧号 0–{target.total_frames - 1}。保存以输入的整数帧为准；播放器时间只供近似定位。</p>
      <label>
        评论
        <textarea
          maxLength={2000}
          value={text}
          disabled={locked || !verified}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder="例如：核对动作衔接、构图或声音位置"
        />
      </label>
      <small>保存成功并读回后才会清除对应缓存。</small>
      <Button
        primary
        disabled={
          locked ||
          !validFrame ||
          !text.trim() ||
          text.includes("\0") ||
          !verified ||
          noteCount >= 500
        }
        onClick={() => void create()}
      >
        保存此帧手工评论
      </Button>
    </div>
  );
}
