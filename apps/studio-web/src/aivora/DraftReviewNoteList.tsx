import { Button } from "./Common";
import type { DraftReviewNote } from "./adapters/draftReview";

export function DraftReviewNoteList({
  notes,
  locked,
  resolve,
  selected,
  reason,
  select,
  setReason,
}: {
  notes: DraftReviewNote[];
  locked: boolean;
  resolve: (noteId: string, reason: string) => Promise<boolean>;
  selected: string | null;
  reason: string;
  select: (noteId: string | null) => void;
  setReason: (reason: string) => void;
}) {
  if (!notes.length) return <p>此文件尚无手工核对记录。</p>;
  return (
    <ol className="draft-review-list">
      {notes.map((note) => (
        <li key={note.note_id}>
          <p>
            <strong>第 {note.frame_index} 帧</strong> · {note.resolution ? "评论已处理" : "待处理"}
          </p>
          <p className="draft-review-text">{note.text}</p>
          <small>
            {note.actor_id} · {new Date(note.created_at).toLocaleString()}
          </small>
          {note.resolution ? (
            <>
              <p className="draft-review-text">处理说明：{note.resolution.reason}</p>
              <small>
                {note.resolution.actor_id} · {new Date(note.resolution.created_at).toLocaleString()}
              </small>
            </>
          ) : selected === note.note_id ? (
            <div className="draft-review-resolution">
              <label>
                处理说明
                <textarea
                  aria-label={`第 ${note.frame_index} 帧处理说明`}
                  maxLength={2000}
                  value={reason}
                  disabled={locked}
                  onChange={(event) => setReason(event.currentTarget.value)}
                />
              </label>
              <div className="assembly-actions">
                <Button
                  disabled={locked || !reason.trim() || reason.includes("\0")}
                  onClick={() =>
                    void resolve(note.note_id, reason).then((ok) => {
                      if (ok) {
                        select(null);
                        setReason("");
                      }
                    })
                  }
                >
                  保存评论处理说明
                </Button>
                <Button
                  disabled={locked}
                  onClick={() => {
                    if (reason && !window.confirm("丢弃此条未提交的处理说明？")) return;
                    select(null);
                    setReason("");
                  }}
                >
                  取消处理
                </Button>
              </div>
            </div>
          ) : (
            <Button
              disabled={locked}
              onClick={() => {
                if (
                  selected &&
                  selected !== note.note_id &&
                  reason &&
                  !window.confirm("切换评论会丢弃当前未提交的处理说明，继续吗？")
                )
                  return;
                select(note.note_id);
                setReason("");
              }}
            >
              处理此评论
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}
