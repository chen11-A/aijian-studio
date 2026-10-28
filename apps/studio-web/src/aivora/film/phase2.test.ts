import { describe, expect, it } from "vitest";
import {
  actionFromModel,
  actionSentence,
  agentIssues,
  artFromModel,
  classifyShotSize,
  durationFromSpeech,
  FILM_TEMPLATES,
  gazeHandoff,
  appearanceMark,
  attachScriptLines,
  identityLock,
  lineInScript,
  missingIdentityLocks,
  scenesEchoRequest,
  scriptDialogue,
  parseLooseJson,
  performanceFromModel,
  prompterFromModel,
  qcFromModel,
  SHOT_SIZES,
  soundFromDirector,
  speechSeconds,
  splitSpokenLine,
  withIdentityLocks,
} from "./phase2";

describe("phase 2 shot language", () => {
  it("keeps seven sizes and turns an insert into a tag", () => {
    expect(SHOT_SIZES).toHaveLength(7);
    expect(classifyShotSize("近景")).toEqual({ size: "近景", tag: "" });
    expect(classifyShotSize("插入")).toEqual({ size: "特写", tag: "插入" });
    expect(classifyShotSize("插入近景")).toEqual({ size: "近景", tag: "插入" });
    expect(classifyShotSize("大远景偏左")).toEqual({ size: "大远景", tag: "" });
    expect(classifyShotSize("主观")).toEqual({ size: "中景", tag: "主观" });
  });

  it("pastes one appearance sentence and flags a shot that dropped it", () => {
    const lock = identityLock("  年轻女性，二十多岁 ");
    expect(lock).toBe("年轻女性，二十多岁。");
    expect(identityLock("已经有句号。")).toBe("已经有句号。");
    expect(identityLock("  ")).toBe("");
    const prompt = withIdentityLocks(
      "雨夜巷口。",
      [{ name: "林雨", identity: "年轻女性，二十多岁" }],
      ["林雨"],
    );
    expect(prompt.prompt).toContain("年轻女性，二十多岁。");
    expect(prompt.missing).toEqual(["林雨"]);
    expect(
      missingIdentityLocks(
        [{ id: "s1", prompt: "雨夜巷口。", names: ["林雨"] }],
        [{ name: "林雨", identity: "年轻女性，二十多岁" }],
      ),
    ).toEqual([{ shotId: "s1", name: "林雨" }]);
    expect(
      missingIdentityLocks(
        [{ id: "s1", prompt: prompt.prompt, names: ["林雨"] }],
        [{ name: "林雨", identity: "年轻女性，二十多岁" }],
      ),
    ).toEqual([]);
  });

  it("writes a gaze handoff for two or more people", () => {
    expect(gazeHandoff(["林雨"])).toBe("");
    expect(gazeHandoff(["林雨", "周宁"])).toContain("视线从林雨交到周宁");
    expect(gazeHandoff(["林雨", "周宁", "店主"])).toContain("店主不抢视线");
    const kept = withIdentityLocks("视线已经写好。", [], ["林雨", "周宁"]);
    expect(kept.prompt).toBe("视线已经写好。");
  });

  it("keeps a line only when the script already has it", () => {
    expect(lineInScript("她说：雨太大。", "雨太大。")).toBe("雨太大。");
    expect(lineInScript("她说：雨太大。", "另写一句")).toBe("");
    expect(splitSpokenLine("雨太大。我听不清。")).toEqual(["雨太大。", "我听不清。"]);
    expect(splitSpokenLine("短")).toBeNull();
    expect(splitSpokenLine("没有句号的一长串台词")).toHaveLength(2);
  });

  it("sets the shot length from the spoken line and refuses past 15 seconds", () => {
    expect(speechSeconds("一二三四", null)).toBe(1);
    expect(speechSeconds("一二", 2.2)).toBe(2.2);
    expect(durationFromSpeech(2, 2).fits).toBe(true);
    expect(durationFromSpeech(2, 2).seconds).toBeGreaterThanOrEqual(3);
    expect(durationFromSpeech(20, 3).fits).toBe(false);
    expect(durationFromSpeech(0, 4).note).toContain("没有台词");
  });

  it("reads structured agent JSON and rejects a bare paragraph", () => {
    expect(parseLooseJson('前面 {"shots":[]} 后面')).toEqual({ shots: [] });
    expect(parseLooseJson("不是")).toBeNull();
    expect(agentIssues("director", { shots: [] })).toEqual([]);
    expect(agentIssues("writer", {})).toEqual(["编剧结果里没有场次"]);
    const action = actionFromModel({
      beats: [{ text: "抬手", feasibility: "难", workaround: "改成特写", at_seconds: 1 }],
    });
    expect(action?.[0]?.feasibility).toBe("难");
    expect(actionSentence(action ?? [])).toContain("来自动作指导");
    expect(actionFromModel({ beats: [] })).toBeNull();
    expect(
      performanceFromModel(
        [{ emotion: "冷静", face: ["皱眉"], eyes: "看向画右" }],
        ["林雨", "周宁"],
      ),
    ).toContain("视线");
    expect(performanceFromModel({ shots: [] }, [])).toBeNull();
    const art = artFromModel({
      prompt_block_zh: "冷色雨夜",
      identities: [{ name: "林雨", identity: "年轻女性" }],
      locations: [{ name: "巷口", prompt: "空镜", ambience: "雨" }],
      props: [{ name: "铁棍", note: "湿的" }],
    });
    expect(art?.lines.join(" ")).toContain("林雨");
    expect(artFromModel({})).toBeNull();
    expect(prompterFromModel({ keyframe: { prompt_zh: "中文", prompt_en: "English" } })).toEqual({
      zh: "中文",
      en: "English",
    });
    expect(prompterFromModel({ prompt_zh: "只有中文" })?.zh).toBe("只有中文");
    expect(qcFromModel({ verdict: "建议重做", issues: ["没有看到画面"] })?.lines[0]).toContain(
      "建议重做",
    );
    expect(qcFromModel({})).toBeNull();
    expect(
      soundFromDirector(
        { sound: { ambience: "雨", sfx: [{ text: "铁棍落地", at_seconds: 1 }], music: "紧张" } },
        "",
      ),
    ).toMatchObject({
      ambience: "雨",
      musicMood: "紧张",
      sfx: [{ text: "铁棍落地", atSeconds: 1 }],
    });
    expect(FILM_TEMPLATES.map((item) => item.name)).toEqual([
      "雨夜巷战打斗",
      "都市逆袭",
      "悬疑反转",
    ]);
  });

  it("skips empty rows and keeps a lock that is already in the prompt", () => {
    expect(
      missingIdentityLocks(
        [{ id: "s1", prompt: "年轻女性，二十多岁。", names: ["别人"] }],
        [
          { name: "林雨", identity: "年轻女性，二十多岁" },
          { name: "无名", identity: "  " },
        ],
      ),
    ).toEqual([]);
    const kept = withIdentityLocks(
      "雨夜",
      [
        { name: "林雨", identity: "年轻女性，二十多岁" },
        { name: "路过", identity: "" },
      ],
      ["林雨"],
    );
    expect(kept.missing).toEqual(["林雨"]);
    expect(kept.prompt.startsWith("雨夜。")).toBe(true);
    const again = withIdentityLocks(
      kept.prompt,
      [{ name: "林雨", identity: "年轻女性，二十多岁" }],
      ["林雨"],
    );
    expect(again.missing).toEqual([]);
    expect(parseLooseJson("{")).toBeNull();
    expect(parseLooseJson("{bad}")).toBeNull();
    expect(agentIssues("director", { scenes: [] })).toEqual(["导演结果里没有镜头"]);
    expect(agentIssues("writer", { scenes: [{ title: "雨停" }] })).toEqual([]);
    expect(agentIssues("action", { beats: [] })).toEqual(["动作结果里没有拍"]);
    expect(agentIssues("performance", [{ emotion: "冷静" }])).toEqual([]);
    expect(agentIssues("performance", { shots: [] })).toEqual(["表演结果里没有镜头"]);
    expect(agentIssues("art", null)).toEqual(["结果不是 JSON"]);
    expect(agentIssues("qc", { verdict: "可以" })).toEqual([]);
    expect(agentIssues("nope" as never, {})).toEqual(["没有这个智能体"]);
    expect(
      actionFromModel({ beats: [null, { text: "  " }, { text: "抬手", atSeconds: 1 }] }),
    ).toEqual([{ text: "抬手", feasibility: "稳", workaround: "", at: 0 }]);
    expect(performanceFromModel([null, { emotion: "" }], [])).toBeNull();
    expect(performanceFromModel([{ emotion: "冷静", eyes: "视线看向画右" }], [])).toBe(
      "冷静，视线看向画右",
    );
    expect(artFromModel([])).toBeNull();
    expect(
      artFromModel({
        identities: [null, { name: "林雨", identity_block_en: "short hair" }, { name: "" }],
        locations: [null, { prompt: "空" }, { name: "巷口" }],
        props: [null, { note: "湿" }, { name: "伞", note: "黑" }],
      })?.props,
    ).toEqual([{ name: "伞", note: "黑" }]);
    expect(prompterFromModel("文字")).toBeNull();
    expect(prompterFromModel({ keyframe: { prompt_en: "Only English" } })).toEqual({
      zh: "",
      en: "Only English",
    });
    expect(prompterFromModel([])).toBeNull();
    expect(qcFromModel([])).toBeNull();
    expect(qcFromModel({ issues: ["雨声"] })?.lines).toEqual(["雨声"]);
    expect(
      soundFromDirector({ sfx: [null, { text: "  " }, { text: "雨", atSeconds: 2 }] }, "巷"),
    ).toMatchObject({
      ambience: "巷",
      sfx: [{ text: "雨", atSeconds: 2 }],
    });
    expect(speechSeconds("", 0)).toBe(0);
    expect(lineInScript("原文", "  ")).toBe("");
  });

  it("copies a spoken line onto a shot and rejects a question echoed as scenes", () => {
    const script = "雨夜巷口。刀疤说：东西交出来。";
    expect(scriptDialogue(script)).toEqual([{ speaker: "刀疤", line: "东西交出来" }]);
    const shots = attachScriptLines(
      [{ line: "", characters: ["林骁"], picture: "刀疤开口" }],
      script,
    );
    expect(shots[0]).toMatchObject({
      line: "东西交出来",
      characters: ["林骁", "刀疤"],
      speaker: "刀疤",
    });
    expect(
      scenesEchoRequest(
        [{ text: "请把现有剧本分成。" }, { text: "请把现有剧本分成。还没完。" }],
        "请把现有剧本分成",
      ),
    ).toBe(true);
    expect(scenesEchoRequest([{ text: "雨夜巷口，刀疤拦住林骁。" }], "请把现有剧本分成")).toBe(
      false,
    );
    expect(
      appearanceMark(
        "年轻女性，二十多岁。",
        ["林雨"],
        [{ name: "林雨", identity: "年轻女性，二十多岁" }],
      ),
    ).toBe("外貌已锁");
    expect(
      appearanceMark("雨夜巷口。", ["林雨"], [{ name: "林雨", identity: "年轻女性，二十多岁" }]),
    ).toBe("缺外貌");
  });
});
