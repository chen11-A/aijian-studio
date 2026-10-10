import { useEffect, useMemo, useState } from "react";
import { createStudioTransport } from "../api/studio";
import { scriptSpeakerId } from "./adapters/assemblyDialogue";
import {
  validScriptVersion,
  type ScriptBlock,
  type ScriptGateway,
  type ScriptScene,
  type ScriptVersion,
} from "./adapters/episodeScript";
import { sameStoryboardJson } from "./adapters/episodeStoryboard";

export type AssemblyScriptGateway = Partial<
  Pick<ScriptGateway, "getEpisodeScript" | "getEpisodeScriptVersion">
>;
export type AssemblyDialogueSource = { block: ScriptBlock; scene: ScriptScene; speakerId: string };
export type AssemblyScriptSource =
  | { state: "ready"; version: ScriptVersion; dialogues: AssemblyDialogueSource[] }
  | { state: "loading" | "empty" | "error"; version: null; dialogues: [] };
const loading: AssemblyScriptSource = { state: "loading", version: null, dialogues: [] };
const error: AssemblyScriptSource = { state: "error", version: null, dialogues: [] };
const empty: AssemblyScriptSource = { state: "empty", version: null, dialogues: [] };

async function savedDialogues(version: ScriptVersion): Promise<AssemblyScriptSource> {
  const dialogues: AssemblyDialogueSource[] = [];
  const speakers = new Map<string, Promise<string | null>>();
  for (const scene of version.content.scenes) {
    for (const block of scene.blocks) {
      if (
        block.kind !== "DIALOGUE" ||
        typeof block.speaker !== "string" ||
        !block.speaker.trim() ||
        (block.delivery !== "ON_SCREEN" && block.delivery !== "OFF_SCREEN")
      )
        continue;
      let identity = speakers.get(block.speaker);
      if (!identity) {
        identity = scriptSpeakerId(
          version.project_id,
          version.episode_id,
          version.version_id,
          block.speaker,
        );
        speakers.set(block.speaker, identity);
      }
      const speakerId = await identity;
      if (!speakerId) return error;
      dialogues.push({ block, scene, speakerId });
    }
  }
  return { state: "ready", version, dialogues };
}

/** Saved reads and their hashes are fenced to this exact scope, selected pin and refresh. */
export function useAssemblyScriptSources(
  projectId: string,
  episodeId: string,
  versionId: string | undefined,
  supplied?: AssemblyScriptGateway,
) {
  const transport = useMemo(createStudioTransport, []);
  const gateway = supplied ?? transport;
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([projectId, episodeId, versionId, refresh]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    gateway: AssemblyScriptGateway;
    latest: AssemblyScriptSource;
    pinned: AssemblyScriptSource;
  }>();
  useEffect(() => {
    let active = true;
    async function read(pin?: string): Promise<AssemblyScriptSource> {
      try {
        const result = pin
          ? await gateway.getEpisodeScriptVersion?.(projectId, episodeId, pin)
          : await gateway.getEpisodeScript?.(projectId, episodeId);
        if (result?.kind === "EMPTY" && !pin) return empty;
        if (
          result?.kind === "FOUND" &&
          typeof result.receipt.request_id === "string" &&
          !!result.receipt.request_id.trim() &&
          validScriptVersion(result.receipt.data, projectId, episodeId) &&
          (!pin || result.receipt.data.version_id === pin)
        )
          return await savedDialogues(result.receipt.data);
      } catch {
        /* An unavailable saved source cannot be replaced with an inferred binding. */
      }
      return error;
    }
    void Promise.all([read(), versionId ? read(versionId) : Promise.resolve(empty)]).then(
      ([latest, pinned]) => {
        if (
          latest.state === "ready" &&
          pinned.state === "ready" &&
          (latest.version.version_number < pinned.version.version_number ||
            (latest.version.version_id === pinned.version.version_id &&
              (latest.version.version_number !== pinned.version.version_number ||
                latest.version.head_revision !== pinned.version.head_revision ||
                latest.version.content_hash !== pinned.version.content_hash ||
                !sameStoryboardJson(latest.version.content, pinned.version.content))))
        )
          latest = error;
        if (active) setSnapshot({ key, gateway, latest, pinned });
      },
    );
    return () => {
      active = false;
    };
  }, [gateway, projectId, episodeId, versionId, key]);
  const current = snapshot?.key === key && snapshot.gateway === gateway ? snapshot : undefined;
  return {
    latest: current?.latest ?? loading,
    pinned: current?.pinned ?? loading,
    refresh: () => setRefresh((value) => value + 1),
  };
}
