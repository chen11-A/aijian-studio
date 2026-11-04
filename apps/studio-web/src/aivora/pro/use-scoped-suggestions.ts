import { useEffect, useRef } from "react";

/** Session-only drafts. A source-version change creates a different scope. */
export function useScopedSuggestions<T>(
  scope: string,
  value: T,
  restore: (saved: T | null) => void,
) {
  const cache = useRef(new Map<string, T>());
  const previous = useRef<{ scope: string; value: T | null }>({ scope, value });
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  if (previous.current.scope === scope) previous.current.value = value;
  useEffect(() => {
    const old = previous.current;
    if (old.scope !== scope && old.value !== null) cache.current.set(old.scope, old.value);
    while (cache.current.size > 20) cache.current.delete(cache.current.keys().next().value!);
    const saved = cache.current.get(scope) ?? null;
    previous.current = { scope, value: saved };
    restoreRef.current(saved);
  }, [scope]);
  const clear = () => {
    cache.current.delete(scope);
    previous.current.value = null;
  };
  return { cache, clear };
}
