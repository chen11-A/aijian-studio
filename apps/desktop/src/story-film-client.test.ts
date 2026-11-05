import { mkdtempSync, writeFileSync, truncateSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createStoryFilmClient, parseStoryFilmCreate } from "./story-film-client";

const origin = "http://127.0.0.1:56121";
const token = "t".repeat(43);
const projectId = `prj_${"a".repeat(32)}`;

describe("story film client", () => {
  it("plans and creates without putting a media token in the body", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          data: { status: "SUCCEEDED", message: "好了", live_call: false },
          request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = createStoryFilmClient(
      fetcher,
      { origin, token },
      () => "11111111-1111-4111-8111-111111111111",
    );
    await client.plan(projectId);
    const bearer = "media-secret";
    const created = await client.create(
      projectId,
      {
        scene_label: "灯塔夜班",
        narration: "雾散之前，不要回头。",
        subtitle: "雾城来信",
        provider: "grok_subscription",
        confirmed: false,
      },
      bearer,
    );
    expect(created).toMatchObject({ data: { status: "SUCCEEDED", live_call: false } });
    expect(JSON.stringify(created)).not.toContain(bearer);
    expect(calls[0]?.url).toBe(`${origin}/api/v1/projects/${projectId}/story-film/plan`);
    expect(calls[1]?.url).toBe(`${origin}/api/v1/projects/${projectId}/story-film`);
    const headers = calls[1]?.init?.headers as Record<string, string>;
    expect(headers["X-Aivora-Media-Bearer"]).toBe(bearer);
    expect(headers["Idempotency-Key"]).toBe("story-film:v1:11111111-1111-4111-8111-111111111111");
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(String(calls[1]?.init?.body)).not.toContain(bearer);
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      provider: "grok_subscription",
      confirmed: false,
    });
  });

  it("surfaces a finished Chinese reason when the service responds with an error", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              status: "FAILED",
              message: "画面、视频和配音都已经做好。整理视频时没有成功，可以重试。",
            },
            request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
          }),
          { status: 500 },
        ),
    );
    const client = createStoryFilmClient(
      fetcher,
      { origin, token },
      () => "11111111-1111-4111-8111-111111111111",
    );
    await expect(client.progress(projectId)).rejects.toThrow("整理视频时没有成功");
  });

  it("sends regenerate only when the user asks for a new generation", async () => {
    const calls: { body?: string }[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: typeof init?.body === "string" ? init.body : undefined });
      return new Response(
        JSON.stringify({
          data: { status: "SUCCEEDED", message: "好了" },
          request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        }),
        { status: 200 },
      );
    });
    const client = createStoryFilmClient(
      fetcher,
      { origin, token },
      () => "11111111-1111-4111-8111-111111111111",
    );
    await client.create(projectId, {
      scene_label: "灯塔",
      narration: "一句旁白",
      provider: "stub",
      confirmed: false,
      regenerate: true,
    });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({ regenerate: true });
    expect(() =>
      parseStoryFilmCreate({
        scene_label: "灯塔",
        narration: "一句旁白",
        provider: "stub",
        confirmed: false,
        regenerate: "yes",
      }),
    ).toThrow("Invalid story film request");
  });

  it("sends a shot list and rejects a shot that is not a clip", () => {
    expect(
      parseStoryFilmCreate({
        scene_label: "雨夜巷战",
        narration: "林夏把阿凯推进巷口。",
        provider: "stub",
        confirmed: false,
        shots: [
          {
            narration: "林夏把阿凯推进巷口。",
            prompt: "全景，推一把。",
            subtitle: "林夏把阿凯推进巷口",
            duration_seconds: 5,
          },
        ],
      }).shots,
    ).toEqual([
      {
        narration: "林夏把阿凯推进巷口。",
        prompt: "全景，推一把。",
        subtitle: "林夏把阿凯推进巷口",
        duration_seconds: 5,
      },
    ]);
    expect(() =>
      parseStoryFilmCreate({
        scene_label: "雨夜巷战",
        narration: "一句旁白",
        provider: "stub",
        confirmed: false,
        shots: [
          {
            narration: "一句旁白",
            prompt: "全景",
            duration_seconds: 20,
          },
        ],
      }),
    ).toThrow("Invalid story film request");
  });

  it("keeps a draft video model and rejects a model id with spaces", () => {
    expect(
      parseStoryFilmCreate({
        scene_label: "灯塔",
        narration: "一句旁白",
        provider: "stub",
        confirmed: true,
        video_model: "grok-imagine-video-1.5-lite",
      }).video_model,
    ).toBe("grok-imagine-video-1.5-lite");
    expect(() =>
      parseStoryFilmCreate({
        scene_label: "灯塔",
        narration: "一句旁白",
        provider: "stub",
        confirmed: true,
        video_model: "not a model",
      }),
    ).toThrow("Invalid story film request");
  });

  it("keeps one style block and the shot fields", () => {
    const parsed = parseStoryFilmCreate({
      scene_label: "雨夜巷战",
      narration: "林夏把阿凯推进巷口。",
      provider: "stub",
      confirmed: true,
      style_block: " 冷色夜戏 ",
      shots: [
        {
          narration: "林夏把阿凯推进巷口。",
          prompt: "全景，推一把。",
          duration_seconds: 3,
          size: "全景",
          angle: "平视",
          move: "跟拍",
          action: "推一把",
          performance: "咬牙",
          identity: "林夏，短发",
        },
      ],
    });
    expect(parsed.style_block).toBe("冷色夜戏");
    expect(parsed.shots?.[0]).toMatchObject({
      size: "全景",
      angle: "平视",
      move: "跟拍",
      action: "推一把",
      performance: "咬牙",
      identity: "林夏，短发",
    });
  });

  it("keeps thirteen references and does not fail when more arrive", () => {
    const references = Array.from({ length: 16 }, (_, index) => `/tmp/face-${index}.png`);
    const parsed = parseStoryFilmCreate({
      scene_label: "雨夜",
      narration: "一句旁白",
      provider: "stub",
      confirmed: true,
      shots: [
        {
          narration: "一句旁白",
          prompt: "全景",
          duration_seconds: 3,
          references,
        },
      ],
    });
    expect(parsed.shots?.[0]?.references).toEqual(references.slice(0, 13));
  });

  it("rejects a request that tries to carry a token field", () => {
    expect(() =>
      parseStoryFilmCreate({
        scene_label: "灯塔",
        narration: "一句旁白",
        provider: "stub",
        confirmed: false,
        mediaBearer: "nope",
      }),
    ).toThrow("Invalid story film request");
  });
});

