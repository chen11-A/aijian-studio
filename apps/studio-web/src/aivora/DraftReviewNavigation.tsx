import { createContext, useContext, useEffect, useId, useMemo } from "react";
import type { ReactNode } from "react";

const Navigation = createContext<{
  inputs: Map<string, boolean>;
  canLeave: () => boolean;
} | null>(null);

export function DraftReviewNavigation({
  children,
  setNavigationGuard,
}: {
  children: ReactNode;
  setNavigationGuard?: (guard: (() => boolean) | null) => void;
}) {
  const navigation = useMemo(() => {
    const inputs = new Map<string, boolean>();
    return {
      inputs,
      canLeave: () =>
        !inputs.size ||
        window.confirm(
          [...inputs.values()].some(Boolean)
            ? "还有未提交输入，且本机缓存不可用。离开可能丢失输入，请先复制或保存。仍要离开吗？"
            : "还有未提交输入，仅缓存在本机，尚未保存为审片记录。继续离开并保留本机输入吗？",
        ),
    };
  }, []);
  useEffect(() => {
    setNavigationGuard?.(navigation.canLeave);
    return () => setNavigationGuard?.(null);
  }, [navigation, setNavigationGuard]);
  return <Navigation.Provider value={navigation}>{children}</Navigation.Provider>;
}
export function useDraftReviewNavigation() {
  return useContext(Navigation);
}
export function useDraftReviewLeaveGuard(dirty: boolean, unavailable: boolean) {
  const navigation = useContext(Navigation);
  const id = useId();
  useEffect(() => {
    if (dirty) navigation?.inputs.set(id, unavailable);
    else navigation?.inputs.delete(id);
    return () => {
      navigation?.inputs.delete(id);
    };
  }, [navigation, id, dirty, unavailable]);
}
