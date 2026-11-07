import type { FilmFlushStatus } from "@aijian/contracts/quit-save";
import type { FilmProject } from "../film/project";

type Guard = () => boolean;
export type FilmSaveLease = {
  save: (film: FilmProject, guard: Guard) => Promise<FilmProject | void>;
  release: () => Promise<void>;
  beginExternalWrite?: (guard: Guard) => void;
  markExternalWriteUnknown?: (canonical?: FilmProject) => void;
  rebaseExternalWrite?: (
    canonical: FilmProject,
    draft: FilmProject,
    guard: Guard,
  ) => Promise<boolean>;
  confirmExternalWrite?: (canonical: FilmProject, adopted?: FilmProject, guard?: Guard) => boolean;
};
export type FilmExternalWriteState = {
  status: "pending" | "unknown";
  before: FilmProject;
  draft: FilmProject;
  canonical?: FilmProject;
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
    external?: FilmExternalWriteState;
    externalCanonical?: FilmProject;
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
    if (entry.external) {
      if (host.current() === film) entry.external.draft = film;
      return Promise.resolve(null);
    }
    if (
      !owner &&
      entry.externalCanonical &&
      entry.saved === film &&
      entry.savedSignature === JSON.stringify(film) &&
      guard()
    )
      return Promise.resolve(structuredClone(entry.externalCanonical));
    const snapshot = structuredClone(film);
    const run = entry.tail.then(async () => {
      if (entry.owner !== owner || entry.external || !guard()) return null;
      if (owner) entry.baseline = JSON.stringify(host.current());
      try {
        const stored = await host.write(snapshot);
        entry.externalCanonical = undefined;
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
    if (entry.external) {
      entry.external.draft = film;
      return null;
    }
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
      const uncertain = [...entries].find(([, entry]) => entry.external?.status === "unknown");
      if (uncertain)
        return {
          status: uncertain[1].failed ? "failed" : "unknown",
          snapshot: host.current(),
          stored: null,
          failedProjectId: uncertain[0],
        };
      if ([...entries.values()].some((entry) => entry.owner || entry.external))
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
      if ([...entries.values()].some((entry) => entry.external?.status === "unknown"))
        return { status: "unknown", snapshot: host.current(), stored: null };
      if ([...entries.values()].some((entry) => entry.owner || entry.external))
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
  const acquire = async (projectId: string, recovery = false): Promise<FilmSaveLease> => {
    const entry = entryFor(projectId);
    if (entry.owner) throw new Error("PIPELINE_ALREADY_RUNNING");
    if (recovery ? entry.external?.status !== "unknown" : !!entry.external)
      throw new Error("EXTERNAL_WRITE_UNCONFIRMED");
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
        return stored;
      },
      beginExternalWrite: (guard) => {
        const before = host.current();
        if (
          released ||
          entry.owner !== owner ||
          entry.external ||
          !before ||
          before.id !== projectId ||
          !guard()
        )
          throw new Error("PIPELINE_INPUT_CHANGED");
        entry.external = { status: "pending", before, draft: before };
      },
      markExternalWriteUnknown: (canonical) => {
        if (released || entry.owner !== owner || !entry.external)
          throw new Error("EXTERNAL_WRITE_NOT_STARTED");
        if (canonical) {
          if (canonical.id !== projectId) throw new Error("EXTERNAL_WRITE_PROJECT_MISMATCH");
          entry.external.canonical = canonical;
        }
        entry.external.status = "unknown";
        const current = host.current();
        if (current?.id === projectId) entry.external.draft = current;
      },
      rebaseExternalWrite: (canonical, draft, guard) => {
        if (
          released ||
          entry.owner !== owner ||
          !entry.external ||
          canonical.id !== projectId ||
          draft.id !== projectId ||
          !guard()
        )
          return Promise.reject(new Error("PIPELINE_INPUT_CHANGED"));
        entry.external.canonical = canonical;
        entry.external.draft = draft;
        entry.external.status = "unknown";
        const snapshot = structuredClone(draft);
        const run = entry.tail.then(async () => {
          if (released || entry.owner !== owner || !entry.external || !guard())
            throw new Error("PIPELINE_INPUT_CHANGED");
          try {
            const stored = await host.write(snapshot);
            entry.saved = draft;
            entry.savedSignature = JSON.stringify(snapshot);
            entry.baseline = JSON.stringify(draft);
            entry.externalCanonical = stored;
            entry.failed = undefined;
            if (!guard()) {
              entry.external.canonical = stored;
              const latest = host.current();
              if (latest?.id === projectId) entry.external.draft = latest;
              return false;
            }
            entry.external = undefined;
            return true;
          } catch (error) {
            entry.failed = { film: draft };
            if (entry.external) entry.external.status = "unknown";
            throw error;
          }
        });
        entry.tail = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
      confirmExternalWrite: (canonical, adopted, guard = () => true) => {
        if (released || entry.owner !== owner || !entry.external || canonical.id !== projectId)
          throw new Error("EXTERNAL_WRITE_NOT_STARTED");
        entry.external.canonical = canonical;
        const current = host.current();
        if (
          (adopted && (adopted.id !== projectId || current !== adopted || !guard())) ||
          (!adopted && current?.id === projectId)
        ) {
          entry.external.status = "unknown";
          if (current?.id === projectId) entry.external.draft = current;
          return false;
        }
        // Canonical bytes, not the adopted ref, determine whether future flushes still
        // need a write. A precisely rebased local edit must be explicitly saved by its caller.
        entry.saved = adopted ?? canonical;
        entry.savedSignature = JSON.stringify(canonical);
        entry.externalCanonical = canonical;
        entry.baseline = JSON.stringify(adopted ?? canonical);
        entry.failed = undefined;
        entry.external = undefined;
        return true;
      },
      release: async () => {
        if (released) return;
        released = true;
        await entry.tail;
        if (entry.owner !== owner) return;
        entry.owner = undefined;
        const latest = host.current();
        if (entry.external) {
          entry.external.status = "unknown";
          if (latest?.id === projectId) entry.external.draft = latest;
          return;
        }
        // Preserve an edit made while the pipeline was stopping. Already-saved
        // pipeline snapshots need no duplicate write or media materialization.
        if (latest?.id === projectId && latest !== entry.saved) await save(latest);
      },
    };
  };
  return {
    save,
    flush,
    flushAll,
    acquire,
    acquireExternalRecovery: (projectId: string) => acquire(projectId, true),
    externalWriteState: (projectId: string): FilmExternalWriteState | null => {
      const entry = entries.get(projectId);
      if (!entry?.external) return null;
      const current = host.current();
      if (current?.id === projectId) entry.external.draft = current;
      return { ...entry.external };
    },
  };
}
