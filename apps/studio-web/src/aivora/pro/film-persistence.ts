import type { FilmFlushStatus } from "@aijian/contracts/quit-save";
import type { FilmProject } from "../film/project";

type Guard = () => boolean;
export type FilmSaveLease = {
  save: (film: FilmProject, guard: Guard) => Promise<void>;
  release: () => Promise<void>;
};

/** One queue per project for automatic saves, explicit saves and pipeline checkpoints. */
export function createFilmPersistence(host: {
  current: () => FilmProject | null;
  write: (film: FilmProject) => Promise<FilmProject>;
}) {
  type Entry = {
    tail: Promise<void>;
    owner?: symbol;
    saved?: FilmProject;
    baseline?: string;
    savedSignature?: string;
    failed?: { film: FilmProject };
  };
  const entries = new Map<string, Entry>();
  const entryFor = (id: string) => {
    let entry = entries.get(id);
    if (!entry) {
      entry = { tail: Promise.resolve() };
      entries.set(id, entry);
    }
    return entry;
  };
  function enqueue(film: FilmProject, guard: Guard, owner?: symbol): Promise<FilmProject | null> {
    const entry = entryFor(film.id);
    const snapshot = structuredClone(film);
    const run = entry.tail.then(async () => {
      if (entry.owner !== owner || !guard()) return null;
      if (owner) entry.baseline = JSON.stringify(host.current());
      try {
        const stored = await host.write(snapshot);
        entry.saved = film;
        entry.savedSignature = JSON.stringify(snapshot);
        entry.failed = undefined;
        return stored;
      } catch (error) {
        entry.failed = { film };
        throw error;
      }
    });
    // A failed write must reject its caller, but cannot poison all later saves.
    entry.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  const save = (film: FilmProject, guard: Guard = () => host.current() === film) =>
    enqueue(film, guard);
  const flush = async () => {
    const film = host.current();
    if (!film) return null;
    const entry = entryFor(film.id);
    if (entry.owner) {
      // An in-flight pipeline has already saved running before sending a request.
      // Never overwrite that checkpoint with an older render during shutdown.
      await entry.tail;
      const latest = host.current();
      if (
        latest?.id === film.id &&
        latest !== entry.saved &&
        JSON.stringify(latest) !== entry.baseline
      ) {
        return enqueue(latest, () => host.current() === latest, entry.owner);
      }
      return null;
    }
    return save(film);
  };
  type FlushAllResult = {
    status: FilmFlushStatus;
    snapshot: FilmProject | null;
    stored: FilmProject | null;
    failedProjectId?: string;
  };
  let flushing: Promise<FlushAllResult> | null = null;
  async function failedAfterDrain(projectId: string): Promise<FlushAllResult> {
    for (let pass = 0; pass < 20; pass += 1) {
      const tails = new Map([...entries].map(([id, entry]) => [id, entry.tail]));
      await Promise.all(tails.values());
      if (
        tails.size === entries.size &&
        [...entries].every(([id, entry]) => tails.get(id) === entry.tail)
      )
        return {
          status: "failed",
          snapshot: host.current(),
          stored: null,
          failedProjectId: projectId,
        };
    }
    return { status: "unknown", snapshot: host.current(), stored: null };
  }
  async function drainAll(): Promise<FlushAllResult> {
    const retried = new Set<Entry>();
    let stored: FilmProject | null = null;
    let storedFor: FilmProject | null = null;
    for (let pass = 0; pass < 20; pass += 1) {
      await Promise.all([...entries.values()].map((entry) => entry.tail));
      if ([...entries.values()].some((entry) => entry.owner))
        return { status: "busy", snapshot: host.current(), stored: null };
      for (const entry of entries.values()) {
        const failed = entry.failed;
        if (!failed || failed.film.id === host.current()?.id) continue;
        if (retried.has(entry)) return failedAfterDrain(failed.film.id);
        retried.add(entry);
        try {
          await enqueue(
            failed.film,
            () =>
              entry.failed === failed &&
              !entry.owner &&
              (host.current()?.id !== failed.film.id || host.current() === failed.film),
          );
        } catch {
          return failedAfterDrain(failed.film.id);
        }
      }
      const snapshot = host.current();
      if (snapshot) {
        const entry = entryFor(snapshot.id);
        if (entry.owner) return { status: "busy", snapshot, stored: null };
        if (entry.saved !== snapshot || entry.savedSignature !== JSON.stringify(snapshot)) {
          try {
            stored = await save(snapshot);
            if (stored) storedFor = snapshot;
          } catch {
            return failedAfterDrain(snapshot.id);
          }
          if (!stored) continue;
        }
      }
      const tails = new Map([...entries].map(([id, entry]) => [id, entry.tail]));
      await Promise.all(tails.values());
      if ([...entries.values()].some((entry) => entry.owner))
        return { status: "busy", snapshot: host.current(), stored: null };
      const failedEntry = [...entries].find(([, entry]) => entry.failed);
      if (failedEntry)
        return {
          status: "failed",
          snapshot: host.current(),
          stored: null,
          failedProjectId: failedEntry[0],
        };
      if (
        host.current() !== snapshot ||
        (snapshot && entryFor(snapshot.id).savedSignature !== JSON.stringify(snapshot))
      )
        continue;
      if (
        tails.size !== entries.size ||
        [...entries].some(([id, entry]) => tails.get(id) !== entry.tail)
      )
        continue;
      return { status: "saved", snapshot, stored: storedFor === snapshot ? stored : null };
    }
    return { status: "unknown", snapshot: host.current(), stored: null };
  }
  const flushAll = () => {
    if (!flushing)
      flushing = drainAll().finally(() => {
        flushing = null;
      });
    return flushing;
  };
  const acquire = async (projectId: string): Promise<FilmSaveLease> => {
    const entry = entryFor(projectId);
    if (entry.owner) throw new Error("PIPELINE_ALREADY_RUNNING");
    const owner = Symbol(projectId);
    entry.owner = owner;
    entry.baseline = JSON.stringify(host.current());
    await entry.tail;
    let released = false;
    return {
      save: async (film, guard) => {
        if (released || film.id !== projectId || entry.owner !== owner || !guard())
          throw new Error("PIPELINE_INPUT_CHANGED");
        const stored = await enqueue(film, guard, owner);
        if (!stored) throw new Error("PIPELINE_INPUT_CHANGED");
      },
      release: async () => {
        if (released) return;
        released = true;
        await entry.tail;
        if (entry.owner !== owner) return;
        entry.owner = undefined;
        const latest = host.current();
        // Preserve an edit made while the pipeline was stopping. Already-saved
        // pipeline snapshots need no duplicate write or media materialization.
        if (latest?.id === projectId && latest !== entry.saved) await save(latest);
      },
    };
  };
  return { save, flush, flushAll, acquire };
}
