import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { assessChatGPTConnection } from "../../domain/ai-capability-readiness";
import { rememberServiceEntryChoice } from "../FirstRunServiceChoice";
import { useChatGPTConnection } from "./useChatGPTConnection";
import {
  MODEL_PREFERENCE_KEY,
  emptyModelPreference,
  readModelPreference,
  resolveModelPreference,
  saveModelPreference,
  type ModelPreference,
  type OfficialModelReference,
} from "./modelPreference";

type Connection = ReturnType<typeof useChatGPTConnection>;
export type OfficialConnectionState = {
  connection: Connection;
  preference: ModelPreference;
  preferenceError: boolean;
  preferenceIssue: "READ_FAILED" | "CONFLICT" | null;
  requiresReselection: boolean;
  catalogProfileId: string | null;
  readModels: () => Promise<void>;
  reloadPreference: () => void;
  setDefaultModel: (slug: string) => boolean;
  setProjectModel: (projectId: string, slug: string) => boolean;
  restoreProjectDefault: (projectId: string) => boolean;
  resolve: (projectId: string) => ReturnType<typeof resolveModelPreference>;
};

const Context = createContext<OfficialConnectionState | null>(null);

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function OfficialConnectionProvider({ children }: { children: ReactNode }) {
  const connection = useChatGPTConnection(undefined, () => rememberServiceEntryChoice("chatgpt"));
  const [stored, setStored] = useState(() => {
    const storage = browserStorage();
    return storage ? readModelPreference(storage) : { value: emptyModelPreference(), error: true };
  });
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const [preferenceIssue, setPreferenceIssue] = useState<"READ_FAILED" | "CONFLICT" | null>(
    stored.error ? "READ_FAILED" : null,
  );
  const [catalogInvalidated, setCatalogInvalidated] = useState(false);
  const refreshStartModels = useRef<Connection["models"] | null>(null);
  const [requiresReselection, setRequiresReselection] = useState(false);
  const priorConfirmedProfile = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (connection.loading || connection.busy || connection.statusReadFailed) return;
    if (connection.status.runtime !== "DESKTOP") return;
    const current =
      connection.status.state === "CONNECTED" ? connection.status.activeProfileId : null;
    const prior = priorConfirmedProfile.current;
    if (prior !== undefined && prior !== null && prior !== current) setRequiresReselection(true);
    priorConfirmedProfile.current = current;
  }, [connection.loading, connection.busy, connection.statusReadFailed, connection.status]);
  useEffect(() => {
    const check = () => {
      const storage = browserStorage();
      const incoming = storage
        ? readModelPreference(storage)
        : { value: emptyModelPreference(), error: true };
      if (incoming.error) {
        setPreferenceIssue("READ_FAILED");
        setCatalogInvalidated(true);
      } else if (JSON.stringify(incoming.value) !== JSON.stringify(storedRef.current.value)) {
        setPreferenceIssue("CONFLICT");
        setCatalogInvalidated(true);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MODEL_PREFERENCE_KEY || event.key === null) check();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", check);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", check);
    };
  }, []);
  const ready = assessChatGPTConnection(connection) === "AUTHORIZED_UNVERIFIED";
  const activeProfileId = ready ? connection.status.activeProfileId : null;
  const catalogProfileId =
    !catalogInvalidated && activeProfileId && connection.modelsProfileId === activeProfileId
      ? activeProfileId
      : null;
  const catalog = catalogProfileId ? connection.models.map((item) => item.slug) : [];
  useEffect(() => {
    if (
      catalogInvalidated &&
      refreshStartModels.current &&
      connection.models !== refreshStartModels.current &&
      !connection.loading &&
      !connection.busy &&
      !connection.statusReadFailed &&
      connection.modelsProfileId === activeProfileId
    ) {
      refreshStartModels.current = null;
      setCatalogInvalidated(false);
    }
  }, [
    catalogInvalidated,
    connection.models,
    connection.modelsProfileId,
    connection.loading,
    connection.busy,
    connection.statusReadFailed,
    activeProfileId,
  ]);

  function update(next: ModelPreference, confirmsModel = false): boolean {
    if (preferenceIssue === "CONFLICT") return false;
    const storage = browserStorage();
    if (!storage || !saveModelPreference(storage, next)) {
      setPreferenceIssue("READ_FAILED");
      return false;
    }
    const saved = { value: next, error: false };
    storedRef.current = saved;
    setStored(saved);
    setPreferenceIssue(null);
    if (confirmsModel) setRequiresReselection(false);
    return true;
  }
  function reloadPreference() {
    const storage = browserStorage();
    const incoming = storage
      ? readModelPreference(storage)
      : { value: emptyModelPreference(), error: true };
    if (incoming.error) {
      setPreferenceIssue("READ_FAILED");
      setCatalogInvalidated(true);
      return;
    }
    const changed = JSON.stringify(incoming.value) !== JSON.stringify(storedRef.current.value);
    storedRef.current = incoming;
    setStored(incoming);
    setPreferenceIssue(null);
    if (changed) setCatalogInvalidated(true);
  }
  function reference(slug: string): OfficialModelReference | null {
    if (!catalogProfileId || !catalog.includes(slug)) return null;
    return { provider: "CHATGPT_OFFICIAL", profileId: catalogProfileId, modelSlug: slug };
  }
  const value: OfficialConnectionState = {
    connection,
    preference: stored.value,
    preferenceError: preferenceIssue !== null,
    preferenceIssue,
    requiresReselection,
    catalogProfileId,
    readModels: async () => {
      refreshStartModels.current = connection.models;
      await connection.readModels();
    },
    reloadPreference,
    setDefaultModel: (slug) => {
      const choice = reference(slug);
      return choice ? update({ ...stored.value, defaultModel: choice }, true) : false;
    },
    setProjectModel: (projectId, slug) => {
      const choice = reference(slug);
      return choice
        ? update(
            {
              ...stored.value,
              projectOverrides: { ...stored.value.projectOverrides, [projectId]: choice },
            },
            true,
          )
        : false;
    },
    restoreProjectDefault: (projectId) => {
      const projectOverrides = { ...stored.value.projectOverrides };
      delete projectOverrides[projectId];
      return update({ ...stored.value, projectOverrides });
    },
    resolve: (projectId) => {
      const resolved = resolveModelPreference(stored.value, projectId, catalogProfileId, catalog);
      return preferenceIssue || requiresReselection ? { ...resolved, verified: false } : resolved;
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOfficialConnection() {
  return useContext(Context);
}
