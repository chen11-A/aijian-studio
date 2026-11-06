import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { sampleFilm, type FilmProject } from "../film/project";
import {
  captureEpoch,
  captureFile,
  captureScope,
  capturedReplies,
  clearCapturedReplies,
  recordAgentReply,
  setCaptureEnabled,
} from "./agent-capture";
import { completeMembershipAgent } from "./agent-workflow";

const reply = '{"shots":[{"picture":"雨夜"}]}';
function film() {
  const base = sampleFilm();
  base.sourceText = "只用于哈希的测试正文，不应保存在采集记录。";
  base.scenes = [{ ...base.scenes[0]!, id: "same-scene", text: "只用于哈希的场次正文。" }];
  base.shots = [{ ...base.shots[0]!, id: "same-shot", sceneId: "same-scene" }];
  return base;
}
function membership(read: () => FilmProject | null, pending = false) {
  let release!: (value: unknown) => void;
  const completeText = pending
    ? vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
    : vi.fn().mockResolvedValue({ kind: "OK", text: reply });
  const host = {
    bridge: {
      status: vi
        .fn()
        .mockResolvedValue({ provider: "GROK_LOGIN", runtime: "DESKTOP", state: "CONNECTED" }),
      completeText,
    } as unknown as GrokLoginBridge,
    modelIds: ["grok-4.7"],
    billingProject: async () => `prj_${"a".repeat(32)}`,
    modelsChanged: vi.fn(),
    current: () => true,
    captureFilm: vi.fn(read),
  };
  return { host, completeText, finish: () => release({ kind: "OK", text: reply }) };
}
const request = (
  host: Parameters<typeof completeMembershipAgent>[3],
  agent: "director" | "action" | "writer" = "director",
) =>
  completeMembershipAgent(agent, '场次 id：same-scene\n镜头：[{"id":"same-shot"}]', "拆镜头", host);
async function keep(base: FilmProject, agent = "director", text = reply) {
  recordAgentReply(
    agent,
    '场次 id：same-scene\n镜头：[{"id":"same-shot"}]',
    "拆镜头",
    text,
    (await captureScope(base))!,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  setCaptureEnabled(true);
});
afterEach(() => {
  setCaptureEnabled(false);
  vi.restoreAllMocks();
});

