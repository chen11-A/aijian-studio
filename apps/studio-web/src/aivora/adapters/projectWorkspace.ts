import type {
  CreateProjectInput,
  ProjectData,
  SourceDocumentResponse,
  StudioTransport,
} from "../../api/studio";

export type ProjectCreateOutcome =
  { kind: "SUCCEEDED"; project: ProjectData } | { kind: "REMOTE_UNKNOWN" };

/** Prevent an older project/source response from replacing the latest selection. */
export class LatestRequestGate {
  private generation = 0;
  begin(): number {
    return ++this.generation;
  }
  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
  invalidate(): void {
    this.generation += 1;
  }
}

export async function connectWorkspace(transport: StudioTransport): Promise<ProjectData[]> {
  await transport.getHealth();
  return (await transport.listProjects()).data;
}

export async function createWorkspaceProject(
  transport: StudioTransport,
  input: CreateProjectInput,
): Promise<ProjectCreateOutcome> {
  try {
    return { kind: "SUCCEEDED", project: (await transport.createProject(input)).data };
  } catch {
    return { kind: "REMOTE_UNKNOWN" };
  }
}

export async function restoreLatestSource(
  transport: StudioTransport,
  projectId: string,
): Promise<SourceDocumentResponse | null> {
  const sources = await transport.listSources(projectId);
  const latest = sources.data[0];
  return latest ? transport.getSource(projectId, latest.id) : null;
}

export function mergeCreatedProject(current: ProjectData[], project: ProjectData): ProjectData[] {
  return [project, ...current.filter((candidate) => candidate.id !== project.id)];
}
