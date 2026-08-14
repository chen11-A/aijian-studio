import type { ProjectData } from "./api/studio";

export type ProjectAspectRatio = ProjectData["aspect_ratio"];

export const TARGET_DURATION_SECONDS = [60, 90, 120, 150, 180, 240, 300, 480, 600, 900] as const;

type AspectOption = {
  readonly value: ProjectAspectRatio;
  readonly title: string;
  readonly shortLabel: string;
  readonly hint: string;
  readonly frameClass: "portrait" | "landscape" | "social-portrait" | "square" | "classic";
};

/** Lookup keyed by every `ProjectAspectRatio`; adding a contract ratio fails typecheck here. */
export const ASPECT_OPTION_BY_VALUE = {
  "9:16": {
    value: "9:16",
    title: "竖屏短剧",
    shortLabel: "竖屏",
    hint: "手机竖屏 · 短剧/信息流常用",
    frameClass: "portrait",
  },
  "16:9": {
    value: "16:9",
    title: "横屏漫剧",
    shortLabel: "横屏",
    hint: "宽屏横屏 · 漫剧/长视频常用",
    frameClass: "landscape",
  },
  "4:5": {
    value: "4:5",
    title: "社媒竖版",
    shortLabel: "社媒",
    hint: "近竖构图 · 小红书/图文常用",
    frameClass: "social-portrait",
  },
  "1:1": {
    value: "1:1",
    title: "方形画幅",
    shortLabel: "方形",
    hint: "正方构图 · 封面/头像常用",
    frameClass: "square",
  },
  "4:3": {
    value: "4:3",
    title: "经典画幅",
    shortLabel: "经典",
    hint: "传统比例 · 纪实/剧场常用",
    frameClass: "classic",
  },
} as const satisfies Record<ProjectAspectRatio, AspectOption>;

export const ASPECT_OPTIONS = [
  ASPECT_OPTION_BY_VALUE["9:16"],
  ASPECT_OPTION_BY_VALUE["16:9"],
  ASPECT_OPTION_BY_VALUE["4:5"],
  ASPECT_OPTION_BY_VALUE["1:1"],
  ASPECT_OPTION_BY_VALUE["4:3"],
] as const;

/** Shared ladder today; parameter remains so call sites stay aspect-aware if ladders diverge later. */
export function durationOptionsFor(aspectRatio: ProjectAspectRatio): readonly number[] {
  switch (aspectRatio) {
    case "9:16":
    case "16:9":
    case "4:5":
    case "1:1":
    case "4:3":
      return TARGET_DURATION_SECONDS;
  }
}

export function defaultDurationFor(aspectRatio: ProjectAspectRatio): number {
  switch (aspectRatio) {
    case "9:16":
    case "4:5":
    case "1:1":
      return 90;
    case "16:9":
    case "4:3":
      return 300;
  }
}

export function formatDurationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes === 0) return `${seconds} 秒`;
  if (remainder === 0) return `${minutes} 分钟`;
  return `${minutes} 分 ${remainder} 秒`;
}

export function aspectTitle(aspectRatio: ProjectAspectRatio): string {
  return ASPECT_OPTION_BY_VALUE[aspectRatio].title;
}

export function aspectShortLabel(aspectRatio: ProjectAspectRatio): string {
  return ASPECT_OPTION_BY_VALUE[aspectRatio].shortLabel;
}

export function projectFormatSummary(
  project: Pick<ProjectData, "aspect_ratio" | "target_duration_seconds">,
): string {
  return `${aspectShortLabel(project.aspect_ratio)} · ${formatDurationLabel(project.target_duration_seconds)}`;
}

export function projectAspectDetail(aspectRatio: ProjectAspectRatio): string {
  return `${aspectShortLabel(aspectRatio)} ${aspectRatio}`;
}