describe("3JR-B11 capture ownership and request lifetime", () => {
  it("isolates identical scene/shot IDs across works, including action replies and repairs", async () => {
    const first = film();
    const second = { ...film(), id: "film_anothercapture001" };
    await keep(first);
    await keep(first, "action", "甲作品动作");
    expect(await captureFile(second)).toBeNull();
    await keep(second, "director", "乙作品导演");
    const file = await captureFile(second);
    expect(file?.text).toContain("乙作品导演");
    expect(file?.text).not.toContain("甲作品动作");
    expect(JSON.parse(file!.text).scenes).toEqual([{ sceneNo: 1, directorReply: "乙作品导演" }]);
    expect((await captureFile(first))?.text).toContain("甲作品动作");
  });

  it.each(["source", "scene"])(
    "refuses old replies after a %s text change instead of relabelling their source hash",
    async (field) => {
      const base = film();
      await keep(base);
      const changed = structuredClone(base);
      if (field === "source") changed.sourceText += "后来替换的小说";
      else changed.scenes[0]!.text += "后来改过的剧本";
      expect(await captureFile(changed)).toBeNull();
      expect((await captureFile(base))?.text).toContain("雨夜");
    },
  );

  it("cleans legacy/unowned data rather than attaching it to the active work", async () => {
    const base = film();
    await keep(base);
    const valid = capturedReplies()[0]!;
    window.localStorage.setItem(
      "aivora.agentCapture",
      JSON.stringify([
        valid,
        {
          agent: "director",
          kind: "first",
          sceneId: "same-scene",
          shotIds: [],
          at: "",
          reply: "无归属旧回复",
        },
        { ...valid, sourceSha256: "not-a-digest", reply: "坏指纹" },
      ]),
    );
    expect(capturedReplies()).toEqual([valid]);
    expect(window.localStorage.getItem("aivora.agentCapture")).not.toContain("无归属旧回复");
    expect((await captureFile(base))?.text).not.toContain("坏指纹");
    recordAgentReply("director", "场次 id：same-scene", "拆镜头", "缺归属的新回复");
    expect(capturedReplies()).toHaveLength(1);
  });

  it("stores IDs and digests without persisting source text, scene text or request context", async () => {
    const base = film();
    await keep(base);
    expect(capturedReplies()[0]).toMatchObject({
      projectId: base.id,
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      scriptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const raw = window.localStorage.getItem("aivora.agentCapture")!;
    expect(raw).not.toContain(base.sourceText);
    expect(raw).not.toContain(base.scenes[0]!.text);
    expect(raw).not.toContain("镜头：");
    expect(capturedReplies()[0]!.reply).toBe(reply);
  });

  it.each(["project", "source", "scene"])(
    "rejects a successful late reply when %s changed while the bridge was pending",
    async (field) => {
      let live = film();
      const env = membership(() => live, true);
      const pending = request(env.host);
      await vi.waitFor(() => expect(env.completeText).toHaveBeenCalledTimes(1));
      live = structuredClone(live);
      if (field === "project") live.id = "film_switchedcapture001";
      else if (field === "source") live.sourceText += "修改";
      else live.scenes[0]!.text += "修改";
      env.finish();
      expect((await pending).text).toBe(reply);
      expect(capturedReplies()).toEqual([]);
    },
  );

  it.each(["disable", "clear"])(
    "does not recreate cleared captures after %s and re-enable during a request",
    async (action) => {
      const base = film();
      await keep(base);
      const epoch = captureEpoch();
      const env = membership(() => base, true);
      const pending = request(env.host);
      await vi.waitFor(() => expect(env.completeText).toHaveBeenCalledTimes(1));
      if (action === "disable") {
        setCaptureEnabled(false);
        setCaptureEnabled(true);
      } else clearCapturedReplies();
      expect(captureEpoch()).toBeGreaterThan(epoch);
      env.finish();
      await pending;
      expect(capturedReplies()).toEqual([]);
      // A new request after re-enabling still records normally.
      await request(membership(() => base).host);
      expect(capturedReplies()).toHaveLength(1);
    },
  );

  it.each(["off", "writer"])(
    "does not compute hashes or read capture text for %s requests",
    async (mode) => {
      if (mode === "off") setCaptureEnabled(false);
      const env = membership(film);
      const digest = vi.spyOn(crypto.subtle, "digest");
      await request(env.host, mode === "writer" ? "writer" : "director");
      expect(env.host.captureFilm).not.toHaveBeenCalled();
      expect(digest).not.toHaveBeenCalled();
      expect(capturedReplies()).toEqual([]);
    },
  );

  it.each(["replace", "mutate", "media"])(
    "checks the live input after a %s during the final digest",
    async (mode) => {
      let live = film();
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      const releases: (() => void)[] = [];
      let calls = 0;
      vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) => {
        const value = digest(algorithm, data);
        calls += 1;
        return calls <= 2
          ? value
          : value.then(
              (result) =>
                new Promise<ArrayBuffer>((resolve) => {
                  releases.push(() => resolve(result));
                }),
            );
      });
      const pending = request(membership(() => live).host);
      await vi.waitFor(() => expect(releases).toHaveLength(2));
      if (mode === "replace" || mode === "media") live = structuredClone(live);
      if (mode === "media") live.shots[0]!.poster = "/tmp/updated-poster.png";
      else live.scenes[0]!.text += "最终核对期间修改";
      releases.forEach((release) => release());
      expect((await pending).text).toBe(reply);
      expect(capturedReplies()).toHaveLength(mode === "media" ? 1 : 0);
    },
  );

  it("does not export a captured snapshot after the switch was cleared during digest computation", async () => {
    const base = film();
    await keep(base);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const releases: (() => void)[] = [];
    vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) =>
      digest(algorithm, data).then(
        (value) =>
          new Promise<ArrayBuffer>((resolve) => {
            releases.push(() => resolve(value));
          }),
      ),
    );
    const pending = captureFile(base);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    setCaptureEnabled(false);
    setCaptureEnabled(true);
    releases.forEach((release) => release());
    expect(await pending).toBeNull();
  });

  it("assembles an export from the same input snapshot used for its digest", async () => {
    const base = film();
    await keep(base);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const releases: (() => void)[] = [];
    vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) =>
      digest(algorithm, data).then(
        (value) =>
          new Promise<ArrayBuffer>((resolve) => {
            releases.push(() => resolve(value));
          }),
      ),
    );
    const pending = captureFile(base);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    base.scenes[0]!.id = "changed-during-export";
    base.title = "changed-during-export";
    releases.forEach((release) => release());
    const file = await pending;
    expect(file?.scenes).toBe(1);
    expect(file?.text).not.toContain("changed-during-export");
    expect(JSON.parse(file!.text).sourceSha256).toBe(capturedReplies()[0]!.sourceSha256);
  });

  it("does not break a successful membership reply when hashing is unavailable", async () => {
    vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("digest unavailable"));
    expect((await request(membership(film).host)).text).toBe(reply);
    expect(capturedReplies()).toEqual([]);
    expect(await captureFile(film())).toBeNull();
  });
});
