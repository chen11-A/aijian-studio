import type { MixLane } from "@aijian/contracts/film-audio-mix";
import { AUDIO_LANE_LABEL, dbToVolumePercent, volumePercentToDb } from "../film/audio";
export function AudioLaneControls({
  lane,
  gainDb,
  muted,
  onLane,
  onSolo,
}: {
  lane: MixLane;
  gainDb: number;
  muted: boolean;
  onLane?: (lane: MixLane, db: number) => void;
  onSolo?: (lane: MixLane) => void;
}) {
  const label = AUDIO_LANE_LABEL[lane];
  return (
    <span className="lane-controls">
      <button
        type="button"
        aria-label={`静音${label}`}
        aria-pressed={muted}
        onClick={() => onLane?.(lane, muted ? gainDb : -80)}
      >
        静音
      </button>
      <button
        type="button"
        aria-label={`单听${label}`}
        title="仅试听，不改变导出"
        onClick={() => onSolo?.(lane)}
      >
        单听
      </button>
      <input
        aria-label={`${label}音量`}
        title="整轨音量，保留各片段原有音量"
        type="range"
        min={0}
        max={100}
        value={muted ? 0 : dbToVolumePercent(gainDb)}
        onChange={(event) => onLane?.(lane, volumePercentToDb(Number(event.target.value)))}
      />
      <span className="vol-num" aria-hidden="true">
        {muted ? 0 : dbToVolumePercent(gainDb)}
      </span>
    </span>
  );
}
