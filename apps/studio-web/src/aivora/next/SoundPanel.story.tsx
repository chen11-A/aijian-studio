import { useState } from "react";
import { soundPanelData } from "./adapters";
import { sampleProjectJson } from "./adapters/sampleProject";
import { SoundPanel, type Mood } from "./SoundPanel";
import { StoryFrame } from "./stories/StoryFrame";
import { LANE_LABEL, type LaneVolumes } from "./volume";

/** The app treats −40 dB and below as muted. */
const gain = (db: number) => (db <= -40 ? "静音" : `给混音的增益 ${db.toFixed(1)} dB`);

/** Example page: scene 2 of 《雨夜旧书店》 with made-up tracks. */
const STATES = [
  { id: "simple", label: "默认" },
  { id: "fine", label: "细调打开" },
  { id: "project", label: "按 project.json" },
];

const TRACKS: Partial<Record<Mood, { title: string; reason: string }>> = {
  不安: { title: "雨夜低琴", reason: "单音钢琴留白多，不盖住台词。" },
  悬疑: { title: "暗涌", reason: "低音弦乐压着走，适合还没说破的时候。" },
  紧张: { title: "绷紧", reason: "高音弦乐颤音，适合等着出事的几秒。" },
  激烈: {
    title: "短兵相接",
    reason: "从推倒书架开始进鼓，节奏快，配打斗；70 秒正好够到他们逃走。",
  },
  温暖: { title: "天亮以前", reason: "弦乐慢慢铺开，情绪是温暖不是悲伤。" },
  悲伤: { title: "空走廊", reason: "慢钢琴和大提琴，留给哭戏。" },
};

/** 第 1 场 of the example project.json, through soundPanelData. */
const FROM_PROJECT = soundPanelData(sampleProjectJson(), "scene-1");

export function SoundPanelStory({ state = "simple" }: { state?: string }) {
  const project = state === "project" && FROM_PROJECT.ok ? FROM_PROJECT.props : null;
  const [mood, setMood] = useState<Mood | null>(project ? project.mood : "激烈");
  const [master, setMaster] = useState(project ? project.master : 85);
  const [lanes, setLanes] = useState<Partial<LaneVolumes>>(
    project ? project.lanes : { dialogue: 100, ambience: 50, sfx: 80, score: 30 },
  );
  const [duck, setDuck] = useState(true);
  const [log, setLog] = useState<string>();
  return (
    <StoryFrame story="sound-panel" states={STATES} state={state} log={log}>
      <SoundPanel
        sceneTitle={project ? project.sceneTitle : "第 2 场 · 码头仓库"}
        durationLabel={project ? project.durationLabel : "1 分 36 秒"}
        mood={mood}
        moodNote={project?.moodNote}
        music={project ? project.music : ((mood && TRACKS[mood]) ?? null)}
        master={master}
        lanes={lanes}
        laneNotes={project?.laneNotes}
        duckMusic={duck}
        defaultFineOpen={state !== "simple"}
        onMoodChange={setMood}
        onMasterChange={(volume, db) => {
          setMaster(volume);
          setLog(`这一场的音量 ${volume}（${gain(db)}）`);
        }}
        onLaneChange={(lane, volume, db) => {
          setLanes((value) => ({ ...value, [lane]: volume }));
          setLog(`${LANE_LABEL[lane]} ${volume}（${gain(db)}）`);
        }}
        {...(project ? {} : { onDuckMusicChange: setDuck, onPreview: () => setLog("试听这一场") })}
      />
    </StoryFrame>
  );
}
