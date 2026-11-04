import { portraitPrompts } from "../film/operations";
import type { FilmProject } from "../film/project";
import { beginTaskBatch, runTask } from "../film/task-progress";

export type PortraitBatchResult = {
  total: number;
  done: number;
  failed: number;
  cancelled: boolean;
  failures: { characterId: string; view: string; reason: string }[];
};
export type PortraitBatchOptions = {
  base: FilmProject;
  current: () => FilmProject | null;
  apply: (film: FilmProject) => void | Promise<void>;
  generate: (prompt: string) => Promise<{ url: string; reason: string }>;
  progress: (result: PortraitBatchResult) => void;
  isCurrent?: () => boolean;
  characterIds?: string[];
  taskTimeoutMs?: number;
};

/** A single serial queue for every missing angle; each image gets exactly one retry. */
export async function makeAllPortraits(
  options: PortraitBatchOptions,
): Promise<PortraitBatchResult> {
  const { base, current, apply, generate, progress } = options;
  const queue = base.characters
    .filter((person) => !options.characterIds || options.characterIds.includes(person.id))
    .flatMap((person) =>
      portraitPrompts(person.name, person.identity, base.styleZh)
        .filter(
          (item) =>
            !person.portraits.some((portrait) => portrait.view === item.view && portrait.url),
        )
        .map((item) => ({
          ...item,
          characterId: person.id,
          characterName: person.name,
          identity: person.identity,
        })),
    );
  const result: PortraitBatchResult = {
    total: queue.length,
    done: 0,
    failed: 0,
    cancelled: false,
    failures: [],
  };
  const batchId = `portraits:${base.id}:${crypto.randomUUID()}`;
  beginTaskBatch({ batchId, projectId: base.id, label: "定妆照", total: queue.length });
  const active = () => current()?.id === base.id && (options.isCurrent?.() ?? true);
  try {
    progress({ ...result });
    for (const item of queue) {
      if (!active()) {
        result.cancelled = true;
        break;
      }
      let reason = "";
      let saved = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (!active()) {
          result.cancelled = true;
          break;
        }
        try {
          await runTask(
            {
              id: `${batchId}:${item.characterId}:${item.view}`,
              projectId: base.id,
              kind: "image",
              title: `${item.characterName} · ${item.view}`,
              batchId,
              attempt,
            },
            async (signal) => {
              const target = () => {
                const live = current();
                if (!live || !active()) throw new Error("WORK_STALE");
                const person = live.characters.find((person) => person.id === item.characterId);
                if (!person) throw new Error("REQUEST_STALE");
                return { live, person };
              };
              const before = target();
              if (
                before.person.portraits.some(
                  (portrait) => portrait.view === item.view && portrait.url,
                )
              )
                return;
              if (
                before.person.name !== item.characterName ||
                before.person.identity !== item.identity ||
                before.live.styleZh !== base.styleZh
              )
                throw new Error("REQUEST_STALE");
              if (!item.identity.trim()) throw new Error("PORTRAIT_IDENTITY_REQUIRED");
              const made = await generate(item.prompt);
              if (!made.url) throw new Error(made.reason || "PORTRAIT_FAILED");
              if (signal.aborted) throw new Error("TASK_TIMEOUT");
              const { live, person } = target();
              if (person.portraits.some((portrait) => portrait.view === item.view && portrait.url))
                return;
              if (
                person.name !== item.characterName ||
                person.identity !== item.identity ||
                live.styleZh !== base.styleZh
              )
                throw new Error("REQUEST_STALE");
              await apply({
                ...live,
                characters: live.characters.map((person) =>
                  person.id === item.characterId
                    ? {
                        ...person,
                        portraits: [
                          ...person.portraits.filter((portrait) => portrait.view !== item.view),
                          { view: item.view, prompt: item.prompt, url: made.url },
                        ],
                      }
                    : person,
                ),
              });
            },
            options.taskTimeoutMs ? { timeoutMs: options.taskTimeoutMs } : undefined,
          );
          saved = true;
          break;
        } catch (error) {
          reason = error instanceof Error ? error.message : "PORTRAIT_FAILED";
          if (!active()) {
            result.cancelled = true;
            break;
          }
          if (["TASK_TIMEOUT", "REQUEST_STALE", "PORTRAIT_IDENTITY_REQUIRED"].includes(reason))
            break;
        }
      }
      if (result.cancelled) break;
      if (saved) result.done += 1;
      else {
        result.failed += 1;
        result.failures.push({ characterId: item.characterId, view: item.view, reason });
      }
      progress({ ...result, failures: [...result.failures] });
    }
    return result;
  } finally {
    progress({ ...result, failures: [...result.failures] });
  }
}
