import type { FilmProject } from "../film/project";
import { hasAudibleSound, needsSoundChoice } from "./sound-export-decision";

export function ExportSoundChoice({
  film,
  onSilent,
  onMakeSound,
}: {
  film: FilmProject;
  onSilent: () => void;
  onMakeSound: () => void;
}) {
  if (hasAudibleSound(film)) {
    return <p>已有可听声音。有音轨本身不等于有声音。</p>;
  }
  if (!needsSoundChoice(film) && film.audioDecision !== "SILENT_BY_USER") return null;
  if (film.audioDecision === "SILENT_BY_USER") {
    return <p role="status">已选择本片静音。静音音轨还不会在这一片写入导出文件。</p>;
  }
  return (
    <div>
      <p id="export-sound-why">还没决定这部片子有没有声音。有音轨也不代表有声音。</p>
      <button className="btn" type="button" onClick={onSilent}>
        本片静音
      </button>
      <button className="btn" type="button" onClick={onMakeSound}>
        先去做声音
      </button>
    </div>
  );
}

export function exportCheckBlocked(film: FilmProject | null): boolean {
  return Boolean(film && needsSoundChoice(film));
}
