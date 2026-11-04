import { useRef, useState } from "react";

/** Project and request identity own UI locks independently of response validity. */
export function useWorkOwners(projectId: string) {
  const entries = useRef(new Map<string, Map<string, { owner: symbol; label: string }>>());
  const [, redraw] = useState(0);
  const has = (project: string, key: string) => entries.current.get(project)?.has(key) ?? false;
  const begin = (project: string, key: string, label = "正在处理") => {
    const owner = Symbol(key);
    const group = entries.current.get(project) ?? new Map();
    group.set(key, { owner, label });
    entries.current.set(project, group);
    redraw((value) => value + 1);
    return () => {
      const live = entries.current.get(project);
      if (live?.get(key)?.owner !== owner) return;
      live.delete(key);
      if (!live.size) entries.current.delete(project);
      redraw((value) => value + 1);
    };
  };
  const progress = (prefix: string): Record<string, string> =>
    Object.fromEntries(
      [...(entries.current.get(projectId)?.entries() ?? [])]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value.label]),
    );
  return { begin, has, progress, busy: (key: string) => has(projectId, key) };
}
