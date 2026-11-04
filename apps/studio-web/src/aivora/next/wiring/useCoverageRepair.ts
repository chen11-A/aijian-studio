import { useRef, useState } from "react";

/** A repair belongs to a project/scene, even while the viewer changes scenes. */
export function useCoverageRepair(scope: string, repair: () => Promise<unknown>) {
  const pending = useRef(new Set<string>());
  const [states, setStates] = useState<Record<string, { running: boolean; failed: boolean }>>({});
  return {
    fixing: states[scope]?.running ?? false,
    failed: states[scope]?.failed ?? false,
    run: async () => {
      if (pending.current.has(scope)) return;
      pending.current.add(scope);
      setStates((current) => ({ ...current, [scope]: { running: true, failed: false } }));
      let failed = false;
      try {
        await repair();
      } catch {
        failed = true;
      } finally {
        pending.current.delete(scope);
        setStates((current) => ({ ...current, [scope]: { running: false, failed } }));
      }
    },
  };
}
