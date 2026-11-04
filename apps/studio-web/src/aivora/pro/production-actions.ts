import { coverageNotice } from "../film/coverage-notice";
import type { FilmCharacter, FilmProject } from "../film/project";
import { autoVoiceForCharacter } from "../film/operations";
import type { UiNotice } from "../film/contracts3j";
import { NOTICE_TEXT } from "../film/notices";
import {
  fixCoverage as repairCoverage,
  RequestSequences,
  type RepairRequest,
} from "./director-workflow";
import { makeAllPortraits as generatePortraits } from "./portrait-workflow";
import { requestStill } from "./workflow";

/** Functional host API for Claude's controls; no display or alternate execution engine. */
export function createProductionActions(host: {
  current: () => FilmProject | null;
  apply: (film: FilmProject) => void | Promise<void>;
  requestDirector: RepairRequest;
  notify: (notice: UiNotice) => void;
}) {
  const sequences = new RequestSequences();
  const begin = (film: FilmProject, stage: string) =>
    sequences.begin(film.id, stage, () => host.current()?.id ?? "");
  return {
    async makeAllPortraits(characterIds?: string[]) {
      const base = host.current();
      if (!base) return null;
      const valid = begin(base, "portraits");
      return generatePortraits({
        base,
        characterIds,
        current: host.current,
        isCurrent: valid,
        apply: host.apply,
        generate: (prompt) =>
          requestStill(base.seriesId, prompt, base.aspectRatio === "16:9" ? "16:9" : "9:16"),
        progress: (batch) => {
          if (valid())
            host.notify({
              code: batch.failed
                ? "PORTRAIT_BATCH_PARTIAL"
                : batch.done === batch.total
                  ? "PORTRAIT_BATCH_DONE"
                  : "PORTRAIT_BATCH_RUNNING",
              text: "定妆照队列进度已更新。",
              detail: JSON.stringify(batch),
            });
        },
      });
    },
    async fixCoverage(sceneId: string) {
      const base = host.current();
      if (!base || !base.scenes.some((scene) => scene.id === sceneId)) return null;
      const owned = begin(base, `coverage:${sceneId}`);
      const snapshot = (film: FilmProject | null) =>
        JSON.stringify({
          scene: film?.scenes.find((scene) => scene.id === sceneId),
          shots: film?.shots.filter((shot) => shot.sceneId === sceneId),
        });
      const original = snapshot(base);
      const valid = () => owned() && snapshot(host.current()) === original;
      const result = await repairCoverage(base, sceneId, host.requestDirector, valid);
      if (!valid()) {
        if (owned()) host.notify({ code: "REQUEST_STALE", text: NOTICE_TEXT.REQUEST_STALE });
        return null;
      }
      if (valid()) {
        const latest = host.current();
        if (latest)
          await host.apply({
            ...latest,
            scenes: latest.scenes.map((scene) =>
              scene.id === sceneId
                ? (result.film.scenes.find((item) => item.id === sceneId) ?? scene)
                : scene,
            ),
            shots: latest.scenes.flatMap((scene) =>
              scene.id === sceneId
                ? result.film.shots.filter((shot) => shot.sceneId === sceneId)
                : latest.shots.filter((shot) => shot.sceneId === scene.id),
            ),
          });
        if (owned() && result.coverage) host.notify(coverageNotice(result.coverage));
      }
      return result.coverage;
    },
    async updateCharacterTraits(
      characterId: string,
      patch: Pick<FilmCharacter, "gender" | "ageBand">,
    ) {
      const film = host.current();
      if (!film) return;
      await host.apply({
        ...film,
        characters: film.characters.map((person) =>
          person.id === characterId
            ? autoVoiceForCharacter(
                {
                  ...person,
                  ...patch,
                  userFields: [...new Set([...person.userFields, "gender", "ageBand"])],
                },
                new Set(
                  film.characters
                    .filter((other) => other.id !== characterId)
                    .map((other) => other.voiceId),
                ),
                film.sourceText,
              )
            : person,
        ),
      });
    },
  };
}
