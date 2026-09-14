import type {
  ReorderTimelineClipInput,
  ReplaceTimelineClipInput,
  StudioTransport,
  TimelineResponse,
  TrimTimelineClipInput,
} from "../api/studio";

export type TimelineWorkspaceGateway = Readonly<{
  load(projectId: string): Promise<TimelineResponse | null>;
  trim(projectId: string, input: TrimTimelineClipInput): Promise<TimelineResponse>;
  reorder(projectId: string, input: ReorderTimelineClipInput): Promise<TimelineResponse>;
  replace(projectId: string, input: ReplaceTimelineClipInput): Promise<TimelineResponse>;
}>;
export function createTimelineWorkspaceGateway(
  studio: Pick<
    StudioTransport,
    "getProjectTimeline" | "trimTimelineClip" | "reorderTimelineClip" | "replaceTimelineClip"
  >,
): TimelineWorkspaceGateway {
  return {
    load: studio.getProjectTimeline,
    trim: studio.trimTimelineClip,
    reorder: studio.reorderTimelineClip,
    replace: studio.replaceTimelineClip,
  };
}
type ReadyState = Readonly<{
  kind: "ready";
  projectId: string;
  response: TimelineResponse;
  timelineId: string;
  selectedClipId: string | null;
  notice: string | null;
  saving: boolean;
}>;
export type TimelineWorkspaceState =
  | Readonly<{
      kind: "loading";
      projectId: string;
      notice: null;
      saving: boolean;
    }>
  | Readonly<{
      kind: "empty";
      projectId: string;
      notice: null;
      saving: boolean;
    }>
  | Readonly<{
      kind: "error";
      projectId: string;
      notice: null;
      saving: boolean;
    }>
  | ReadyState;
const loading = (projectId: string): TimelineWorkspaceState => ({
  kind: "loading",
  projectId,
  notice: null,
  saving: false,
});
function selectedClip(response: TimelineResponse, preferred: string | null): string | null {
  const clips = response.data.timeline.clips;
  return clips.some((clip) => clip.clip_id === preferred) ? preferred : (clips[0]?.clip_id ?? null);
}
function belongsToProject(response: TimelineResponse, projectId: string): boolean {
  return response.data.project_id === projectId;
}

export class TimelineWorkspaceController {
  private state: TimelineWorkspaceState;
  private generation = 0;
  private readonly subscribers = new Set<(state: TimelineWorkspaceState) => void>();
  public constructor(
    private readonly gateway: TimelineWorkspaceGateway,
    projectId: string,
  ) {
    this.state = loading(projectId);
  }
  public getState(): TimelineWorkspaceState {
    return this.state;
  }
  public subscribe(listener: (state: TimelineWorkspaceState) => void): () => void {
    this.subscribers.add(listener);
    listener(this.state);
    return () => this.subscribers.delete(listener);
  }
  private update(state: TimelineWorkspaceState): void {
    this.state = state;
    this.subscribers.forEach((listener) => listener(state));
  }
  private current(generation: number, projectId: string): boolean {
    return generation === this.generation && projectId === this.state.projectId;
  }
  public dispose(): void {
    this.generation += 1;
    this.subscribers.clear();
  }
  public setProject(projectId: string): void {
    if (projectId === this.state.projectId) return;
    this.generation += 1;
    this.update(loading(projectId));
  }
  public selectClip(clipId: string): void {
    if (
      this.state.kind !== "ready" ||
      this.state.saving ||
      !this.state.response.data.timeline.clips.some((clip) => clip.clip_id === clipId)
    )
      return;
    this.update({ ...this.state, selectedClipId: clipId });
  }
  public async reload(): Promise<void> {
    if (this.state.saving) return;
    const projectId = this.state.projectId;
    const generation = ++this.generation;
    const prior = this.state.kind === "ready" ? this.state : null;
    this.update(loading(projectId));
    await this.read(
      projectId,
      generation,
      prior?.timelineId ?? null,
      prior?.selectedClipId ?? null,
      null,
    );
  }
  private async read(
    projectId: string,
    generation: number,
    expectedTimelineId: string | null,
    preferredClipId: string | null,
    notice: string | null,
  ): Promise<void> {
    try {
      const response = await this.gateway.load(projectId);
      if (!this.current(generation, projectId)) return;
      if (response === null) {
        this.update({ kind: "empty", projectId, notice: null, saving: false });
        return;
      }
      if (!belongsToProject(response, projectId)) {
        this.update({ kind: "error", projectId, notice: null, saving: false });
        return;
      }
      const timelineId = response.data.timeline.timeline_id;
      this.update({
        kind: "ready",
        projectId,
        response,
        timelineId,
        selectedClipId: selectedClip(
          response,
          response.data.timeline.timeline_id === expectedTimelineId ? preferredClipId : null,
        ),
        notice,
        saving: false,
      });
    } catch {
      if (this.current(generation, projectId))
        this.update({ kind: "error", projectId, notice: null, saving: false });
    }
  }
  public async trim(input: TrimTimelineClipInput): Promise<void> {
    await this.run("trim", input);
  }
  public async reorder(input: ReorderTimelineClipInput): Promise<void> {
    await this.run("reorder", input);
  }
  public async replace(input: ReplaceTimelineClipInput): Promise<void> {
    await this.run("replace", input);
  }
  private async run(
    operation: "trim" | "reorder" | "replace",
    input: TrimTimelineClipInput | ReorderTimelineClipInput | ReplaceTimelineClipInput,
  ): Promise<void> {
    if (
      this.state.kind !== "ready" ||
      this.state.saving ||
      input.clip_id !== this.state.selectedClipId ||
      !this.state.response.data.timeline.clips.some((clip) => clip.clip_id === input.clip_id)
    )
      return;
    const projectId = this.state.projectId;
    const timelineId = this.state.timelineId;
    const selectedClipId = this.state.selectedClipId;
    const generation = ++this.generation;
    this.update({ ...this.state, saving: true, notice: null });
    try {
      const response =
        operation === "trim"
          ? await this.gateway.trim(projectId, input as TrimTimelineClipInput)
          : operation === "reorder"
            ? await this.gateway.reorder(projectId, input as ReorderTimelineClipInput)
            : await this.gateway.replace(projectId, input as ReplaceTimelineClipInput);
      if (!this.current(generation, projectId)) return;
      if (
        !belongsToProject(response, projectId) ||
        response.data.timeline.timeline_id !== timelineId
      ) {
        await this.read(projectId, generation, timelineId, selectedClipId, null);
        return;
      }
      this.update({
        kind: "ready",
        projectId,
        response,
        timelineId,
        selectedClipId: selectedClip(response, selectedClipId),
        notice: null,
        saving: false,
      });
    } catch {
      if (this.current(generation, projectId))
        await this.read(
          projectId,
          generation,
          timelineId,
          selectedClipId,
          "修改结果未知；已重新读取最新时间线。",
        );
    }
  }
}