describe("referenced first-frame guard", () => {
  const input = {
    scene_label: "回归场景",
    narration: "回归台词",
    provider: "grok_subscription" as const,
    confirmed: true,
  };
  const shot = {
    narration: "回归台词",
    prompt: "回归画面",
    duration_seconds: 3,
    references: ["https://example.invalid/portrait.png"],
  };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  it.each([
    "http://example.invalid/start.png",
    "data:image/png;base64,aW1hZ2U=",
    "blob:fixture",
    "relative.png",
    "/missing/p3j-first-frame.png",
  ])("stops referenced video before sending an unusable first frame: %s", (still) => {
    const fetcher = vi.fn();
    const client = createStoryFilmClient(fetcher, { origin, token });
    expect(() => client.create(projectId, { ...input, shots: [{ ...shot, still }] })).toThrow(
      "请先用定妆照生成本地首帧",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects empty, oversized, non-image, directory, and deleted local files", () => {
    const root = mkdtempSync(join(tmpdir(), "p3j-frame-"));
    try {
      const empty = join(root, "empty.png");
      const large = join(root, "large.png");
      const wrong = join(root, "wrong.mp4");
      const deleted = join(root, "deleted.png");
      for (const path of [empty, large, wrong, deleted]) writeFileSync(path, png);
      truncateSync(empty, 0);
      truncateSync(large, 12_000_001);
      rmSync(deleted);
      const fetcher = vi.fn();
      const client = createStoryFilmClient(fetcher, { origin, token }, undefined, [root]);
      for (const still of [empty, large, wrong, root, deleted]) {
        expect(() => client.create(projectId, { ...input, shots: [{ ...shot, still }] })).toThrow(
          "请先用定妆照生成本地首帧",
        );
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a real local first frame with all thirteen portrait references kept separate", async () => {
    const root = mkdtempSync(join(tmpdir(), "p3j-frame-"));
    try {
      const still = join(root, "start.png");
      writeFileSync(still, png);
      const references = Array.from(
        { length: 13 },
        (_, index) => `https://example.invalid/portrait-${index}.png`,
      );
      let expectedStill = still;
      const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body)).shots).toMatchObject([
          { still: expectedStill, references },
        ]);
        return Response.json({ data: {}, request_id: "fixture" });
      });
      const client = createStoryFilmClient(fetcher, { origin, token }, undefined, [root]);
      for (const source of [still, `aivora-media://local/?path=${encodeURIComponent(still)}`]) {
        expectedStill = source;
        await client.create(projectId, {
          ...input,
          shots: [{ ...shot, still: source, references }],
        });
      }
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("also protects the legacy singular reference and other live providers, but allows stub", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: {}, request_id: "fixture" }));
    const client = createStoryFilmClient(fetcher, { origin, token });
    const legacy = {
      narration: "台词",
      prompt: "画面",
      duration_seconds: 3,
      reference: "https://example.invalid/portrait.png",
      still: "/missing/local.png",
    };
    for (const provider of ["grok_subscription", "xai_api_key", "chatgpt"] as const) {
      expect(() => client.create(projectId, { ...input, provider, shots: [legacy] })).toThrow(
        "请先用定妆照生成本地首帧",
      );
    }
    expect(fetcher).not.toHaveBeenCalled();
    await client.create(projectId, { ...input, provider: "stub", shots: [legacy] });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

it("preserves HTTPS or unspecified first frames for the server's referenced generation", async () => {
  const fetcher = vi.fn(async () => Response.json({ data: {}, request_id: "fixture" }));
  const client = createStoryFilmClient(fetcher, { origin, token });
  for (const still of [undefined, "https://example.invalid/first.png"]) {
    const input = parseStoryFilmCreate({
      scene_label: "回归",
      narration: "台词",
      provider: "grok_subscription",
      confirmed: true,
      shots: [
        {
          narration: "台词",
          prompt: "书店",
          duration_seconds: 3,
          still,
          references: ["https://example.invalid/face.png"],
        },
      ],
    });
    await client.create(projectId, input);
  }
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("preserves every dialogue line and stops mixed speakers before sending", () => {
  const fetcher = vi.fn();
  const client = createStoryFilmClient(fetcher, { origin, token });
  const lines = [
    { speaker: "甲", text: "第一句。" },
    { speaker: "乙", text: "第二句。" },
  ];
  const input = parseStoryFilmCreate({
    scene_label: "回归",
    narration: "第一句。第二句。",
    provider: "grok_subscription",
    confirmed: true,
    shots: [
      {
        narration: "第一句。第二句。",
        subtitle: "第一句。第二句。",
        prompt: "书店",
        duration_seconds: 3,
        lines,
      },
    ],
  });
  expect(input.shots?.[0]?.lines).toEqual(lines);
  expect(() => client.create(projectId, input)).toThrow(
    expect.objectContaining({ code: "MULTI_VOICE_REQUIRED" }),
  );
  expect(input.shots?.[0]?.subtitle).toBe("第一句。第二句。");
  expect(fetcher).not.toHaveBeenCalled();
  for (const invalid of [
    "bad",
    [{ speaker: "甲", text: "" }],
    [{ speaker: 3, text: "句" }],
    [{ speaker: "甲", text: "句", unknown: true }],
  ]) {
    expect(() =>
      parseStoryFilmCreate({ ...input, shots: [{ ...input.shots?.[0], lines: invalid }] }),
    ).toThrow("Invalid story film request");
  }
});

it("posts every multi-speaker line with its explicit voice and preserves dialogue order", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ data: { status: "SUCCEEDED" }, request_id: "test" })),
  );
  const client = createStoryFilmClient(fetcher, { origin, token });
  const lines = [
    { speaker: "甲", text: "第一句。还有一句。", voice_id: "leo" },
    { speaker: "乙", text: "第二句。", voice_id: "eve" },
    { speaker: "甲", text: "最后一句。", voice_id: "leo" },
  ];
  const input = parseStoryFilmCreate({
    scene_label: "回归",
    narration: "第一句。还有一句。第二句。最后一句。",
    provider: "grok_subscription",
    confirmed: true,
    shots: [{ narration: "全部台词", prompt: "书店", duration_seconds: 10, lines }],
  });
  await client.create(projectId, input);
  const calls = fetcher.mock.calls;
  expect(calls[0]![0]).toBe(`${origin}/api/v1/projects/${projectId}/story-film`);
  expect(JSON.parse(String(calls[0]![1]!.body)).shots[0].lines).toEqual(lines);
  expect((calls[0]![1]!.headers as Record<string, string>).Origin).toBe("app://aijian");
  expect((calls[0]![1]!.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
});

