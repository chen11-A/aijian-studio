import { AUDIO_LANE_GAIN_DB } from "../../film/audio";
import { durationLabel } from "../shot";
import { MOODS, type SoundPanelProps } from "../SoundPanel";
import { dbToVolume, LANE_LABEL, type SoundLane } from "../volume";
import { sceneName } from "./names";
import { readProject, type ProjectClip } from "./read";
import { unreadable, type Adapted } from "./result";

export type SoundPanelData = Pick<
  SoundPanelProps,
  "sceneTitle" | "durationLabel" | "mood" | "moodNote" | "music" | "master" | "lanes" | "laneNotes"
>;

/** What the timeline calls the music the user imported. The file is always saved as bed.mp3. */
const IMPORTED_MUSIC = "导入的音乐";

function sceneLevel(clips: ProjectClip[], lane: SoundLane): number | null | undefined {
  const gains = [...new Set(clips.map((clip) => clip.gainDb ?? AUDIO_LANE_GAIN_DB[lane]))];
  if (gains.length === 0) return undefined;
  return gains.length === 1 ? dbToVolume(gains[0]!) : null;
}

/**
 * SoundPanel props for one scene. What project.json has: a music mood per shot, voice clips per
 * shot, and one imported music file with one volume for the whole film. What it does not have:
 * a volume for the scene, ambience and sound-effect files, and a choice about lowering the music
 * under speech, which the export always does. Those parts get a note, not a made-up value.
 */
export function soundPanelData(value: unknown, sceneId: string): Adapted<SoundPanelData> {
  const read = readProject(value);
  if (!read.ok) return unreadable(read.reason);
  const project = read.project;
  const { missing } = project;
  if (project.scenes.length === 0) {
    return {
      ok: false,
      empty: { title: "还没有分场", detail: "先在剧本里导入小说或加一场，再来调这一场的声音。" },
      missing,
    };
  }
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    return {
      ok: false,
      empty: { title: "找不到这一场", detail: `作品里没有编号为 ${sceneId} 的场。` },
      missing,
    };
  }
  const shots = project.shots.filter((shot) => shot.sceneId === scene.id);
  const ids = new Set(shots.map((shot) => shot.id));
  const lengths = shots.map((shot) => shot.seconds);
  const total = lengths.reduce<number>((sum, seconds) => sum + (seconds ?? 0), 0);
  const moods = [...new Set(shots.map((shot) => shot.musicMood.trim()).filter(Boolean))];
  const only = moods.length === 1 ? moods[0]! : "";
  const mood = MOODS.find((item) => item === only) ?? null;
  let moodNote: string | undefined;
  if (only && !mood) moodNote = `导演写的是「${only}」，不在这八个里。`;
  if (moods.length > 1) moodNote = `这一场的镜头写了不同的配乐情绪：${moods.join("、")}。`;

  const lanes: SoundPanelData["lanes"] = {};
  const laneNotes: NonNullable<SoundPanelData["laneNotes"]> = {};
  for (const lane of ["dialogue", "ambience", "sfx"] as const) {
    const clips = project.audioClips.filter(
      (clip) => clip.lane === lane && clip.path && ids.has(clip.shotId),
    );
    const level = sceneLevel(clips, lane);
    if (typeof level === "number") lanes[lane] = level;
    else if (level === null) laneNotes[lane] = `这一场各镜头的${LANE_LABEL[lane]}音量不一样。`;
    else if (lane === "dialogue") laneNotes[lane] = "这一场还没有配音。";
    else laneNotes[lane] = `还没有${LANE_LABEL[lane]}的声音文件。`;
  }
  const score = project.audioClips.find((clip) => clip.lane === "score" && clip.path);
  laneNotes.score = score ? "配乐是整部片子一起调的，在时间线的音乐轨上调。" : "还没有导入配乐。";

  return {
    ok: true,
    props: {
      sceneTitle: sceneName(scene),
      ...(shots.length > 0 && lengths.every((seconds) => seconds !== null)
        ? { durationLabel: durationLabel(total) }
        : {}),
      mood,
      ...(moodNote ? { moodNote } : {}),
      music: score ? { title: IMPORTED_MUSIC } : null,
      master: null,
      lanes,
      laneNotes,
    },
    missing,
  };
}
