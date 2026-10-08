import type * as ReactModule from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ButtonHTMLAttributes, Dispatch, ReactNode, SetStateAction } from "react";
import { ManualCreativeEditor } from "./ManualCreativeEditor";
import { EpisodeStoryboardPanel } from "./EpisodeStoryboardPanel";
import { SettingsPage } from "./SettingsPage";
import { emptyCreativeContent } from "./adapters/creativeLibrary";
import { emptyStoryboardContent } from "./adapters/episodeStoryboard";

import type { CreativeContent } from "./adapters/creativeLibrary";
import type { StoryboardContent } from "./adapters/episodeStoryboard";

type PreferenceDraft = { user_name: string; display_bio: string };
function isPreferenceDraft(value: unknown): value is PreferenceDraft {
  return (
    !!value &&
    typeof value === "object" &&
    "user_name" in value &&
    typeof value.user_name === "string" &&
    "display_bio" in value &&
    typeof value.display_bio === "string"
  );
}

const projectId = `prj_${"a".repeat(32)}`;
const episodeId = `ep_${"b".repeat(32)}`;
const harness = vi.hoisted(() => ({
  creative: {} as CreativeContent,
  storyboard: {} as StoryboardContent,
  creativeQueue: [] as Array<(old: CreativeContent) => CreativeContent>,
  storyboardQueue: [] as Array<(old: StoryboardContent) => StoryboardContent>,
  preferenceQueue: [] as Array<(old: PreferenceDraft) => PreferenceDraft>,
  initialPreferences: {
    user_name: "original nickname",
    display_bio: "original signature",
  },
}));

