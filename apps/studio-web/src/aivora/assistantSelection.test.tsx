import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScriptVersion } from "./adapters/episodeScript";
import type { StoryboardVersion } from "./adapters/episodeStoryboard";
import type { CreativeVersion } from "./adapters/creativeLibrary";
import {
  AssistantSelectionProvider,
  buildCreativeSelection,
  buildScriptSelection,
  buildStoryboardSelection,
  assistantChatReferences,
  useAssistantSelection,
  usePublishAssistantSelection,
  type AssistantSelectionPublication,
  type AssistantSelectionScope,
} from "./assistantSelection";

const projectId = `prj_${"a".repeat(32)}`;
const episodeId = `ep_${"b".repeat(32)}`;
const versionId = `ver_${"c".repeat(32)}`;
const hash = `sha256:${"d".repeat(64)}`;
const script = {
  project_id: projectId,
  episode_id: episodeId,
  version_id: versionId,
  head_revision: 2,
  content_hash: hash,
  content: {
    scenes: [
      {
        scene_id: `scn_${"e".repeat(32)}`,
        ordinal: 1,
        heading: "室内",
        blocks: [{ kind: "ACTION", text: "留在房间。" }],
      },
    ],
  },
} as ScriptVersion;
const storyboard = {
  project_id: projectId,
  episode_id: episodeId,
  version_id: versionId,
  head_revision: 2,
  content_hash: hash,
  content: {
    shots: [
      {
        shot_id: `shp_${"f".repeat(32)}`,
        ordinal: 1,
        title: "雨夜",
        description: "街角",
        action: "回头",
        dialogue: "等等",
        camera: "近景",
      },
    ],
  },
} as StoryboardVersion;
const creative = {
  project_id: projectId,
  episode_id: null,
  version_id: versionId,
  head_revision: 2,
  content_hash: hash,
  content: {
    characters: [
      {
        character_id: `chr_${"1".repeat(32)}`,
        name: "阿南",
        role: "主角",
        description: "寻找故乡",
        appearance: "短发",
        personality: "谨慎",
      },
    ],
    world: {
      premise: "浮岛",
      rules: "无夜",
      era: "未来",
      visual_style: "冷色",
      palette: "蓝",
      materials: "金属",
    },
    scenes: [
      {
        scene_id: `loc_${"2".repeat(32)}`,
        name: "码头",
        location: "海边",
        description: "旧船",
        time_of_day: "傍晚",
        weather: "雨",
        continuity: "船灯常亮",
      },
    ],
  },
} as CreativeVersion;

