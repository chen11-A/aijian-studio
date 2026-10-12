import {
  withStoryboardPlanning,
  type StoryboardContent,
  type StoryboardShot,
} from "./adapters/episodeStoryboard";

const fields = [
  ["coverage_notes", "叙事覆盖说明", "说明本镜覆盖的情节、反应或信息，以及仍需补充的镜头。"],
  ["continuity_notes", "连续性说明", "记录前后镜的角色、服装、位置、视线、道具与动作衔接。"],
  ["transition_notes", "转场说明", "说明如何进入下一镜、视觉或声音衔接及剪辑意图。"],
] as const;
export function StoryboardPlanningFields({
  content,
  shot,
  locked,
  edit,
}: {
  content: StoryboardContent;
  shot: StoryboardShot;
  locked: boolean;
  edit: (update: (value: StoryboardContent) => StoryboardContent) => void;
}) {
  return (
    <fieldset disabled={locked} className="storyboard-characters" aria-label="镜头覆盖连续性与转场">
      <legend>覆盖、连续性与转场</legend>
      <p>这些说明随分镜版本保存，用于后续制作与审阅；不代表自动检查或已通过审签。</p>
      {fields.map(([field, label, placeholder]) => (
        <label key={field}>
          {label}
          <textarea
            rows={3}
            maxLength={20000}
            placeholder={placeholder}
            value={"coverage_notes" in shot ? shot[field] : ""}
            onChange={(event) => {
              if (locked) return;
              const text = event.currentTarget.value;
              edit((current) =>
                current.project_id === content.project_id &&
                current.episode_id === content.episode_id
                  ? withStoryboardPlanning(current, shot.shot_id, { [field]: text })
                  : current,
              );
            }}
          />
        </label>
      ))}
    </fieldset>
  );
}
