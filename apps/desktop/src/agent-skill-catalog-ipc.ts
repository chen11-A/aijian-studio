import type { AgentCatalogResponse, LocalApiClient, SkillCatalogResponse } from "./api-client";

export const AGENT_SKILL_CATALOG_CHANNELS = Object.freeze({
  listProjectAgents: "agents:list",
  listProjectSkills: "skills:list",
} as const);

type CatalogClient = Pick<LocalApiClient, "listProjectAgents" | "listProjectSkills">;
type CatalogInvoke = (channel: string, projectId: string) => Promise<unknown>;

export function createAgentSkillCatalogPreload(invoke: CatalogInvoke): {
  listProjectAgents(projectId: string): Promise<AgentCatalogResponse>;
  listProjectSkills(projectId: string): Promise<SkillCatalogResponse>;
} {
  return {
    listProjectAgents: (projectId) =>
      invoke(
        AGENT_SKILL_CATALOG_CHANNELS.listProjectAgents,
        projectId,
      ) as Promise<AgentCatalogResponse>,
    listProjectSkills: (projectId) =>
      invoke(
        AGENT_SKILL_CATALOG_CHANNELS.listProjectSkills,
        projectId,
      ) as Promise<SkillCatalogResponse>,
  };
}

export function registerAgentSkillCatalogHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, projectId: string) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => CatalogClient,
): void {
  handle(AGENT_SKILL_CATALOG_CHANNELS.listProjectAgents, (event, projectId) =>
    clientFor(event).listProjectAgents(projectId),
  );
  handle(AGENT_SKILL_CATALOG_CHANNELS.listProjectSkills, (event, projectId) =>
    clientFor(event).listProjectSkills(projectId),
  );
}
