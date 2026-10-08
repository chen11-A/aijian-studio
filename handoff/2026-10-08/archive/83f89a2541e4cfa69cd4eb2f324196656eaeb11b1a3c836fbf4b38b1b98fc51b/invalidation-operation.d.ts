import type { components } from "./generated.js";
export type InvalidationOperationResponse = components["schemas"]["InvalidationOperationResponse"];
export type InvalidationOperationPageQuery = Readonly<{
    limit?: number;
    cursor?: string | null;
}>;
export type InvalidationOperationPageItem = components["schemas"]["InvalidationOperationSummaryData"];
export type InvalidationOperationPageResponse = components["schemas"]["InvalidationOperationPageResponse"];
export declare function validateInvalidationOperationPageQuery(value: unknown): InvalidationOperationPageQuery;
export declare function isInvalidationOperationPageResponse(value: unknown, expectedProjectId: string, query?: InvalidationOperationPageQuery): value is InvalidationOperationPageResponse;
export declare function isInvalidationOperationResponse(value: unknown, expectedProjectId: string, expectedOperationId: string): value is InvalidationOperationResponse;
