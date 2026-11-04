import { describe, expect, it, vi } from "vitest";
import { readAssistantContext, type AssistantContextClient } from "./assistant-chat-context";

const projectId = "prj_" + "a".repeat(32);
const episodeId = "ep_" + "b".repeat(32);
const versionId = "ver_" + "c".repeat(32);
const creativeVersionId = "ver_" + "d".repeat(32);
const contentHash = "sha256:" + "e".repeat(64);
const creativeHash = "sha256:" + "f".repeat(64);
const shotId = "shp_" + "1".repeat(32);
const characterId = "chr_" + "2".repeat(32);
const locationId = "loc_" + "3".repeat(32);
const scope = { projectId, episodeId, page: "storyboard" };
const shot = (id: string, ordinal: number) => ({
  shot_id: id,
  ordinal,
  title: `镜头${ordinal}`,
  description: "夜色中的对峙",
  action: "靠近",
  dialogue: "停下",
  camera: "近景",
  character_ids: ordinal === 2 ? [characterId] : [],
  location_id: ordinal === 2 ? locationId : null,
});
const storyboard = {
  kind: "FOUND",
  receipt: {
    data: {
      version_id: versionId,
      head_revision: 2,
      content_hash: contentHash,
      content: {
        creative_library_version_id: creativeVersionId,
        shots: [
          shot("shp_" + "0".repeat(32), 1),
          shot(shotId, 2),
          shot("shp_" + "4".repeat(32), 3),
        ],
      },
    },
  },
};
const creative = {
  kind: "FOUND",
  receipt: {
    data: {
      version_id: creativeVersionId,
      head_revision: 1,
      content_hash: creativeHash,
      content: {
        characters: [
          {
            character_id: characterId,
            name: "林",
            role: "主角",
            description: "谨慎",
            appearance: "黑衣",
            personality: "坚韧",
          },
        ],
        scenes: [
          {
            scene_id: locationId,
            name: "巷口",
            location: "旧城",
            description: "狭窄",
            time_of_day: "夜",
            weather: "雨",
            continuity: "门未开",
          },
        ],
        world: {
          premise: "旧城",
          rules: "守约",
          era: "当代",
          visual_style: "写实",
          palette: "冷色",
          materials: "砖石",
        },
      },
    },
  },
};
function client(): AssistantContextClient {
  return {
    getProject: vi.fn(async () => ({ data: { id: projectId, name: "测试项目" } })),
    getEpisode: vi.fn(async () => ({
      data: { id: episodeId, project_id: projectId, title: "第一集" },
    })),
    getEpisodeScript: vi.fn(async () => ({ kind: "EMPTY" })),
    getEpisodeStoryboard: vi.fn(async () => storyboard),
    getProjectCreativeLibrary: vi.fn(async () => creative),
  } as unknown as AssistantContextClient;
}

