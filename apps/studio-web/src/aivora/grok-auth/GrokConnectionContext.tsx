import { createContext, useContext, type ReactNode } from "react";
import { useGrokConnection, type GrokConnection } from "./useGrokConnection";

const Context = createContext<GrokConnection | null>(null);

export function GrokConnectionProvider({
  children,
  projectId,
}: {
  children: ReactNode;
  projectId?: string | null;
}) {
  const connection = useGrokConnection(undefined, projectId);
  return <Context.Provider value={connection}>{children}</Context.Provider>;
}

export function useGrokAccount(): GrokConnection | null {
  return useContext(Context);
}
