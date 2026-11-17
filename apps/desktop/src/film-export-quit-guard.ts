import { EXPORT_WRITING_MESSAGE, type FilmExportActivity } from "@aijian/contracts/film-export-qc";

/** True for the reload and force-reload shortcuts. Menu clicks use the same guard. */
export function isExportReloadShortcut(input: {
  type?: string;
  key: string;
  control?: boolean;
  meta?: boolean;
}): boolean {
  if (input.type && input.type !== "keyDown") return false;
  const key = input.key.toLowerCase();
  if (key === "f5") return true;
  return (!!input.control || !!input.meta) && key === "r";
}

/** One hold per export. A finished project does not release a different project's hold. */
export function createExportWriteGuard(notify: (activity: FilmExportActivity) => void) {
  const held = new Set<string>();
  const emit = (activity: FilmExportActivity) => {
    try {
      notify(activity);
    } catch {
      /* A closed window must not keep the write running. */
    }
  };
  const publish = () => {
    emit(held.size > 0 ? { writing: true, message: EXPORT_WRITING_MESSAGE } : { writing: false });
  };
  return {
    writing: () => held.size > 0,
    hold(id: string) {
      const before = held.size;
      held.add(id);
      if (held.size !== before) publish();
    },
    release(id: string) {
      if (!held.delete(id)) return;
      publish();
    },
    /** Returns the activity when quit must be refused. */
    refuseQuit(): FilmExportActivity | null {
      if (held.size === 0) return null;
      const activity: FilmExportActivity = {
        writing: true,
        quitRefused: true,
        message: EXPORT_WRITING_MESSAGE,
      };
      emit(activity);
      return activity;
    },
  };
}
