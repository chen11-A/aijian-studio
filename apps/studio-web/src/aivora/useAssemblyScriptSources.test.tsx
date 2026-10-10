import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as studio from "../api/studio";
import { useAssemblyScriptSources, type AssemblyScriptGateway } from "./useAssemblyScriptSources";
import type { ScriptBlock, ScriptVersion } from "./adapters/episodeScript";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const otherEpisode = `ep_${"c".repeat(32)}`;
const blockId = `sblk_${"d".repeat(32)}`;
function source(number = 1, episodeId = episode): ScriptVersion {
  return {
    version_id: `ver_${String(number).repeat(32)}`,
    project_id: project,
    episode_id: episodeId,
    version_number: number,
    head_revision: number,
    parent_version_id: null,
    content_hash: `sha256:${"e".repeat(64)}`,
    author_actor_id: "local-user",
    change_summary: "Saved script",
    created_at: "2026-10-08T06:00:00Z",
    content: {
      schema_version: "1.0.0",
      project_id: project,
      episode_id: episodeId,
      scenes: [
        {
          scene_id: `scn_${"f".repeat(32)}`,
          ordinal: 1,
          heading: "内景 · 码头 · 夜",
          blocks: [
            {
              block_id: blockId,
              ordinal: 1,
              kind: "DIALOGUE",
              text: "回来了。",
              speaker: "林夕",
              delivery: "OFF_SCREEN",
            },
          ],
        },
      ],
    },
  };
}
const found = (version: ScriptVersion, requestId = "read") => ({
  kind: "FOUND" as const,
  receipt: { data: version, request_id: requestId },
});
function gateway(latest = source(), pinned = source()): AssemblyScriptGateway {
  return {
    getEpisodeScript: vi.fn().mockResolvedValue(found(latest)),
    getEpisodeScriptVersion: vi.fn().mockResolvedValue(found(pinned)),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saved exact dialogue source reads", () => {
  it("uses the existing studio transport when no read gateway is supplied", async () => {
    const transport = { ...studio.createStudioTransport(), ...gateway() };
    vi.spyOn(studio, "createStudioTransport").mockReturnValue(transport);
    const { result } = renderHook(() => useAssemblyScriptSources(project, episode, undefined));
    await waitFor(() => expect(result.current.latest.state).toBe("ready"));
    expect(transport.getEpisodeScript).toHaveBeenCalledWith(project, episode);
  });

  it("reads saved latest and exact pin and derives the backend speaker identity", async () => {
    const saved = source();
    const api = gateway(saved, saved);
    const { result } = renderHook(() =>
      useAssemblyScriptSources(project, episode, saved.version_id, api),
    );
    expect(result.current.latest).toEqual({ state: "loading", version: null, dialogues: [] });
    await waitFor(() => expect(result.current.latest.state).toBe("ready"));
    expect(result.current.latest).toEqual({
      state: "ready",
      version: saved,
      dialogues: [
        {
          block: saved.content.scenes[0]!.blocks[0],
          scene: saved.content.scenes[0],
          speakerId: "spk_bc0090202dab5bd8d5f5fc81df3e48eb",
        },
      ],
    });
    expect(result.current.pinned).toEqual(result.current.latest);
    expect(api.getEpisodeScriptVersion).toHaveBeenCalledWith(project, episode, saved.version_id);
  });

  it("excludes ACTION and legacy DIALOGUE without explicit saved delivery", async () => {
    const saved = source();
    const scene = saved.content.scenes[0]!;
    scene.blocks.push(
      {
        block_id: `sblk_${"1".repeat(32)}`,
        ordinal: 2,
        kind: "ACTION",
        text: "转身。",
        speaker: null,
      },
      {
        block_id: `sblk_${"2".repeat(32)}`,
        ordinal: 3,
        kind: "DIALOGUE",
        text: "旧台词。",
        speaker: "林夕",
      },
      {
        block_id: `sblk_${"3".repeat(32)}`,
        ordinal: 4,
        kind: "DIALOGUE",
        text: "另一句。",
        speaker: " 林夕 ",
        delivery: "ON_SCREEN",
      },
      {
        block_id: `sblk_${"4".repeat(32)}`,
        ordinal: 5,
        kind: "DIALOGUE",
        text: "旧空值。",
        speaker: "林夕",
        delivery: null,
      },
    );
    const api = gateway(saved);
    const { result } = renderHook(() => useAssemblyScriptSources(project, episode, undefined, api));
    await waitFor(() => expect(result.current.latest.state).toBe("ready"));
    expect(
      result.current.latest.dialogues.map(({ block, speakerId }) => [block.ordinal, speakerId]),
    ).toEqual([
      [1, "spk_bc0090202dab5bd8d5f5fc81df3e48eb"],
      [4, "spk_e9e48eccf8774f5b70689c6e047e2aa4"],
    ]);
    expect(result.current.pinned).toEqual({ state: "empty", version: null, dialogues: [] });
  });

  it("keeps a saved legacy-only version ready with no bindable rows", async () => {
    const saved = source();
    delete saved.content.scenes[0]!.blocks[0]!.delivery;
    vi.stubGlobal("crypto", undefined);
    const api = gateway(saved);
    const { result } = renderHook(() => useAssemblyScriptSources(project, episode, undefined, api));
    await waitFor(() => expect(result.current.latest.state).toBe("ready"));
    expect(result.current.latest.dialogues).toEqual([]);
  });

  it.each(["", " ", undefined, 4])("rejects malformed request_id %j", async (requestId) => {
    const api: AssemblyScriptGateway = {
      getEpisodeScript: vi
        .fn()
        .mockResolvedValue({ kind: "FOUND", receipt: { data: source(), request_id: requestId } }),
    };
    const { result } = renderHook(() => useAssemblyScriptSources(project, episode, undefined, api));
    await waitFor(() => expect(result.current.latest.state).toBe("error"));
    expect(result.current.latest.version).toBeNull();
    expect(result.current.latest.dialogues).toEqual([]);
  });

  it("rejects wrong project/episode and malformed speaker or script data", async () => {
    for (const change of [
      (value: ScriptVersion) => {
        value.project_id = `prj_${"0".repeat(32)}`;
      },
      (value: ScriptVersion) => {
        value.content.episode_id = otherEpisode;
      },
      (value: ScriptVersion) => {
        value.content.scenes[0]!.blocks[0]!.speaker = " ";
      },
      (value: ScriptVersion) => {
        value.content.scenes[0]!.blocks[0]!.block_id = "wrong";
      },
    ]) {
      const saved = source();
      change(saved);
      const api = gateway(saved);
      const view = renderHook(() => useAssemblyScriptSources(project, episode, undefined, api));
      await waitFor(() => expect(view.result.current.latest.state).toBe("error"));
      view.unmount();
    }
  });

  it("fails closed when exact dialogue hashing is unavailable or rejected", async () => {
    for (const crypto of [
      undefined,
      { subtle: { digest: vi.fn().mockRejectedValue(new Error("disabled")) } },
    ]) {
      vi.stubGlobal("crypto", crypto);
      const api = gateway();
      const view = renderHook(() =>
        useAssemblyScriptSources(project, episode, source().version_id, api),
      );
      await waitFor(() => expect(view.result.current.latest.state).toBe("error"));
      expect(view.result.current.pinned.state).toBe("error");
      expect(view.result.current.latest.dialogues).toEqual([]);
      view.unmount();
    }
  });

  it("does not substitute latest when an exact old pin is missing or has the wrong version", async () => {
    for (const pinned of [{ kind: "REMOTE_UNKNOWN" }, found(source(2))]) {
      const api = gateway(source(2));
      vi.mocked(api.getEpisodeScriptVersion!).mockResolvedValue(
        pinned as Awaited<
          ReturnType<NonNullable<AssemblyScriptGateway["getEpisodeScriptVersion"]>>
        >,
      );
      const view = renderHook(() =>
        useAssemblyScriptSources(project, episode, source().version_id, api),
      );
      await waitFor(() => expect(view.result.current.latest.state).toBe("ready"));
      expect(view.result.current.pinned).toEqual({ state: "error", version: null, dialogues: [] });
      view.unmount();
    }
  });

  it("returns errors for absent capabilities, unknown reads and exceptions while latest EMPTY stays empty", async () => {
    for (const { api, expected } of [
      { api: {}, expected: "error" },
      {
        api: {
          getEpisodeScript: vi.fn().mockRejectedValue(new Error("offline")),
          getEpisodeScriptVersion: vi.fn().mockRejectedValue(new Error("offline")),
        },
        expected: "error",
      },
      {
        api: { getEpisodeScript: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }) },
        expected: "error",
      },
      {
        api: { getEpisodeScript: vi.fn().mockResolvedValue({ kind: "EMPTY" }) },
        expected: "empty",
      },
    ] satisfies { api: AssemblyScriptGateway; expected: "error" | "empty" }[]) {
      const view = renderHook(() =>
        useAssemblyScriptSources(project, episode, source().version_id, api),
      );
      await waitFor(() => expect(view.result.current.latest.state).not.toBe("loading"));
      expect(view.result.current.latest.state).toBe(expected);
      expect(view.result.current.pinned.state).toBe("error");
      view.unmount();
    }
  });

  it.each(["version_number", "head_revision", "content_hash", "content"] as const)(
    "rejects inconsistent same-version %s while keeping exact pin",
    async (field) => {
      const latest = source();
      if (field === "content") latest.content.scenes[0]!.blocks[0]!.text = "不同台词。";
      else if (field === "content_hash") latest.content_hash = `sha256:${"f".repeat(64)}`;
      else latest[field] = 2;
      const api = gateway(latest);
      const { result } = renderHook(() =>
        useAssemblyScriptSources(project, episode, source().version_id, api),
      );
      await waitFor(() => expect(result.current.latest.state).toBe("error"));
      expect(result.current.pinned.state).toBe("ready");
    },
  );

  it("accepts equivalent content with reordered object keys and rejects latest older than pin", async () => {
    const latest = source();
    latest.content.scenes[0]!.blocks[0] = Object.fromEntries(
      Object.entries(latest.content.scenes[0]!.blocks[0]!).reverse(),
    ) as ScriptBlock;
    const api = gateway(latest);
    const view = renderHook(() =>
      useAssemblyScriptSources(project, episode, source().version_id, api),
    );
    await waitFor(() => expect(view.result.current.latest.state).toBe("ready"));
    view.unmount();
    const olderApi = gateway(source(), source(2));
    const older = renderHook(() =>
      useAssemblyScriptSources(project, episode, source(2).version_id, olderApi),
    );
    await waitFor(() => expect(older.result.current.latest.state).toBe("error"));
    expect(older.result.current.pinned.state).toBe("ready");
  });

  it("fences a late wrong-episode read and resets sources immediately on scope change", async () => {
    const first = deferred<ReturnType<typeof found>>();
    const api: AssemblyScriptGateway = {
      getEpisodeScript: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue({ kind: "EMPTY" }),
    };
    const { result, rerender } = renderHook(
      ({ episodeId }) => useAssemblyScriptSources(project, episodeId, undefined, api),
      { initialProps: { episodeId: episode } },
    );
    rerender({ episodeId: otherEpisode });
    expect(result.current.latest.state).toBe("loading");
    await waitFor(() => expect(result.current.latest.state).toBe("empty"));
    await act(async () => first.resolve(found(source())));
    expect(result.current.latest).toEqual({ state: "empty", version: null, dialogues: [] });
  });

  it("fences a late exact-pin reply when selection changes", async () => {
    const first = deferred<ReturnType<typeof found>>();
    const api = gateway(source(2), source(2));
    vi.mocked(api.getEpisodeScriptVersion!).mockReturnValueOnce(first.promise);
    const { result, rerender } = renderHook(
      ({ pin }) => useAssemblyScriptSources(project, episode, pin, api),
      { initialProps: { pin: source().version_id } },
    );
    rerender({ pin: source(2).version_id });
    await waitFor(() => expect(result.current.pinned.state).toBe("ready"));
    await act(async () => first.resolve(found(source())));
    expect(result.current.pinned.version?.version_id).toBe(source(2).version_id);
  });

  it("fences hashing that completes after an episode change", async () => {
    const firstDigest = deferred<ArrayBuffer>();
    const digest = vi
      .fn()
      .mockReturnValueOnce(firstDigest.promise)
      .mockImplementation(
        (algorithm: AlgorithmIdentifier, bytes: Parameters<typeof webcrypto.subtle.digest>[1]) =>
          webcrypto.subtle.digest(algorithm, bytes),
      );
    vi.stubGlobal("crypto", { subtle: { digest } });
    const firstSource = source();
    const nextSource = source(2, otherEpisode);
    const api: AssemblyScriptGateway = {
      getEpisodeScript: vi
        .fn()
        .mockResolvedValueOnce(found(firstSource))
        .mockResolvedValueOnce(found(nextSource)),
    };
    const { result, rerender } = renderHook(
      ({ episodeId }) => useAssemblyScriptSources(project, episodeId, undefined, api),
      { initialProps: { episodeId: episode } },
    );
    await waitFor(() => expect(digest).toHaveBeenCalledOnce());
    rerender({ episodeId: otherEpisode });
    await waitFor(() => expect(result.current.latest.version?.episode_id).toBe(otherEpisode));
    await act(async () => firstDigest.resolve(new ArrayBuffer(32)));
    expect(result.current.latest.version?.episode_id).toBe(otherEpisode);
    expect(result.current.latest.version?.version_id).toBe(nextSource.version_id);
  });

  it("reuses one exact-label digest for repeated saved dialogue rows", async () => {
    const saved = source();
    saved.content.scenes[0]!.blocks.push({
      ...saved.content.scenes[0]!.blocks[0]!,
      block_id: `sblk_${"0".repeat(32)}`,
      ordinal: 2,
      delivery: "ON_SCREEN",
    });
    const digest = vi.fn(
      (algorithm: AlgorithmIdentifier, bytes: Parameters<typeof webcrypto.subtle.digest>[1]) =>
        webcrypto.subtle.digest(algorithm, bytes),
    );
    vi.stubGlobal("crypto", { subtle: { digest } });
    const api = gateway(saved);
    const { result } = renderHook(() => useAssemblyScriptSources(project, episode, undefined, api));
    await waitFor(() => expect(result.current.latest.state).toBe("ready"));
    expect(result.current.latest.dialogues).toHaveLength(2);
    expect(digest).toHaveBeenCalledOnce();
    expect(result.current.latest.dialogues[0]!.speakerId).toBe(
      result.current.latest.dialogues[1]!.speakerId,
    );
  });

  it("refresh hides old ready rows and fences the earlier request", async () => {
    const pending = deferred<ReturnType<typeof found>>();
    const api = gateway();
    const { result } = renderHook(() => useAssemblyScriptSources(project, episode, undefined, api));
    await waitFor(() => expect(result.current.latest.state).toBe("ready"));
    vi.mocked(api.getEpisodeScript!)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(found(source(2)));
    act(() => result.current.refresh());
    expect(result.current.latest.state).toBe("loading");
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.latest.version?.version_id).toBe(source(2).version_id),
    );
    await act(async () => pending.resolve(found(source())));
    expect(result.current.latest.version?.version_id).toBe(source(2).version_id);
  });

  it("hides prior ready data when the supplied gateway changes and ignores reads after unmount", async () => {
    const firstApi = gateway();
    const next = deferred<ReturnType<typeof found>>();
    const secondApi: AssemblyScriptGateway = {
      getEpisodeScript: vi.fn().mockReturnValue(next.promise),
    };
    const { result, rerender, unmount } = renderHook(
      ({ api }) => useAssemblyScriptSources(project, episode, undefined, api),
      { initialProps: { api: firstApi } },
    );
    await waitFor(() => expect(result.current.latest.state).toBe("ready"));
    rerender({ api: secondApi });
    expect(result.current.latest.state).toBe("loading");
    unmount();
    await act(async () => next.resolve(found(source(2))));
    expect(result.current.latest.state).toBe("loading");
  });
});
