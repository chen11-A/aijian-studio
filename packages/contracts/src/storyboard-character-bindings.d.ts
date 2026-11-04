export function hasStoryboardShotKeys(shot: Record<string, unknown>, schema: unknown): boolean;
export function hasValidStoryboardBindings(shot: Record<string, unknown>, schema: unknown): boolean;
export function hasValidStoryboardPlanning(shot: Record<string, unknown>, schema: unknown): boolean;

export function hasStoryboardContentKeys(content: Record<string, unknown>): boolean;
export function hasValidStoryboardVisualPin(content: Record<string, unknown>): boolean;

export function hasValidStoryboardEnvironment(
  shot: Record<string, unknown>,
  schema: unknown,
): boolean;
export function hasValidStoryboardEnvironmentBasis(content: Record<string, unknown>): boolean;
