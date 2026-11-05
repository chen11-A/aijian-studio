import { coverageNotice } from "../film/coverage-notice";
import type { FilmCharacter, FilmProject } from "../film/project";
import { autoVoiceForCharacter } from "../film/operations";
import type { UiNotice } from "../film/contracts3j";
import { NOTICE_TEXT } from "../film/notices";
import { fixCoverage as repairCoverage, RequestSequences } from "./director-workflow";
import { makeAllPortraits as generatePortraits } from "./portrait-workflow";
import { requestFilmStill, type AgentRequestControl, type AgentReply } from "./workflow";
import { directorBudget } from "./director-budget";

/** Functional host API for Claude's controls; no display or alternate execution engine. */
export function createProductionActions(host: {
  current: () => FilmProject | null;
  apply: (film: FilmProject) => void | Promise<void>;
  requestDirector: (
    context: string,
    instruction: string,
    control?: AgentRequestControl,
  ) => Promise<AgentReply>;
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
        generate: (prompt, references) => requestFilmStill(base, prompt, references),
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
    async fixCoverage(sceneId: string, signal?: AbortSignal) {
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
      const budget = directorBudget({
        current: valid,
        control: signal ? { signal, deadlineAt: Infinity } : undefined,
        progress: (text) => host.notify({ code: "DIRECTOR_PROGRESS", text, detail: text }),
      });
      budget.progress("正在检查并补齐这一场。");
      try {
        const result = await budget.run(() =>
          repairCoverage(
            base,
            sceneId,
            (context, instruction) =>
              budget.run(() => host.requestDirector(context, instruction, budget.control)),
            budget.current,
          ),
        );
        if (!budget.current()) throw new Error(budget.reason());
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
      } catch {
        if (owned()) {
          const code =
            budget.reason() === "TEXT_TIMEOUT"
              ? "TEXT_TIMEOUT"
              : signal?.aborted
                ? "OPERATION_CANCELLED"
                : !valid()
                  ? "REQUEST_STALE"
                  : "DIRECTOR_FAILED";
          host.notify({ code, text: NOTICE_TEXT[code] });
        }
        return null;
      } finally {
        budget.dispose();
      }
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
