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
  /** One music mood per scene. */
  mood: Mood;
  /** The track the sound designer picked for this mood, and why. */
  music?: { title: string; reason: string } | null;
  /** Volume of the whole scene, 0–100. */
  master: number;
  /** Dialogue, ambience, sound effects and score, 0–100 each. Shown under 「细调」. */
  lanes: LaneVolumes;
  /** Score gets quieter while someone speaks. */
  duckMusic?: boolean;
  defaultFineOpen?: boolean;
  onMoodChange: (mood: Mood) => void;
  /** db is volumeToDb(volume): 100 → 0 dB, 70 → −3, 50 → −6, 20 → −14, 0 → −40. */
  onMasterChange: (volume: number, db: number) => void;
  onLaneChange: (lane: SoundLane, volume: number, db: number) => void;
  onDuckMusicChange?: (on: boolean) => void;
  onPreview?: () => void;
};

/** Sound for one scene: the music mood and one volume, with the four layers under 「细调」. */
export function SoundPanel({
  sceneTitle,
  durationLabel,
  mood,
  music,
  master,
  lanes,
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
  const masterValue = clampVolume(master);

  const onMoodKey = (event: KeyboardEvent) => {
    const next = stepChoice(MOODS, mood, event.key);
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
                  tabIndex={item === mood ? 0 : -1}
                  className="nx-mood"
                  onClick={() => onMoodChange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            {music ? (
              <p className="nx-music">
                <span>
                  配乐：<strong>{music.title}</strong>
                </span>
                <span className="nx-muted">为什么选它：{music.reason}</span>
              </p>
            ) : (
              <p className="nx-faint">这个情绪还没有选配乐。</p>
            )}
          </div>
          <div className="nx-master">
            <label htmlFor={`${id}-master`}>这一场的音量</label>
            <input
              id={`${id}-master`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={masterValue}
              onChange={(event) => {
                const volume = clampVolume(Number(event.target.value));
                onMasterChange(volume, volumeToDb(volume));
              }}
            />
            <span className="nx-volume-value" aria-hidden="true">
              {masterValue}
            </span>
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
            <span className="nx-faint">
              {fineOpen ? "只改这一场，其他场不受影响" : "台词、环境声、音效、配乐各自的大小"}
            </span>
          </div>
          {fineOpen ? (
            <div id={`${id}-fine`} className="nx-fine">
              <div className="nx-lanes">
                {SOUND_LANES.map((lane) => {
                  const value = clampVolume(lanes[lane]);
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
