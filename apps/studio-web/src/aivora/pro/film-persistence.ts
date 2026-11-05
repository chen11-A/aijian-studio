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
  type Entry = { tail: Promise<void>; owner?: symbol; saved?: FilmProject; baseline?: string };
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
      const stored = await host.write(snapshot);
      entry.saved = film;
      return stored;
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
  return { save, flush, acquire };
}
