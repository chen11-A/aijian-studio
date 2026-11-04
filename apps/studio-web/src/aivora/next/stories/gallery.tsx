import type { ComponentType } from "react";
import { CoverEditorStory } from "../CoverEditor.story";
import { ExportCheckStory } from "../ExportCheck.story";
import { PipelineStepsStory } from "../PipelineSteps.story";
import { SoundPanelStory } from "../SoundPanel.story";
import { SubtitleStyleStory } from "../SubtitleStyle.story";
import { TakePickerStory } from "../TakePicker.story";
import { TaskCenterStory } from "../TaskCenter.story";
import { STORY_PAGES, type StoryId } from "./StoryFrame";

export const STORIES: Record<StoryId, ComponentType<{ state?: string }>> = {
  "task-center": TaskCenterStory,
  "export-check": ExportCheckStory,
  "sound-panel": SoundPanelStory,
  "take-picker": TakePickerStory,
  "subtitle-style": SubtitleStyleStory,
  "cover-editor": CoverEditorStory,
  "pipeline-steps": PipelineStepsStory,
};

/** Reads ?story=…&state=… . An unknown story falls back to the first one. */
export function storyFromSearch(search: string): { story: StoryId; state?: string } {
  const params = new URLSearchParams(search);
  const asked = params.get("story");
  const story = STORY_PAGES.find((page) => page.id === asked)?.id ?? STORY_PAGES[0].id;
  return { story, state: params.get("state") ?? undefined };
}

/** All story pages behind one URL. Only stories/index.html loads it, from the dev server. */
export function StoryGallery({ search }: { search: string }) {
  const { story, state } = storyFromSearch(search);
  const Page = STORIES[story];
  return <Page state={state} />;
}
