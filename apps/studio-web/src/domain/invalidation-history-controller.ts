import type {
  InvalidationOperationPageQuery,
  InvalidationOperationPageResponse,
  InvalidationOperationResponse,
} from "../api/studio";

export const INVALIDATION_HISTORY_PAGE_LIMIT = 20;
type OperationSummary = InvalidationOperationPageResponse["data"]["items"][number];
type OperationDetail = InvalidationOperationResponse["data"];

export type InvalidationHistoryGateway = Readonly<{
  list(
    projectId: string,
    query: InvalidationOperationPageQuery,
  ): Promise<InvalidationOperationPageResponse>;
  get(projectId: string, operationId: string): Promise<InvalidationOperationResponse>;
}>;

export type InvalidationHistoryState = Readonly<{
  projectId: string;
  items: readonly OperationSummary[];
  nextCursor: string | null;
  list: "loading" | "ready" | "error";
  listError: string | null;
  more: "idle" | "loading" | "error";
  moreError: string | null;
  detail: "idle" | "loading" | "ready" | "error";
  detailError: string | null;
  selectedOperationId: string | null;
  lastSelectedOperationId: string | null;
  operation: OperationDetail | null;
}>;

const initialState = (projectId: string): InvalidationHistoryState => ({
  projectId,
  items: [],
  nextCursor: null,
  list: "loading",
  listError: null,
  more: "idle",
  moreError: null,
  detail: "idle",
  detailError: null,
  selectedOperationId: null,
  lastSelectedOperationId: null,
  operation: null,
});
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "读取影响报告时发生未知错误";

export class InvalidationHistoryController {
  private state: InvalidationHistoryState;
  private listGeneration = 0;
  private detailGeneration = 0;
  private readonly subscribers = new Set<(state: InvalidationHistoryState) => void>();
  public constructor(
    private readonly gateway: InvalidationHistoryGateway,
    projectId: string,
  ) {
    this.state = initialState(projectId);
  }
  public getState(): InvalidationHistoryState {
    return this.state;
  }
  public subscribe(listener: (state: InvalidationHistoryState) => void): () => void {
    this.subscribers.add(listener);
    listener(this.state);
    return () => this.subscribers.delete(listener);
  }
  private update(next: InvalidationHistoryState): void {
    this.state = next;
    this.subscribers.forEach((listener) => listener(next));
  }
  public dispose(): void {
    this.listGeneration += 1;
    this.detailGeneration += 1;
    this.subscribers.clear();
  }

  public setProject(projectId: string): void {
    if (projectId === this.state.projectId) return;
    this.listGeneration += 1;
    this.detailGeneration += 1;
    this.update(initialState(projectId));
  }
  public async loadInitial(): Promise<void> {
    const projectId = this.state.projectId;
    const generation = ++this.listGeneration;
    this.update({
      ...this.state,
      list: "loading",
      listError: null,
      more: "idle",
      moreError: null,
      nextCursor: null,
    });
    try {
      const response = await this.gateway.list(projectId, {
        limit: INVALIDATION_HISTORY_PAGE_LIMIT,
      });
      if (generation !== this.listGeneration || projectId !== this.state.projectId) return;
      this.update({
        ...this.state,
        items: response.data.items,
        nextCursor: response.data.next_cursor,
        list: "ready",
      });
    } catch (error) {
      if (generation !== this.listGeneration || projectId !== this.state.projectId) return;
      this.update({
        ...this.state,
        list: "error",
        listError: errorMessage(error),
      });
    }
  }
  public async loadMore(): Promise<void> {
    const { projectId, nextCursor, more } = this.state;
    if (nextCursor === null || more === "loading" || this.state.list !== "ready") return;
    const generation = ++this.listGeneration;
    this.update({ ...this.state, more: "loading", moreError: null });
    try {
      const response = await this.gateway.list(projectId, {
        limit: INVALIDATION_HISTORY_PAGE_LIMIT,
        cursor: nextCursor,
      });
      if (generation !== this.listGeneration || projectId !== this.state.projectId) return;
      this.update({
        ...this.state,
        items: [...this.state.items, ...response.data.items],
        nextCursor: response.data.next_cursor,
        more: "idle",
      });
    } catch (error) {
      if (generation !== this.listGeneration || projectId !== this.state.projectId) return;
      this.update({
        ...this.state,
        more: "error",
        moreError: errorMessage(error),
      });
    }
  }
  public async select(operationId: string): Promise<void> {
    if (
      this.state.selectedOperationId === operationId &&
      (this.state.detail === "loading" || this.state.detail === "ready")
    )
      return;
    const projectId = this.state.projectId;
    const generation = ++this.detailGeneration;
    this.update({
      ...this.state,
      selectedOperationId: operationId,
      lastSelectedOperationId: operationId,
      detail: "loading",
      detailError: null,
      operation: null,
    });
    try {
      const response = await this.gateway.get(projectId, operationId);
      if (generation !== this.detailGeneration || projectId !== this.state.projectId) return;
      this.update({ ...this.state, detail: "ready", operation: response.data });
    } catch (error) {
      if (generation !== this.detailGeneration || projectId !== this.state.projectId) return;
      this.update({
        ...this.state,
        detail: "error",
        detailError: errorMessage(error),
      });
    }
  }
  public backToList(): string | null {
    const restoreFocusOperationId = this.state.lastSelectedOperationId;
    this.detailGeneration += 1;
    this.update({
      ...this.state,
      selectedOperationId: null,
      detail: "idle",
      detailError: null,
      operation: null,
    });
    return restoreFocusOperationId;
  }
}
