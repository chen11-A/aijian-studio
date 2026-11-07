import { expect, it, vi } from "vitest";
import { upgradeFilm, type FilmProject } from "../../film/project";
import { createFilmPersistence } from "../film-persistence";
import { soundFilm, soundPlan } from "../shot-audio-suggestions.test-fixture";
import { historyRecordHash } from "./persistent-history";
import { addLibraryAsset, type LibraryHost } from "./audio-library";
it.each(["return-original", "edit-original-return-foreign"])(
  "keeps single-asset recovery reachable if %s crosses foreign retained-draft hashing",
  async (change) => {
    const initial = soundFilm(),
      selection = {
        projectId: initial.id,
        page: "edit",
        shotId: initial.shots[0]!.id,
        takeId: initial.shots[0]!.selectedTakeId!,
      };
    const asset = soundPlan({ ...selection, expectedProjectHash: "e".repeat(64) }).clips[1]!.asset;
    const other = {
      ...structuredClone(initial),
      id: "foreign-single-project",
      title: "另一作品保持不变",
    };
    let live = initial,
      raw: Record<string, unknown> = structuredClone(initial) as unknown as Record<string, unknown>;
    let returned = false,
      observing = true,
      armed = false,
      latestDraft: FilmProject | undefined;
    const write = vi.fn(async (film: FilmProject) => {
      raw = structuredClone(film) as unknown as Record<string, unknown>;
      return structuredClone(film);
    });
    const queue = createFilmPersistence({ current: () => live, write });
    const host: LibraryHost = {
      current: () => {
        const current = live;
        if (armed) {
          armed = false;
          observing = false;
          queueMicrotask(() => {
            latestDraft = { ...initial, title: "异步核对间隙的新稿" };
            live = latestDraft;
            if (change === "edit-original-return-foreign") {
              queue.externalWriteState(initial.id);
              live = other;
            }
          });
        }
        return current;
      },
      selection: () => selection,
      apply: (film) => (live = film),
      persistence: {
        ...queue,
        externalWriteState: (id) => {
          const state = queue.externalWriteState(id);
          if (returned && observing) armed = true;
          return state;
        },
      },
    };
    const add = vi.fn(
      async (input: {
        projectId: string;
        expectedProjectHash: string;
        shotId: string;
        takeId: string;
        lane: "sfx";
        placement: Record<string, unknown>;
      }) => {
        expect(input.expectedProjectHash).toBe(await historyRecordHash(raw));
        // Preserve an equal-content but distinct current draft before leaving the work.
        live = structuredClone(live);
        queue.externalWriteState(initial.id);
        live = other;
        raw = {
          ...raw,
          audioClips: [
            ...(raw.audioClips as unknown[]),
            {
              id: "single-owned-clip",
              shotId: input.shotId,
              takeId: input.takeId,
              lane: input.lane,
              label: asset.name,
              path: "/trusted/single-copy.ogg",
              enabled: true,
              ...input.placement,
              libraryAsset: {
                assetId: asset.id,
                sha256: asset.sha256,
                source: asset.source,
                author: asset.author,
                license: asset.license,
                loopable: asset.loopable,
                loudness: asset.loudness,
              },
            },
          ],
        };
        returned = true;
        return { kind: "ADDED", clipId: "single-owned-clip", project: structuredClone(raw) };
      },
    );
    const previous = window.aijian;
    window.aijian = {
      readFilmProject: async () => structuredClone(raw),
      inspectBundledFilmAudioTarget: async (input: {
        projectId: string;
        shotId: string;
        takeId: string;
        expectedProjectHash: string;
      }) => ({
        kind: "TARGET",
        projectId: input.projectId,
        shotId: input.shotId,
        takeId: input.takeId,
        projectHash: input.expectedProjectHash,
        durationSeconds: 8,
      }),
      addBundledFilmAudio: add,
    } as unknown as Window["aijian"];
    try {
      const outcome = await addLibraryAsset(
        host,
        { film: initial, selection, seconds: 8, hash: await historyRecordHash(raw) },
        asset,
        "a".repeat(64),
        {
          assetId: asset.id,
          lane: "sfx",
          placement: {
            startSeconds: 0,
            durationSeconds: 1,
            offsetSeconds: 0,
            gainDb: -5,
            loop: false,
          },
        },
      );
      expect(add).toHaveBeenCalledOnce();
      expect(outcome.kind).toBe("unknown");
      expect(outcome.pending).toBeDefined();
      expect(queue.externalWriteState(initial.id)?.status).toBe("unknown");
      expect(queue.externalWriteState(initial.id)?.draft.title).toBe(latestDraft!.title);
      expect(live).toBe(change === "return-original" ? latestDraft : other);
      expect(live.title).toBe(
        change === "return-original" ? "异步核对间隙的新稿" : "另一作品保持不变",
      );
      expect(upgradeFilm(raw)!.audioClips.some((c) => c.id === "single-owned-clip")).toBe(true);
      expect((await queue.flushAll()).status).toBe("unknown");
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      window.aijian = previous;
    }
  },
);