describe("assistant saved selection builders", () => {
  it("publishes only the selected saved script scene and bounds the excerpt", () => {
    const selected = buildScriptSelection({
      projectId,
      episodeId,
      version: script,
      selectedSceneId: script.content.scenes[0]!.scene_id,
      dirty: false,
      readState: "ready",
    });
    expect(selected.kind).toBe("AVAILABLE");
    if (selected.kind !== "AVAILABLE") return;
    expect(selected.selection).toMatchObject({
      projectId,
      episodeId,
      page: "script",
      objectKind: "SCRIPT_SCENE",
      objectId: script.content.scenes[0]!.scene_id,
      versionId,
      headRevision: 2,
      contentHash: hash,
    });
    expect(selected.selection.excerpt).toContain("留在房间");
    expect(selected.selection.excerpt.length).toBeLessThanOrEqual(4000);
    expect(JSON.stringify(selected)).not.toContain("source_extraction_version_id");
    expect(assistantChatReferences(selected, true)).toEqual([
      {
        objectKind: "SCRIPT_SCENE",
        objectId: script.content.scenes[0]!.scene_id,
        versionId,
        contentHash: hash,
        headRevision: 2,
      },
    ]);
    expect(JSON.stringify(assistantChatReferences(selected, true))).not.toContain("留在房间");
    expect(assistantChatReferences(selected, false)).toEqual([]);
  });

  it("withholds dirty, failed and director-view content", () => {
    expect(
      buildScriptSelection({
        projectId,
        episodeId,
        version: script,
        selectedSceneId: null,
        dirty: true,
        readState: "ready",
      }).kind,
    ).toBe("UNSAVED");
    expect(
      buildCreativeSelection({
        projectId,
        episodeId,
        kind: "world",
        version: creative,
        selectedId: null,
        dirty: false,
        readState: "error",
      }).kind,
    ).toBe("UNAVAILABLE");
    expect(
      buildStoryboardSelection({
        projectId,
        episodeId,
        version: storyboard,
        selectedShotId: storyboard.content.shots[0]!.shot_id,
        dirty: false,
        readState: "ready",
        directorView: true,
      }).kind,
    ).toBe("DIRECTOR_VIEW");
  });

  it("uses only the selected storyboard shot or creative object, truncating long saved text", () => {
    const shot = buildStoryboardSelection({
      projectId,
      episodeId,
      version: storyboard,
      selectedShotId: storyboard.content.shots[0]!.shot_id,
      dirty: false,
      readState: "ready",
      directorView: false,
    });
    const character = buildCreativeSelection({
      projectId,
      episodeId,
      kind: "characters",
      version: creative,
      selectedId: creative.content.characters[0]!.character_id,
      dirty: false,
      readState: "ready",
    });
    expect(shot.kind).toBe("AVAILABLE");
    expect(character.kind).toBe("AVAILABLE");
    if (shot.kind === "AVAILABLE") expect(shot.selection.excerpt).toContain("街角");
    if (character.kind === "AVAILABLE") expect(character.selection.excerpt).toContain("寻找故乡");
    const long = {
      ...creative,
      content: {
        ...creative.content,
        world: { ...creative.content.world, premise: "长".repeat(8000) },
      },
    } as CreativeVersion;
    const world = buildCreativeSelection({
      projectId,
      episodeId,
      kind: "world",
      version: long,
      selectedId: null,
      dirty: false,
      readState: "ready",
    });
    expect(world.kind).toBe("AVAILABLE");
    if (world.kind === "AVAILABLE") {
      expect(world.selection.excerpt.length).toBeLessThanOrEqual(4000);
      expect(world.selection.excerpt).toContain("已截断");
    }
  });

  it("never substitutes the first object for a missing or stale selection", () => {
    expect(
      buildScriptSelection({
        projectId,
        episodeId,
        version: script,
        selectedSceneId: null,
        dirty: false,
        readState: "ready",
      }).kind,
    ).toBe("NONE");
    expect(
      buildStoryboardSelection({
        projectId,
        episodeId,
        version: storyboard,
        selectedShotId: `shp_${"9".repeat(32)}`,
        dirty: false,
        readState: "ready",
        directorView: false,
      }).kind,
    ).toBe("NONE");
    expect(
      buildCreativeSelection({
        projectId,
        episodeId,
        kind: "characters",
        version: creative,
        selectedId: null,
        dirty: false,
        readState: "ready",
      }).kind,
    ).toBe("NONE");
  });

  it("handles the saved creative scene and refuses empty world text or mismatched heads", () => {
    const scene = buildCreativeSelection({
      projectId,
      episodeId,
      kind: "scenes",
      version: creative,
      selectedId: creative.content.scenes[0]!.scene_id,
      dirty: false,
      readState: "ready",
    });
    expect(scene.kind).toBe("AVAILABLE");
    if (scene.kind === "AVAILABLE") expect(scene.selection.objectKind).toBe("CREATIVE_SCENE");
    const emptyWorld = {
      ...creative,
      content: {
        ...creative.content,
        world: { premise: "", rules: "", era: "", visual_style: "", palette: "", materials: "" },
      },
    } as CreativeVersion;
    expect(
      buildCreativeSelection({
        projectId,
        episodeId,
        kind: "world",
        version: emptyWorld,
        selectedId: null,
        dirty: false,
        readState: "ready",
      }).kind,
    ).toBe("NONE");
    expect(
      buildScriptSelection({
        projectId,
        episodeId,
        version: { ...script, project_id: `prj_${"9".repeat(32)}` },
        selectedSceneId: script.content.scenes[0]!.scene_id,
        dirty: false,
        readState: "ready",
      }).kind,
    ).toBe("UNAVAILABLE");
    expect(
      buildStoryboardSelection({
        projectId,
        episodeId,
        version: { ...storyboard, episode_id: `ep_${"9".repeat(32)}` },
        selectedShotId: storyboard.content.shots[0]!.shot_id,
        dirty: false,
        readState: "ready",
        directorView: false,
      }).kind,
    ).toBe("UNAVAILABLE");
    expect(
      buildCreativeSelection({
        projectId,
        episodeId,
        kind: "characters",
        version: { ...creative, project_id: `prj_${"9".repeat(32)}` },
        selectedId: creative.content.characters[0]!.character_id,
        dirty: false,
        readState: "ready",
      }).kind,
    ).toBe("UNAVAILABLE");
  });
});

