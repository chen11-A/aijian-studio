import { expect, it } from "vitest";
import { upgradeFilm } from "../../film/project";
import { createFilmPersistence } from "../film-persistence";
import { groupNativeResult } from "../audio-suggestion-group.test-fixture";
import { soundFilm, soundPlan } from "../shot-audio-suggestions.test-fixture";
import { historyRecordHash } from "./persistent-history";
import {
  settleLibraryWrite,
  type LibraryHost,
  type PendingGroupLibraryWrite,
} from "./audio-library";
it.each(["return-original", "edit-original-return-foreign"])(
  "keeps recovery pending if %s happens across foreign draft hashing",
  async (change) => {
    const before = soundFilm(),
      other = { ...structuredClone(before), id: "other-group-guard" };
    let live = before;
    const persistence = createFilmPersistence({
      current: () => live,
      write: async (film) => structuredClone(film),
    });
    const lease = await persistence.acquire(before.id);
    await lease.save(before, () => true);
    lease.beginExternalWrite!(() => true);
    // A distinct but content-equal held draft must be hashed, creating a real await boundary.
    live = structuredClone(before);
    persistence.externalWriteState(before.id);
    live = other;
    const basic = {
        projectId: before.id,
        expectedProjectHash: await historyRecordHash(before),
        shotId: before.shots[0]!.id,
        takeId: before.shots[0]!.selectedTakeId!,
      },
      plan = soundPlan(basic),
      input = {
        ...basic,
        catalogSha256: plan.catalogSha256,
        pickerSha256: plan.pickerSha256,
        planFingerprint: plan.planFingerprint,
        lanes: ["sfx"] as "sfx"[],
      };
    const result = await groupNativeResult(
        before as unknown as Record<string, unknown>,
        plan,
        input,
      ),
      saved = upgradeFilm(result.project)!;
    const pending: PendingGroupLibraryWrite = {
      kind: "group",
      before,
      canonicalBefore: before,
      rawBefore: structuredClone(before) as unknown as Record<string, unknown>,
      hash: basic.expectedProjectHash,
      selection: { projectId: before.id, page: "edit", shotId: input.shotId, takeId: input.takeId },
      input,
      plan,
      settled: true,
      receiptClaimed: true,
      expectedReceipt: result.receipt,
    };
    let observing = true,
      armed = false;
    const lateDraft = { ...before, title: "微任务间隙保留的新稿" };
    const host: LibraryHost = {
      current: () => {
        const current = live;
        if (armed) {
          armed = false;
          observing = false;
          queueMicrotask(() => {
            live = lateDraft;
            if (change === "edit-original-return-foreign") {
              persistence.externalWriteState(before.id);
              live = other;
            }
          });
        }
        return current;
      },
      selection: () => pending.selection,
      apply: (film) => (live = film),
      persistence: {
        ...persistence,
        externalWriteState: (id) => {
          const state = persistence.externalWriteState(id);
          if (observing) armed = true;
          return state;
        },
      },
    };
    const outcome = await settleLibraryWrite(host, pending, lease, saved, result.project);
    await lease.release();
    expect(outcome.kind).toBe("unknown");
    expect(persistence.externalWriteState(before.id)?.status).toBe("unknown");
    expect(persistence.externalWriteState(before.id)?.draft.title).toBe(lateDraft.title);
    expect(live).toBe(change === "return-original" ? lateDraft : other);
    expect((await persistence.flushAll()).status).toBe("unknown");
  },
);
