import type { SubtitleStyleProps } from "../SubtitleStyle";
import { shotName } from "./names";
import { readProject } from "./read";
import { unreadable, type Adapted } from "./result";

export type SubtitleStyleData = Pick<SubtitleStyleProps, "value" | "sampleLine" | "sampleSource">;

export type SubtitleStyleOptions = {
  /** The style picked on screen but not saved yet. project.json has no subtitle style. */
  value?: string;
};

/**
 * SubtitleStyle props: the first line of dialogue in shot order is the sample. With no style
 * saved, none is selected until the user picks one.
 */
export function subtitleStyleData(
  value: unknown,
  options: SubtitleStyleOptions = {},
): Adapted<SubtitleStyleData> {
  const read = readProject(value);
  if (!read.ok) return unreadable(read.reason);
  const project = read.project;
  const shot = project.shots.find((item) => item.line.trim());
  if (!shot) {
    return {
      ok: false,
      empty: { title: "还没有台词", detail: "拆好镜头、写上台词以后，才能看到字幕的样子。" },
      missing: project.missing,
    };
  }
  return {
    ok: true,
    props: {
      value: options.value ?? "",
      sampleLine: shot.line.trim(),
      sampleSource: shotName(project, shot),
    },
    missing: project.missing,
  };
}