describe("assistant saved context", () => {
  it("extracts the selected shot, neighbors and linked saved creative objects only", async () => {
    const source = client();
    const context = await readAssistantContext(source, scope, [
      {
        objectKind: "STORYBOARD_SHOT",
        objectId: shotId,
        versionId,
        contentHash,
        headRevision: 2,
      },
    ]);
    expect(context.text).toContain("镜头2");
    expect(context.text).toContain("相邻镜头");
    expect(context.text).toContain("关联角色");
    expect(context.text).toContain("关联场景");
    expect(context.includedSources).toHaveLength(5);
    expect(context.text.length).toBeLessThanOrEqual(12000);
    expect(source.getEpisodeScript).not.toHaveBeenCalled();
  });

  it("rejects missing selected objects and changed related library", async () => {
    const reference = {
      objectKind: "STORYBOARD_SHOT" as const,
      objectId: "shp_" + "9".repeat(32),
      versionId,
      contentHash,
      headRevision: 2,
    };
    await expect(readAssistantContext(client(), scope, [reference])).rejects.toThrow(
      "CONTEXT_OBJECT_MISSING",
    );
    const source = client();
    vi.mocked(source.getProjectCreativeLibrary).mockResolvedValue({
      ...creative,
      receipt: { data: { ...creative.receipt.data, version_id: "ver_" + "9".repeat(32) } },
    } as Awaited<ReturnType<typeof source.getProjectCreativeLibrary>>);
    await expect(
      readAssistantContext(source, scope, [{ ...reference, objectId: shotId }]),
    ).rejects.toThrow("CONTEXT_CHANGED");
  });

  it("keeps projectless chat free of project reads", async () => {
    const source = client();
    const context = await readAssistantContext(
      source,
      { projectId: null, episodeId: null, page: "home" },
      [],
    );
    expect(context.includedSources).toEqual([]);
    expect(source.getProject).not.toHaveBeenCalled();
  });

  it("extracts selected script scenes, adjacent headings and a precise script block", async () => {
    const source = client();
    const sceneId = "scn_" + "4".repeat(32);
    const blockId = "sblk_" + "5".repeat(32);
    vi.mocked(source.getEpisodeScript).mockResolvedValue({
      kind: "FOUND",
      receipt: {
        data: {
          version_id: versionId,
          head_revision: 2,
          content_hash: contentHash,
          content: {
            scenes: [
              {
                scene_id: "scn_" + "0".repeat(32),
                ordinal: 1,
                heading: "起",
                blocks: [
                  {
                    block_id: "sblk_" + "0".repeat(32),
                    ordinal: 1,
                    kind: "ACTION",
                    text: "开门",
                    speaker: null,
                  },
                ],
              },
              {
                scene_id: sceneId,
                ordinal: 2,
                heading: "承",
                blocks: [
                  { block_id: blockId, ordinal: 1, kind: "DIALOGUE", text: "别走", speaker: "林" },
                  {
                    block_id: "sblk_" + "6".repeat(32),
                    ordinal: 2,
                    kind: "ACTION",
                    text: "奔跑",
                    speaker: null,
                  },
                ],
              },
              { scene_id: "scn_" + "7".repeat(32), ordinal: 3, heading: "转", blocks: [] },
            ],
          },
        },
      },
    } as Awaited<ReturnType<typeof source.getEpisodeScript>>);
    const scene = await readAssistantContext(source, { ...scope, page: "script" }, [
      { objectKind: "SCRIPT_SCENE", objectId: sceneId, versionId, contentHash, headRevision: 2 },
    ]);
    expect(scene.text).toContain("相邻场次");
    expect(scene.text).toContain("林：别走");
    expect(scene.includedSources).toHaveLength(3);
    const block = await readAssistantContext(source, { ...scope, page: "script" }, [
      { objectKind: "SCRIPT_BLOCK", objectId: blockId, versionId, contentHash, headRevision: 2 },
    ]);
    expect(block.text).toContain("剧本块");
    expect(block.text).toContain("内容：别走");
  });

  it("extracts only selected creative objects from the saved library", async () => {
    const source = client();
    const projectScope = { projectId, episodeId: null, page: "world" };
    const characterReference = {
      objectKind: "CREATIVE_CHARACTER" as const,
      objectId: characterId,
      versionId: creativeVersionId,
      contentHash: creativeHash,
      headRevision: 1,
    };
    const references = [
      characterReference,
      {
        objectKind: "CREATIVE_SCENE" as const,
        objectId: locationId,
        versionId: creativeVersionId,
        contentHash: creativeHash,
        headRevision: 1,
      },
      {
        objectKind: "CREATIVE_WORLD" as const,
        objectId: "world",
        versionId: creativeVersionId,
        contentHash: creativeHash,
        headRevision: 1,
      },
    ];
    const context = await readAssistantContext(source, projectScope, references);
    expect(context.text).toContain("角色：林");
    expect(context.text).toContain("场景：巷口");
    expect(context.text).toContain("世界定位：旧城");
    expect(context.includedSources).toHaveLength(3);
    expect(source.getEpisode).not.toHaveBeenCalled();
    await expect(
      readAssistantContext(source, projectScope, [{ ...characterReference, contentHash }]),
    ).rejects.toThrow("CONTEXT_CHANGED");
  });

  it("marks absent linked library and truncates long selected content", async () => {
    const source = client();
    vi.mocked(source.getEpisodeStoryboard).mockResolvedValue({
      ...storyboard,
      receipt: {
        data: {
          ...storyboard.receipt.data,
          content: {
            ...storyboard.receipt.data.content,
            creative_library_version_id: null,
            shots: storyboard.receipt.data.content.shots.map((item) =>
              item.shot_id === shotId ? { ...item, description: "长".repeat(5000) } : item,
            ),
          },
        },
      },
    } as Awaited<ReturnType<typeof source.getEpisodeStoryboard>>);
    const context = await readAssistantContext(source, scope, [
      { objectKind: "STORYBOARD_SHOT", objectId: shotId, versionId, contentHash, headRevision: 2 },
    ]);
    expect(context.truncated).toBe(true);
    expect(context.text).toContain("[片段已截断]");
    expect(context.text).toContain("当前分镜未绑定角色与场景资料版本");
    expect(source.getProjectCreativeLibrary).not.toHaveBeenCalled();
  });

  it("rejects cross-project episode and changed storyboard head", async () => {
    const source = client();
    vi.mocked(source.getEpisode).mockResolvedValue({
      data: { id: episodeId, project_id: "prj_" + "9".repeat(32), title: "wrong" },
    } as Awaited<ReturnType<typeof source.getEpisode>>);
    await expect(readAssistantContext(source, scope, [])).rejects.toThrow("CONTEXT_SCOPE_INVALID");
    const other = client();
    await expect(
      readAssistantContext(other, scope, [
        {
          objectKind: "STORYBOARD_SHOT",
          objectId: shotId,
          versionId,
          contentHash: "sha256:" + "0".repeat(64),
          headRevision: 2,
        },
      ]),
    ).rejects.toThrow("CONTEXT_CHANGED");
  });

  it("omits later related sources when the bounded context is full", async () => {
    const source = client();
    vi.mocked(source.getEpisodeStoryboard).mockResolvedValue({
      ...storyboard,
      receipt: {
        data: {
          ...storyboard.receipt.data,
          content: {
            ...storyboard.receipt.data.content,
            shots: storyboard.receipt.data.content.shots.map((item) => ({
              ...item,
              description: "画".repeat(5000),
              action: "动".repeat(5000),
            })),
          },
        },
      },
    } as Awaited<ReturnType<typeof source.getEpisodeStoryboard>>);
    const context = await readAssistantContext(source, scope, [
      { objectKind: "STORYBOARD_SHOT", objectId: shotId, versionId, contentHash, headRevision: 2 },
    ]);
    expect(context.truncated).toBe(true);
    expect(context.text.length).toBeLessThanOrEqual(12000);
    expect(context.includedSources.length).toBeLessThan(5);
  });
});