// Intercept only the preference object's FUNCTIONAL writes. Initial API loading remains
// a real React state update; queued handlers run after React restores controlled DOM.
vi.mock("react", async (load) => {
  const actual = await load<typeof ReactModule>();
  return {
    ...actual,
    useState: <S,>(initial: S | (() => S)) => {
      const [value, setValue] = actual.useState(initial);
      const update: Dispatch<SetStateAction<S>> = (next) => {
        if (typeof next === "function" && isPreferenceDraft(value)) {
          harness.preferenceQueue.push(
            next as unknown as (old: PreferenceDraft) => PreferenceDraft,
          );
        } else setValue(next);
      };
      return [value, update];
    },
  };
});
vi.mock("./Common", () => ({
  Button: ({
    children,
    primary: _primary,
    icon: _icon,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    primary?: boolean;
    icon?: string;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  PageTitle: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
  Pill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  FlowFooter: () => null,
}));
vi.mock("./Icon", () => ({ Icon: () => null }));
vi.mock("./model", () => ({
  useDemo: () => ({
    isFixture: false,
    page: "settings",
    backendProjectId: projectId,
    put: () => {},
    go: () => {},
    setEditor: () => {},
  }),
}));
vi.mock("./useCreativeLibrary", () => ({
  useCreativeLibrary: () => ({
    content: harness.creative,
    version: null,
    readState: "ready",
    journal: { kind: "EMPTY" },
    busy: false,
    dirty: false,
    locked: false,
    notice: "",
    canRecover: false,
    edit: (update: (old: CreativeContent) => CreativeContent) => harness.creativeQueue.push(update),
    setNotice: () => {},
    reload: () => {},
    save: () => {},
  }),
}));
vi.mock("./useEpisodeStoryboard", () => ({
  useEpisodeStoryboard: () => ({
    content: harness.storyboard,
    version: null,
    readState: "ready",
    journal: { kind: "EMPTY" },
    busy: false,
    dirty: false,
    locked: false,
    notice: "",
    canRecover: false,
    edit: (update: (old: StoryboardContent) => StoryboardContent) =>
      harness.storyboardQueue.push(update),
    setNotice: () => {},
    reload: () => {},
    save: () => {},
  }),
}));
vi.mock("./ShotPlanProposalReview", () => ({
  ShotPlanProposalReview: () => null,
}));
vi.mock("./StoryboardReferences", () => ({ StoryboardReferences: () => null }));
vi.mock("./StoryboardTextPreview", () => ({
  StoryboardTextPreview: () => null,
}));
vi.mock("../api/studio", () => ({
  createStudioTransport: () => ({
    getAppPreferences: async () => {},
    saveAppPreferences: async () => {},
  }),
}));
vi.mock("./adapters/appPreferences", () => ({
  readAppPreferences: async () => ({
    kind: "READY",
    response: {
      data: { ...harness.initialPreferences, revision: 1, saved: true },
      request_id: "audit-only",
    },
  }),
  saveAppPreferences: async () => {
    throw new Error("Audit must never save");
  },
}));
vi.mock("./adapters/productionBriefWorkspace", () => ({
  readPendingProductionBriefCommand: () => ({ kind: "READY", command: null }),
}));

beforeEach(() => {
  harness.creativeQueue.length = 0;
  harness.storyboardQueue.length = 0;
  harness.preferenceQueue.length = 0;
  harness.creative = emptyCreativeContent(projectId);
  harness.creative.world = {
    premise: "original premise",
    rules: "original rules",
    era: "original era",
    visual_style: "original visual style",
    palette: "original palette",
    materials: "original materials",
  };
  harness.creative.characters = [
    {
      character_id: `chr_${"c".repeat(32)}`,
      ordinal: 1,
      name: "original character",
      role: "",
      description: "",
      appearance: "",
      personality: "",
    },
  ];
  harness.creative.scenes = [
    {
      scene_id: `loc_${"d".repeat(32)}`,
      ordinal: 1,
      name: "original scene",
      description: "",
      location: "",
      time_of_day: "",
      weather: "",
      continuity: "",
    },
  ];
  harness.storyboard = emptyStoryboardContent(projectId, episodeId);
  harness.storyboard.shots = [
    {
      shot_id: `shp_${"e".repeat(32)}`,
      ordinal: 1,
      title: "original shot",
      duration_frames: 48,
      camera: "",
      description: "",
      action: "",
      dialogue: "",
      script_scene_id: null,
      location_id: null,
      character_ids: [],
    },
  ];
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);
const noGuard = () => {};

describe("actual isolated active editors: queued input lifetime", () => {
  it.each([
    ["世界定位", "premise"],
    ["核心规则", "rules"],
    ["时代背景", "era"],
    ["视觉风格", "visual_style"],
    ["色彩约束", "palette"],
    ["材质约束", "materials"],
  ] as const)("retains world field %s after controlled DOM restoration", (label, key) => {
    render(
      <ManualCreativeEditor kind="world" projectId={projectId} setNavigationGuard={noGuard} />,
    );
    const input = screen.getByLabelText(label) as HTMLInputElement;
    const original = input.value;
    fireEvent.change(input, { target: { value: `new ${key}` } });
    expect(input.value).toBe(original); // proves React restored the still-controlled value
    expect(harness.creativeQueue).toHaveLength(1);
    const updated = harness.creativeQueue[0]!(harness.creative);
    expect(updated.world[key]).toBe(`new ${key}`);
    expect(updated.project_id).toBe(projectId);
    expect(updated.characters).toEqual(harness.creative.characters);
    expect(updated.scenes).toEqual(harness.creative.scenes);
    expect(harness.creativeQueue[0]!(harness.creative)).toEqual(updated);
  });

  it("retains original-route storyboard FPS after controlled DOM restoration", () => {
    render(
      <EpisodeStoryboardPanel
        projectId={projectId}
        episodeId={episodeId}
        setNavigationGuard={noGuard}
      />,
    );
    const input = screen.getByLabelText("分镜帧率") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    expect(input.value).toBe("24");
    expect(harness.storyboardQueue).toHaveLength(1);
    const updated = harness.storyboardQueue[0]!(harness.storyboard);
    expect(updated.fps).toBe(30);
    expect(updated.shots).toEqual(harness.storyboard.shots);
    expect(updated.project_id).toBe(projectId);
    expect(updated.episode_id).toBe(episodeId);
  });

  it.each([
    ["昵称", "user_name"],
    ["创作签名", "display_bio"],
  ] as const)(
    "retains persisted user preference %s after controlled DOM restoration",
    async (label, key) => {
      render(<SettingsPage />);
      await waitFor(() => expect(screen.getByLabelText("昵称")).toBeEnabled());
      if (key === "display_bio")
        fireEvent.click(screen.getByRole("button", { name: "创作默认值" }));
      const input = screen.getByLabelText(label) as HTMLInputElement;
      const original = input.value;
      fireEvent.change(input, { target: { value: `new ${key}` } });
      expect(input.value).toBe(original);
      expect(harness.preferenceQueue).toHaveLength(1);
      const updated = harness.preferenceQueue[0]!(harness.initialPreferences);
      expect(updated[key]).toBe(`new ${key}`);
      const other = key === "user_name" ? "display_bio" : "user_name";
      expect(updated[other]).toBe(harness.initialPreferences[other]);
    },
  );
});

describe("safe synchronous scalar / object capture control cases", () => {
  it.each([
    ["characters", "角色名称", "characters"],
    ["scenes", "场景名称", "scenes"],
  ] as const)("retains %s names when its updater is queued", (kind, label, itemsKey) => {
    render(<ManualCreativeEditor kind={kind} projectId={projectId} setNavigationGuard={noGuard} />);
    const input = screen.getByLabelText(label) as HTMLInputElement;
    const original = input.value;
    fireEvent.change(input, { target: { value: "new name" } });
    expect(input.value).toBe(original);
    expect(harness.creativeQueue[0]!(harness.creative)[itemsKey][0]?.name).toBe("new name");
  });
  it("retains storyboard shot title with synchronously constructed patch", () => {
    render(
      <EpisodeStoryboardPanel
        projectId={projectId}
        episodeId={episodeId}
        setNavigationGuard={noGuard}
      />,
    );
    const input = screen.getByLabelText("镜头标题") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new shot" } });
    expect(input.value).toBe("original shot");
    expect(harness.storyboardQueue[0]!(harness.storyboard).shots[0]?.title).toBe("new shot");
  });
});
