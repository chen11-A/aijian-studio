import { applyContinuityChecks } from "../../film/continuity-rules";
import { sampleFilm } from "../../film/project";
import { prepareDirectorConfirmation } from "./story-confirmation";
export function directorFieldFixture() {
  let base = sampleFilm();
  base.scenes = base.scenes.slice(0, 2);
  base.jobs = [];
  base.audioClips = [];
  base.locations = [{ id: "existing-place", name: "院子", prompt: "", ambience: "" }];
  base.shots = [0, 1, 2].map((index) => ({
    ...base.shots[0]!,
    id: `review-shot-${index}`,
    sceneId: base.scenes[index === 2 ? 1 : 0]!.id,
    no: index === 2 ? 1 : index + 1,
    picture: `原画面${index}`,
    source: "agent:director",
    userFields: [],
    poster: "",
    stills: [],
    takes: [],
    selectedTakeId: "",
    continuityFromShotId: undefined,
    continuityFrame: undefined,
  }));
  base = applyContinuityChecks(base);
  const origin = {
    projectId: base.id,
    page: "board" as const,
    sceneId: base.scenes[0]!.id,
    shotId: base.shots[0]!.id,
  };
  const incoming = [
    {
      ...structuredClone(base.shots[0]!),
      picture: "新画面",
      seconds: 5,
      line: "新台词",
      lines: [{ speaker: base.characters[0]!.name, text: "新台词" }],
      speaker: base.characters[0]!.name,
    },
    {
      ...structuredClone(base.shots[1]!),
      id: "new-director-shot",
      no: 2,
      picture: "新增画面",
      actionBeats: ["跨过门槛"],
      sound: {
        source: "native" as const,
        ambience: "雨声",
        musicMood: "克制",
        sfx: [{ atSeconds: 0, text: "门响" }],
      },
    },
  ];
  const tx = prepareDirectorConfirmation(base, incoming, [
    { sceneId: origin.sceneId, text: "未分配的转身" },
  ]);
  return { base, origin, tx, incoming };
}
