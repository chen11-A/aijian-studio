import type {
  CreateProjectInput,
  ProjectData,
  SourceDocumentResponse,
  StudioTransport,
} from "../../api/studio";

export type ProjectCreateOutcome =
  | { kind: "SUCCEEDED"; project: ProjectData }
  | { kind: "FAILED"; message: string }
  | { kind: "REMOTE_UNKNOWN" };

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
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/\bstatus (401|403|422)\b/.test(message))
      return { kind: "FAILED", message: "创建失败：项目创建被工作区拒绝，请检查输入后重试。" };
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
