import type {
  CreateProjectInput,
  ProjectData,
  SourceDocumentResponse,
  StudioTransport,
} from "../../api/studio";
import { isProjectAspectRatio } from "@aijian/contracts/project-aspect";
import { validProjectCreateInput } from "./projectCreateJournal";

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
  if (!validProjectCreateInput(input)) return { kind: "REMOTE_UNKNOWN" };
  const requested = { ...input };
  if (!isProjectAspectRatio(requested.aspect_ratio)) return { kind: "REMOTE_UNKNOWN" };
  try {
    const project = (await transport.createProject({ ...requested })).data;
    if (
      project.aspect_ratio !== requested.aspect_ratio ||
      project.name !== requested.name.trim() ||
      project.target_duration_seconds !== requested.target_duration_seconds ||
      project.source_language !== requested.source_language
    )
      return { kind: "REMOTE_UNKNOWN" };
    return { kind: "SUCCEEDED", project };
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
