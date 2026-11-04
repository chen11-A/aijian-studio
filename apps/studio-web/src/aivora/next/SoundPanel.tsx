import { useId, useRef, useState, type KeyboardEvent } from "react";
import "./next.css";
import "./SoundPanel.css";
import { stepChoice } from "./radio";
import {
  clampVolume,
  LANE_LABEL,
  SOUND_LANES,
  volumeToDb,
  type LaneVolumes,
  type SoundLane,
} from "./volume";

export const MOODS = ["平静", "温暖", "不安", "悬疑", "紧张", "激烈", "悲伤", "释然"] as const;

export type Mood = (typeof MOODS)[number];

export type SoundPanelProps = {
  sceneTitle: string;
  durationLabel?: string;
  /** One music mood per scene. null until one is chosen. */
  mood: Mood | null;
  /** Shown under the moods, for example what the director wrote when it is not one of MOODS. */
  moodNote?: string;
  /** The music in this scene. reason says why it was picked, when someone wrote that down. */
  music?: { title: string; reason?: string } | null;
  /** Volume of the whole scene, 0–100. null when it cannot be set yet: a note replaces the slider. */
  master: number | null;
  /**
   * 0–100 for each layer under 「细调」. A layer that is left out gets laneNotes[lane], or
   * 「这一场没有…」, instead of a slider.
   */
  lanes: Partial<LaneVolumes>;
  /** Why a layer has no slider here, for example that the score is set for the whole film. */
  laneNotes?: Partial<Record<SoundLane, string>>;
  /** Score gets quieter while someone speaks. */
  duckMusic?: boolean;
  defaultFineOpen?: boolean;
  onMoodChange: (mood: Mood) => void;
  /** db is volumeToDb(volume): 100 → 0 dB, 70 → −3, 50 → −6, 20 → −14, 0 → −40. */
  onMasterChange: (volume: number, db: number) => void;
  onLaneChange: (lane: SoundLane, volume: number, db: number) => void;
  /** Without it the ducking switch is not shown, because there is nowhere to keep the choice. */
  onDuckMusicChange?: (on: boolean) => void;
  onPreview?: () => void;
};

/** Sound for one scene: the music mood and one volume, with the four layers under 「细调」. */
export function SoundPanel({
  sceneTitle,
  durationLabel,
  mood,
  moodNote,
  music,
  master,
  lanes,
  laneNotes = {},
  duckMusic = true,
  defaultFineOpen = false,
  onMoodChange,
  onMasterChange,
  onLaneChange,
  onDuckMusicChange,
  onPreview,
}: SoundPanelProps) {
  const id = useId();
  const [fineOpen, setFineOpen] = useState(defaultFineOpen);
  const moodButtons = useRef(new Map<Mood, HTMLButtonElement>());
  const focusMood = mood ?? MOODS[0];

  const onMoodKey = (event: KeyboardEvent) => {
    const next = stepChoice<Mood | null>(MOODS, mood, event.key);
    if (!next) return;
    event.preventDefault();
    onMoodChange(next);
    moodButtons.current.get(next)?.focus();
  };

  return (
    <section className="nx-root nx-sound" aria-labelledby={`${id}-title`}>
      <div className="nx-panel nx-sound-panel">
        <div className="nx-panel-head">
          <h2 id={`${id}-title`} className="nx-one-line">
            {sceneTitle}
          </h2>
          {durationLabel ? <span className="nx-faint">{durationLabel}</span> : null}
          <span className="nx-spacer" />
          {onPreview ? (
            <button type="button" className="nx-btn nx-sm" onClick={onPreview}>
              试听这一场
            </button>
          ) : null}
        </div>
        <div className="nx-panel-body nx-sound-body">
          <div className="nx-sound-field">
            <p id={`${id}-mood`} className="nx-sound-label">
              这一场的配乐情绪（一场只选一个）
            </p>
            <div
              className="nx-moods"
              role="radiogroup"
              aria-labelledby={`${id}-mood`}
              onKeyDown={onMoodKey}
            >
              {MOODS.map((item) => (
                <button
                  key={item}
                  ref={(node) => {
                    if (node) moodButtons.current.set(item, node);
                    else moodButtons.current.delete(item);
                  }}
                  type="button"
                  role="radio"
                  aria-checked={item === mood}
                  tabIndex={item === focusMood ? 0 : -1}
                  className="nx-mood"
                  onClick={() => onMoodChange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            {mood === null || moodNote ? (
              <p className="nx-faint">{moodNote ?? "还没有选这一场的配乐情绪。"}</p>
            ) : null}
            {music ? (
              <p className="nx-music">
                <span>
                  配乐：<strong>{music.title}</strong>
                </span>
                {music.reason ? <span className="nx-muted">为什么选它：{music.reason}</span> : null}
              </p>
            ) : (
              <p className="nx-faint">这一场还没有配乐。</p>
            )}
          </div>
          <div className="nx-master">
            {master === null ? (
              <>
                <span className="nx-master-name">这一场的音量</span>
                <span className="nx-faint nx-master-note">还不能单独调。</span>
              </>
            ) : (
              <>
                <label htmlFor={`${id}-master`} className="nx-master-name">
                  这一场的音量
                </label>
                <input
                  id={`${id}-master`}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={clampVolume(master)}
                  onChange={(event) => {
                    const volume = clampVolume(Number(event.target.value));
                    onMasterChange(volume, volumeToDb(volume));
                  }}
                />
                <span className="nx-volume-value" aria-hidden="true">
                  {clampVolume(master)}
                </span>
              </>
            )}
          </div>
          <div className="nx-fine-toggle">
            <button
              type="button"
              className="nx-btn"
              aria-expanded={fineOpen}
              aria-controls={`${id}-fine`}
              onClick={() => setFineOpen((open) => !open)}
            >
              {fineOpen ? "收起细调" : "细调"}
            </button>
            <span className="nx-faint nx-one-line">
              {fineOpen ? "只改这一场，其他场不受影响" : "台词、环境声、音效、配乐各自的大小"}
            </span>
          </div>
          {fineOpen ? (
            <div id={`${id}-fine`} className="nx-fine">
              <div className="nx-lanes">
                {SOUND_LANES.map((lane) => {
                  const level = lanes[lane];
                  if (level === undefined) {
                    return (
                      <div key={lane} className={`nx-lane nx-lane-${lane}`}>
                        <span className="nx-lane-name">
                          <i aria-hidden="true" />
                          {LANE_LABEL[lane]}
                        </span>
                        <p className="nx-faint">
                          {laneNotes[lane] ?? `这一场没有${LANE_LABEL[lane]}。`}
                        </p>
                      </div>
                    );
                  }
                  const value = clampVolume(level);
                  return (
                    <div key={lane} className={`nx-lane nx-lane-${lane}`}>
                      <label htmlFor={`${id}-${lane}`} className="nx-lane-name">
                        <i aria-hidden="true" />
                        {LANE_LABEL[lane]}
                        <span className="nx-volume-value" aria-hidden="true">
                          {value}
                        </span>
                      </label>
                      <input
                        id={`${id}-${lane}`}
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={value}
                        onChange={(event) => {
                          const volume = clampVolume(Number(event.target.value));
                          onLaneChange(lane, volume, volumeToDb(volume));
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              {onDuckMusicChange ? (
                <div className="nx-duck">
                  <button
                    type="button"
                    className="nx-switch"
                    role="switch"
                    aria-checked={duckMusic}
                    aria-labelledby={`${id}-duck`}
                    onClick={() => onDuckMusicChange(!duckMusic)}
                  />
                  <span id={`${id}-duck`}>有人说话时，配乐自动变小</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
