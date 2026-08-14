import { expect, test } from "vitest";

import {
  ASPECT_OPTION_BY_VALUE,
  ASPECT_OPTIONS,
  aspectShortLabel,
  aspectTitle,
  defaultDurationFor,
  durationOptionsFor,
  formatDurationLabel,
  projectAspectDetail,
  projectFormatSummary,
  TARGET_DURATION_SECONDS,
  type ProjectAspectRatio,
} from "./project-format";

const FULL_DURATION_LADDER = [60, 90, 120, 150, 180, 240, 300, 480, 600, 900];
const ALL_RATIOS: ProjectAspectRatio[] = ["9:16", "16:9", "4:5", "1:1", "4:3"];

test("exposes all five supported aspect options in order with unique values and frame classes", () => {
  expect(ASPECT_OPTIONS.map((option) => option.value)).toEqual([
    "9:16",
    "16:9",
    "4:5",
    "1:1",
    "4:3",
  ]);
  expect(new Set(ASPECT_OPTIONS.map((option) => option.value)).size).toBe(5);
  expect(ASPECT_OPTIONS.map((option) => option.frameClass)).toEqual([
    "portrait",
    "landscape",
    "social-portrait",
    "square",
    "classic",
  ]);
  for (const ratio of ALL_RATIOS) {
    expect(ASPECT_OPTION_BY_VALUE[ratio].value).toBe(ratio);
    expect(ASPECT_OPTIONS.find((option) => option.value === ratio)).toBe(
      ASPECT_OPTION_BY_VALUE[ratio],
    );
  }
  for (const option of ASPECT_OPTIONS) {
    expect(option.title.trim().length).toBeGreaterThan(0);
    expect(option.hint.trim().length).toBeGreaterThan(0);
    expect(option.shortLabel.trim().length).toBeGreaterThan(0);
  }
});

test("offers the complete duration ladder and sensible defaults for every ratio", () => {
  expect(TARGET_DURATION_SECONDS).toEqual(FULL_DURATION_LADDER);
  for (const ratio of ALL_RATIOS) {
    expect(durationOptionsFor(ratio)).toEqual(FULL_DURATION_LADDER);
  }
  expect(defaultDurationFor("9:16")).toBe(90);
  expect(defaultDurationFor("4:5")).toBe(90);
  expect(defaultDurationFor("1:1")).toBe(90);
  expect(defaultDurationFor("16:9")).toBe(300);
  expect(defaultDurationFor("4:3")).toBe(300);
});

test("formats episode length in Chinese minutes and seconds", () => {
  expect(formatDurationLabel(60)).toBe("1 分钟");
  expect(formatDurationLabel(90)).toBe("1 分 30 秒");
  expect(formatDurationLabel(180)).toBe("3 分钟");
  expect(formatDurationLabel(900)).toBe("15 分钟");
});

test("labels and summarizes every supported ratio without binary fallbacks", () => {
  expect(aspectTitle("9:16")).toBe("竖屏短剧");
  expect(aspectTitle("16:9")).toBe("横屏漫剧");
  expect(aspectTitle("4:5")).toBe("社媒竖版");
  expect(aspectTitle("1:1")).toBe("方形画幅");
  expect(aspectTitle("4:3")).toBe("经典画幅");

  expect(aspectShortLabel("9:16")).toBe("竖屏");
  expect(aspectShortLabel("16:9")).toBe("横屏");
  expect(aspectShortLabel("4:5")).toBe("社媒");
  expect(aspectShortLabel("1:1")).toBe("方形");
  expect(aspectShortLabel("4:3")).toBe("经典");

  expect(
    projectFormatSummary({
      aspect_ratio: "9:16",
      target_duration_seconds: 90,
    }),
  ).toBe("竖屏 · 1 分 30 秒");
  expect(
    projectFormatSummary({
      aspect_ratio: "16:9",
      target_duration_seconds: 900,
    }),
  ).toBe("横屏 · 15 分钟");
  expect(
    projectFormatSummary({
      aspect_ratio: "4:5",
      target_duration_seconds: 90,
    }),
  ).toBe("社媒 · 1 分 30 秒");
  expect(
    projectFormatSummary({
      aspect_ratio: "1:1",
      target_duration_seconds: 90,
    }),
  ).toBe("方形 · 1 分 30 秒");
  expect(
    projectFormatSummary({
      aspect_ratio: "4:3",
      target_duration_seconds: 300,
    }),
  ).toBe("经典 · 5 分钟");

  expect(projectAspectDetail("9:16")).toBe("竖屏 9:16");
  expect(projectAspectDetail("16:9")).toBe("横屏 16:9");
  expect(projectAspectDetail("4:5")).toBe("社媒 4:5");
  expect(projectAspectDetail("1:1")).toBe("方形 1:1");
  expect(projectAspectDetail("4:3")).toBe("经典 4:3");
});