function Publisher({ publication }: { publication: AssistantSelectionPublication }) {
  usePublishAssistantSelection(publication);
  return null;
}
let latest: ReturnType<typeof useAssistantSelection>;
function Reader() {
  latest = useAssistantSelection();
  return (
    <p>
      {latest.publication.kind}:{latest.included ? "included" : "excluded"}
    </p>
  );
}
const scope: AssistantSelectionScope = { fixture: false, projectId, episodeId, page: "script" };
describe("assistant selection provider", () => {
  it("requires explicit inclusion and invalidates approval when the saved version changes", () => {
    const publication = buildScriptSelection({
      projectId,
      episodeId,
      version: script,
      selectedSceneId: script.content.scenes[0]!.scene_id,
      dirty: false,
      readState: "ready",
    });
    const view = render(
      <AssistantSelectionProvider scope={scope}>
        <Publisher publication={publication} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    expect(screen.getByText("AVAILABLE:excluded")).toBeInTheDocument();
    act(() => latest.setIncluded(true));
    expect(screen.getByText("AVAILABLE:included")).toBeInTheDocument();
    const changed = buildScriptSelection({
      projectId,
      episodeId,
      version: { ...script, content_hash: `sha256:${"e".repeat(64)}` },
      selectedSceneId: script.content.scenes[0]!.scene_id,
      dirty: false,
      readState: "ready",
    });
    view.rerender(
      <AssistantSelectionProvider scope={scope}>
        <Publisher publication={changed} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    expect(screen.getByText("AVAILABLE:excluded")).toBeInTheDocument();
    act(() => latest.setIncluded(true));
    act(() => latest.setIncluded(false));
    expect(screen.getByText("AVAILABLE:excluded")).toBeInTheDocument();
  });

  it("does not revive a cancelled reference after a dirty draft returns to the same saved version", () => {
    const publication = buildScriptSelection({
      projectId,
      episodeId,
      version: script,
      selectedSceneId: script.content.scenes[0]!.scene_id,
      dirty: false,
      readState: "ready",
    });
    const dirty = buildScriptSelection({
      projectId,
      episodeId,
      version: script,
      selectedSceneId: script.content.scenes[0]!.scene_id,
      dirty: true,
      readState: "ready",
    });
    const view = render(
      <AssistantSelectionProvider scope={scope}>
        <Publisher publication={publication} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    act(() => latest.setIncluded(true));
    view.rerender(
      <AssistantSelectionProvider scope={scope}>
        <Publisher publication={dirty} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    expect(screen.getByText("UNSAVED:excluded")).toBeInTheDocument();
    view.rerender(
      <AssistantSelectionProvider scope={scope}>
        <Publisher publication={publication} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    expect(screen.getByText("AVAILABLE:excluded")).toBeInTheDocument();
  });

  it("does not expose fixture or stale project/page publications", () => {
    const publication = buildScriptSelection({
      projectId,
      episodeId,
      version: script,
      selectedSceneId: script.content.scenes[0]!.scene_id,
      dirty: false,
      readState: "ready",
    });
    const view = render(
      <AssistantSelectionProvider scope={{ ...scope, fixture: true }}>
        <Publisher publication={publication} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    expect(screen.getByText("NONE:excluded")).toBeInTheDocument();
    view.rerender(
      <AssistantSelectionProvider scope={{ ...scope, projectId: `prj_${"9".repeat(32)}` }}>
        <Publisher publication={publication} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    expect(screen.getByText("NONE:excluded")).toBeInTheDocument();
    view.rerender(
      <AssistantSelectionProvider scope={{ ...scope, page: "storyboard" }}>
        <Publisher publication={publication} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    expect(screen.getByText("NONE:excluded")).toBeInTheDocument();
  });

  it("revokes an approved reference after leaving and returning to the same scope", () => {
    const publication = buildScriptSelection({
      projectId,
      episodeId,
      version: script,
      selectedSceneId: script.content.scenes[0]!.scene_id,
      dirty: false,
      readState: "ready",
    });
    const view = render(
      <AssistantSelectionProvider scope={scope}>
        <Publisher publication={publication} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    act(() => latest.setIncluded(true));
    expect(screen.getByText("AVAILABLE:included")).toBeInTheDocument();
    view.rerender(
      <AssistantSelectionProvider scope={{ ...scope, episodeId: `ep_${"9".repeat(32)}` }}>
        <Publisher publication={publication} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    expect(screen.getByText("NONE:excluded")).toBeInTheDocument();
    view.rerender(
      <AssistantSelectionProvider scope={scope}>
        <Publisher publication={publication} />
        <Reader />
      </AssistantSelectionProvider>,
    );
    expect(screen.getByText("AVAILABLE:excluded")).toBeInTheDocument();
  });
});
