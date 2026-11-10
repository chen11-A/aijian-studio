import type { FilmProject } from "../film/project";
import { soundChoicePending } from "./sound-export-decision";

export function ExportSoundChoice({
  film,
  onSilent,
  onWithAudio,
  onMakeSound,
}: {
  film: FilmProject;
  onSilent: () => void;
  onWithAudio: () => void;
  onMakeSound: () => void;
}) {
  if (film.audioDecision === "SILENT_BY_USER") {
    return <p role="status">已选择本片静音。静音音轨还不会在这一片写入导出文件。</p>;
  }
  if (film.audioDecision === "WITH_AUDIO") {
    return <p role="status">已确认按有声导出。音轨本身不等于已经听过。</p>;
  }
  return (
    <div className="still-gate">
      <p id="export-sound-why">还没决定这部片子有没有声音。有音轨也不代表有声音。</p>
      <button className="btn" type="button" onClick={onSilent}>
        本片静音
      </button>
      <button className="btn" type="button" onClick={onWithAudio}>
        确认有声导出
      </button>
      <button className="btn" type="button" onClick={onMakeSound}>
        先去做声音
      </button>
    </div>
  );
}

export function exportCheckBlocked(film: FilmProject | null): boolean {
  return Boolean(film && soundChoicePending(film));
}
