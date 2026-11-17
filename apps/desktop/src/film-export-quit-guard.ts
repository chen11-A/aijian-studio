import { EXPORT_WRITING_MESSAGE, type FilmExportActivity } from "@aijian/contracts/film-export-qc";

/** Main-process gate. Checking and the folder dialog do not set this. The folder write does. */
export function createExportWriteGuard(notify: (activity: FilmExportActivity) => void) {
  let writing = false;
  const emit = (activity: FilmExportActivity) => {
    try {
      notify(activity);
    } catch {
      /* A closed window must not keep the write running. */
    }
  };
  return {
    writing: () => writing,
    setWriting(value: boolean) {
      if (writing === value) return;
      writing = value;
      emit(value ? { writing: true, message: EXPORT_WRITING_MESSAGE } : { writing: false });
    },
    /** Returns the activity when quit must be refused. */
    refuseQuit(): FilmExportActivity | null {
      if (!writing) return null;
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
