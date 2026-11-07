import { expect, vi } from "vitest";
import type { FilmGenerationExecutionGateway } from "@aijian/contracts/film-generation-execution";
import type { FilmProject } from "../film/project";
import { sceneLocationTargets } from "../film/location-reference";
import { historyRecordHash } from "./actions/persistent-history";

/** Synthetic native ABI for real-Pro consumer tests, not native source/ledger authorization.
 * Reads the fixture's actual saved record and rejects stale CAS; no provider or writes. */
export function generationExecutionFixture(read: (id: string) => Promise<unknown>) {
  let sequence = 0;
  return {
    prepareFilmGenerationExecution: vi.fn<
      FilmGenerationExecutionGateway["prepareFilmGenerationExecution"]
    >(async (input) => {
      const raw = await read(input.projectId);
      if (
        !raw ||
        typeof raw !== "object" ||
        Reflect.get(raw, "id") !== input.projectId ||
        (await historyRecordHash(raw)) !== input.expectedProjectHash
      )
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      const film = raw as FilmProject;
      expect(input.targets.length).toBeGreaterThan(0);
      const selected = input.targets.map((target) => {
        expect([1, 2, 3]).toContain(target.versions);
        const shot = film.shots.find((shot) => shot.id === target.shotId);
        expect(shot).toBeDefined();
        return shot!;
      });
      expect(new Set(selected.map((shot) => shot.id)).size).toBe(selected.length);
      expect(film.shots.filter((shot) => selected.includes(shot)).map((shot) => shot.id)).toEqual(
        input.targets.map((target) => target.shotId),
      );
      const executionId = `native-fixture-${++sequence}`;
      const stages = [
        ...sceneLocationTargets(film).map((place) => ({
          kind: "location-reference" as const,
          stageId: `location-${place.id}`,
          targetId: place.id,
        })),
        ...film.characters.flatMap((person) =>
          (["正面", "侧面", "背面", "脸部"] as const).map((view) => ({
            kind: "portrait" as const,
            stageId: `portrait-${person.id}-${view}`,
            targetId: person.id,
            view,
          })),
        ),
        ...selected.map((shot) => ({
          kind: "shot-frame" as const,
          stageId: `frame-${shot.id}`,
          targetId: shot.id,
        })),
        ...selected
          .filter((shot) => shot.continuityFromShotId)
          .map((shot) => ({
            kind: "continuity-frame" as const,
            stageId: `continuity-${shot.id}`,
            targetId: shot.id,
            sourceShotId: shot.continuityFromShotId!,
          })),
      ];
      // Match a real native CAS observation, not a receipt constructed from a later saved record.
      if ((await historyRecordHash(await read(input.projectId))) !== input.expectedProjectHash)
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      return {
        kind: "PREPARED",
        projectId: input.projectId,
        projectHash: input.expectedProjectHash,
        executionId,
        stages,
        targets: input.targets.map((target) => ({
          shotId: target.shotId,
          preparation: "CLIENT_IMAGES" as const,
          videoSlotIds: Array.from(
            { length: target.versions },
            (_, index) => `${executionId}-${target.shotId}-${index}`,
          ),
        })),
      };
    }),
    retireFilmGenerationExecution: vi.fn<
      FilmGenerationExecutionGateway["retireFilmGenerationExecution"]
    >(async () => ({ kind: "RETIRED" })),
  };
}