it("does not substitute a shot voice when one multi-speaker line has no voice", () => {
  const fetcher = vi.fn();
  const client = createStoryFilmClient(fetcher, { origin, token });
  const input = parseStoryFilmCreate({
    scene_label: "回归",
    narration: "第一句。第二句。",
    provider: "grok_subscription",
    confirmed: true,
    voice_id: "leo",
    shots: [
      {
        narration: "两句",
        prompt: "书店",
        duration_seconds: 5,
        voice_id: "leo",
        lines: [
          { speaker: "甲", text: "第一句。", voice_id: "leo" },
          { speaker: "乙", text: "第二句。" },
        ],
      },
    ],
  });
  expect(() => client.create(projectId, input)).toThrow(
    expect.objectContaining({ code: "MULTI_VOICE_REQUIRED" }),
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps legacy single-speaker requests without per-line voices", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: {}, request_id: "test" })));
  const client = createStoryFilmClient(fetcher, { origin, token });
  await client.create(
    projectId,
    parseStoryFilmCreate({
      scene_label: "回归",
      narration: "一句。又一句。",
      provider: "grok_subscription",
      confirmed: true,
      shots: [
        {
          narration: "一句。又一句。",
          prompt: "书店",
          duration_seconds: 5,
          voice_id: "leo",
          lines: [
            { speaker: "甲", text: "一句。" },
            { speaker: "甲", text: "又一句。" },
          ],
        },
      ],
    }),
  );
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([null, 3, {}, "", " ", "a".repeat(65), "leo\neve", "leo eve", "leo\0"])(
  "rejects malformed per-line voice %j without dropping the field",
  (voice_id) => {
    expect(() =>
      parseStoryFilmCreate({
        scene_label: "回归",
        narration: "一句。",
        provider: "grok_subscription",
        confirmed: true,
        shots: [
          {
            narration: "一句。",
            prompt: "书店",
            duration_seconds: 5,
            lines: [{ speaker: "甲", text: "一句。", voice_id }],
          },
        ],
      }),
    ).toThrow("Invalid story film request");
  },
);

it.each([
  { speaker: "甲".repeat(101), text: "一句。" },
  { speaker: "甲", text: "句".repeat(2001) },
  { speaker: "甲", text: 4 },
  { speaker: "甲", text: "一句。", voice_id: "leo", extra: "not allowed" },
])("retains strict speaker/text/field validation with per-line voices", (line) => {
  expect(() =>
    parseStoryFilmCreate({
      scene_label: "回归",
      narration: "一句。",
      provider: "grok_subscription",
      confirmed: true,
      shots: [{ narration: "一句。", prompt: "书店", duration_seconds: 5, lines: [line] }],
    }),
  ).toThrow("Invalid story film request");
});
