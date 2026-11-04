import { useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import {
  readScriptConfirmation,
  validScriptVersion,
  type ScriptConfirmationStatus,
} from "./adapters/episodeScript";
import {
  savedDialogues,
  type AssemblyScriptGateway,
  type AssemblyScriptSource,
} from "./useAssemblyScriptSources";

type ReadIdentity = {
  projectId: string;
  episodeId: string;
  gateway: AssemblyScriptGateway;
  refresh: number;
};
type Snapshot = {
  identity: ReadIdentity;
  status: ScriptConfirmationStatus;
  source: AssemblyScriptSource;
};
/** Read last confirmed identity independently of latest draft, with an exact source readback. */
export function useConfirmedAssemblyScript(
  projectId: string,
  episodeId: string,
  supplied?: AssemblyScriptGateway,
) {
  const transport = useMemo(createStudioTransport, []);
  const gateway = supplied ?? transport;
  const [refresh, setRefresh] = useState(0);
  const identity = useMemo(
    () => ({ projectId, episodeId, gateway, refresh }),
    [projectId, episodeId, gateway, refresh],
  );
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const verified = useRef(new Map<string, ScriptConfirmationStatus>());
  const [failed, setFailed] = useState<ReadIdentity>();
  useEffect(() => {
    let active = true;
    async function read() {
      if (!gateway.getEpisodeScriptConfirmation || !gateway.getEpisodeScriptVersion) return null;
      const result = await readScriptConfirmation(
        { getEpisodeScriptConfirmation: gateway.getEpisodeScriptConfirmation },
        projectId,
        episodeId,
      );
      if (result.kind !== "FOUND") return null;
      const receipt = result.status.confirmation;
      if (
        result.status.current !==
        (!!receipt &&
          receipt.version_id === result.status.latest_version_id &&
          receipt.head_revision === result.status.latest_head_revision)
      )
        return null;
      if (!receipt)
        return {
          status: result.status,
          source: { state: "empty", version: null, dialogues: [] } as AssemblyScriptSource,
        };
      const exact = await gateway.getEpisodeScriptVersion(projectId, episodeId, receipt.version_id);
      if (
        exact.kind !== "FOUND" ||
        typeof exact.receipt.request_id !== "string" ||
        !exact.receipt.request_id.trim() ||
        !validScriptVersion(exact.receipt.data, projectId, episodeId) ||
        exact.receipt.data.version_id !== receipt.version_id ||
        exact.receipt.data.content_hash !== receipt.content_hash ||
        exact.receipt.data.head_revision !== result.status.latest_head_revision ||
        exact.receipt.data.head_revision < receipt.head_revision
      )
        return null;
      const source = await savedDialogues(exact.receipt.data);
      return source.state === "ready" ? { status: result.status, source } : null;
    }
    void read()
      .catch(() => null)
      .then((value) => {
        if (!active) return;
        const prior = verified.current.get(`${projectId}/${episodeId}`);
        if (
          value &&
          prior &&
          (value.status.latest_head_revision < prior.latest_head_revision ||
            (value.status.latest_head_revision === prior.latest_head_revision &&
              value.status.latest_version_id !== prior.latest_version_id) ||
            (prior.confirmation &&
              (!value.status.confirmation ||
                value.status.confirmation.head_revision < prior.confirmation.head_revision ||
                (value.status.confirmation.head_revision === prior.confirmation.head_revision &&
                  (value.status.confirmation.version_id !== prior.confirmation.version_id ||
                    value.status.confirmation.content_hash !== prior.confirmation.content_hash)))))
        )
          value = null;
        if (value) {
          verified.current.set(`${projectId}/${episodeId}`, value.status);
          setSnapshot({ identity, ...value });
          setFailed(undefined);
        } else setFailed(identity);
      });
    return () => {
      active = false;
    };
  }, [gateway, identity, projectId, episodeId]);
  const current = snapshot?.identity === identity ? snapshot : undefined;
  return {
    status: current?.status,
    source: current?.source ?? {
      state: failed === identity ? ("error" as const) : ("loading" as const),
      version: null,
      dialogues: [],
    },
    refresh: () => setRefresh((n) => n + 1),
  };
}
