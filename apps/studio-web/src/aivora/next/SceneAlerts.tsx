import { useId, useState } from "react";
import "./next.css";
import "./SceneAlerts.css";

/** The drag type a beat carries, so shot cards can tell it from other drags. */
export const BEAT_DRAG_TYPE = "application/x-aivora-beat";

export type SceneAlertsProps = {
  /** The end of the scene that no shot shows yet (C9 missingTail). */
  missingTail: string | null;
  /** Project and scene identity prevents a drag from being applied in another scene. */
  dragScope?: string;
  repairFailed?: boolean;
  /** Coverage can remain disputed because paragraph ownership needs review, without missing text. */
  coverageWarning?: string;
  /** Lines of dialogue no shot speaks yet (C9 missingLines). */
  missingLines: readonly string[];
  /** Actions the action director wrote that fit no shot (C10). */
  beats: readonly string[];
  /** 「补上结尾」: asks the director for the missing part only. */
  onFixEnding?: () => void;
  fixing?: boolean;
  /** Where 「放到选中的镜头」 puts a beat, for example 「镜头 3」; empty when no shot is picked. */
  pickedShot?: string;
  onPlaceBeat?: (index: number) => void;
  /** 3JR-U04: true while an action is being dragged, so the cards can show where it can go. */
  onDragChange?: (dragging: boolean) => void;
};

const clip = (text: string, size = 18) => (text.length > size ? `${text.slice(0, size)}…` : text);

/**
 * 3J-U10: the two warnings above the shots of a scene. A yellow strip when the end of the
 * scene, or some of its lines, have no shot yet; and 「有 N 个动作没对上镜头」, a list whose
 * items can be dragged onto a shot card or put on the picked shot. Draws nothing when both are
 * fine, so a finished scene has no extra row.
 *
 * 3JR-U04: the list starts open. Closed, the row said 「拖到下面的镜头上」 with nothing on
 * screen to drag. Each action has a grip, a long list scrolls in its own box, and 收起 is a
 * real button.
 */
export function SceneAlerts(props: SceneAlertsProps) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  const { missingTail, missingLines, beats } = props;
  const missingContent = Boolean(missingTail) || missingLines.length > 0;
  const uncovered = missingContent || Boolean(props.coverageWarning);
  if (!uncovered && beats.length === 0) return null;
  const sentence = missingTail
    ? `这一场结尾还没拍到：「${clip(missingTail)}」`
    : missingLines.length > 0
      ? `这一场还有 ${missingLines.length} 句台词没拍到：「${clip(missingLines[0] ?? "")}」`
      : props.coverageWarning;
  const full = [missingTail, ...missingLines, props.coverageWarning].filter(Boolean).join("\n");
  return (
    <div className="nx-root nx-scene-alerts">
      {props.repairFailed && <span role="alert">未完成，可以重试。</span>}
      {uncovered && (
        <div className="nx-alert warn">
          <span className="nx-alert-text" title={full}>
            {sentence}
          </span>
          {props.onFixEnding && missingContent && (
            <button
              type="button"
              className="nx-btn"
              disabled={props.fixing}
              onClick={props.onFixEnding}
            >
              {props.fixing ? "正在补…" : "补上结尾"}
            </button>
          )}
        </div>
      )}
      {beats.length > 0 && (
        <div className="nx-alert beats">
          <span className="nx-alert-title">有 {beats.length} 个动作没对上镜头</span>
          <span className="nx-alert-hint">
            {open
              ? "按住拖到下面的镜头卡片上；也可以先选一个镜头，再点右边的按钮"
              : "展开后可以拖到镜头上"}
          </span>
          <button
            type="button"
            className="nx-alert-toggle"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? "收起没对上镜头的动作" : "展开没对上镜头的动作"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "收起" : "展开"}
          </button>
          {open && (
            <ul className="nx-beats" id={listId}>
              {beats.map((beat, index) => (
                <li
                  key={`${index}-${beat}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      BEAT_DRAG_TYPE,
                      JSON.stringify({ scope: props.dragScope, index, text: beat }),
                    );
                    event.dataTransfer.effectAllowed = "move";
                    props.onDragChange?.(true);
                  }}
                  onDragEnd={() => props.onDragChange?.(false)}
                >
                  <span className="nx-grip" aria-hidden="true">
                    ⠿
                  </span>
                  <span className="nx-beat-text" title={beat}>
                    {beat}
                  </span>
                  <button
                    type="button"
                    className="nx-btn"
                    disabled={!props.pickedShot || !props.onPlaceBeat}
                    onClick={() => props.onPlaceBeat?.(index)}
                  >
                    {props.pickedShot ? `放到${props.pickedShot}` : "先选一个镜头"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
