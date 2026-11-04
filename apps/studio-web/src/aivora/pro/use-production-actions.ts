import { useMemo, useRef } from "react";
import { createProductionActions } from "./production-actions";

export function useProductionActions(host: Parameters<typeof createProductionActions>[0]) {
  const latest = useRef(host);
  latest.current = host;
  return useMemo(
    () =>
      createProductionActions({
        current: () => latest.current.current(),
        apply: (film) => latest.current.apply(film),
        notify: (notice) => latest.current.notify(notice),
        requestDirector: (context, instruction) =>
          latest.current.requestDirector(context, instruction),
      }),
    [],
  );
}
